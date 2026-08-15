import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PublicApiError } from '../../src/api/security.js';
import {
  assertMutationAllowed,
  createSession,
  csrfTokenFor,
  resolveSession,
  SESSION_COOKIE,
} from '../../standalone/src/session.js';
import type { StandaloneEnv } from '../../standalone/src/env.js';
import { createFakeSupabase } from './supabase-fake.js';
import { distAssets, testEnv } from './fixtures.js';

const ORIGIN = 'https://loanhank.test';
const ACCESS_TOKEN = 'access-token-value-that-must-never-be-stored-in-cleartext';
const REFRESH_TOKEN = 'refresh-token-value-that-must-never-be-stored-in-cleartext';

let supabase: ReturnType<typeof createFakeSupabase>;
let restore: () => void;
let env: StandaloneEnv;

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
}

function requestWith(cookie: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}/v1/me`, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } });
}

beforeEach(() => {
  supabase = createFakeSupabase();
  restore = supabase.install();
  env = testEnv(distAssets());
});

afterEach(() => restore());

async function newSession() {
  const { cookie } = await createSession(env, {
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    expiresInSeconds: 3_600,
    userId: '11111111-1111-4111-8111-111111111111',
  });
  return { cookie, id: cookieValue(cookie) };
}

describe('session cookies', () => {
  it('uses a __Host- cookie with every hardening attribute', async () => {
    const { cookie } = await newSession();
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    expect(cookie).toContain('; Path=/');
    expect(cookie).toContain('; HttpOnly');
    expect(cookie).toContain('; Secure');
    expect(cookie).toContain('; SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
  });

  it('bounds the cookie lifetime to the configured absolute session lifetime', async () => {
    const { cookie } = await newSession();
    const maxAge = Number(cookie.match(/Max-Age=(\d+)/)?.[1]);
    expect(maxAge).toBe(12 * 60 * 60);
  });

  it('never stores an authentication token in cleartext', async () => {
    await newSession();
    const stored = JSON.stringify(supabase.table('auth_sessions'));
    expect(stored).not.toContain(ACCESS_TOKEN);
    expect(stored).not.toContain(REFRESH_TOKEN);
    expect(stored).toContain('access_token_encrypted');
  });

  it('resolves the opaque cookie back into a live access token', async () => {
    const { id } = await newSession();
    const session = await resolveSession(env, requestWith(`${SESSION_COOKIE}=${id}`));
    expect(session?.accessToken).toBe(ACCESS_TOKEN);
    expect(session?.userId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects an unknown cookie value', async () => {
    expect(await resolveSession(env, requestWith(`${SESSION_COOKIE}=not-a-session`))).toBeNull();
  });
});

describe('rotation and expiry', () => {
  it('rotates the cookie once the rotation interval has passed and keeps a short grace for in-flight requests', async () => {
    const { id } = await newSession();
    const row = supabase.table('auth_sessions')[0]!;
    row.rotated_at = new Date(Date.now() - 20 * 60_000).toISOString();

    const rotated = await resolveSession(env, requestWith(`${SESSION_COOKIE}=${id}`));
    expect(rotated?.refreshedCookie).toBeTruthy();
    const nextId = cookieValue(rotated!.refreshedCookie!);
    expect(nextId).not.toBe(id);

    // The new value works, and a request still holding the old one is not
    // signed out mid-flight.
    expect((await resolveSession(env, requestWith(`${SESSION_COOKIE}=${nextId}`)))?.accessToken).toBe(ACCESS_TOKEN);
    const viaGrace = await resolveSession(env, requestWith(`${SESSION_COOKIE}=${id}`));
    expect(viaGrace?.accessToken).toBe(ACCESS_TOKEN);
    expect(viaGrace?.refreshedCookie).toBeUndefined();
  });

  it('stops accepting a superseded cookie once the grace window closes', async () => {
    const { id } = await newSession();
    const row = supabase.table('auth_sessions')[0]!;
    row.rotated_at = new Date(Date.now() - 20 * 60_000).toISOString();
    const rotated = await resolveSession(env, requestWith(`${SESSION_COOKIE}=${id}`));
    expect(rotated?.refreshedCookie).toBeTruthy();

    row.previous_valid_until = new Date(Date.now() - 1_000).toISOString();
    expect(await resolveSession(env, requestWith(`${SESSION_COOKIE}=${id}`))).toBeNull();
  });

  it('drops the session at the absolute lifetime even if it is being used', async () => {
    const { id } = await newSession();
    const row = supabase.table('auth_sessions')[0]!;
    row.absolute_expires_at = new Date(Date.now() - 1_000).toISOString();
    expect(await resolveSession(env, requestWith(`${SESSION_COOKIE}=${id}`))).toBeNull();
    expect(supabase.table('auth_sessions')).toHaveLength(0);
  });

  it('drops the session after the idle window', async () => {
    const { id } = await newSession();
    const row = supabase.table('auth_sessions')[0]!;
    row.rotated_at = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    expect(await resolveSession(env, requestWith(`${SESSION_COOKIE}=${id}`))).toBeNull();
  });
});

describe('mutation guards', () => {
  const session = { recordId: 'record-1', userId: 'user-1', accessToken: 'token' };

  it('allows a read without any token', async () => {
    await expect(assertMutationAllowed(env, new Request(`${ORIGIN}/v1/me`), session)).resolves.toBeUndefined();
  });

  it('blocks a mutation from another origin before it reaches a handler', async () => {
    const request = new Request(`${ORIGIN}/v1/me`, {
      method: 'PATCH',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    await expect(assertMutationAllowed(env, request, session)).rejects.toBeInstanceOf(PublicApiError);
  });

  it('blocks a same-origin mutation that presents no CSRF token', async () => {
    const request = new Request(`${ORIGIN}/v1/me`, {
      method: 'PATCH',
      headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
    });
    await expect(assertMutationAllowed(env, request, session)).rejects.toBeInstanceOf(PublicApiError);
  });

  it('accepts the CSRF token bound to this session', async () => {
    const token = await csrfTokenFor(env, session.recordId);
    const request = new Request(`${ORIGIN}/v1/me`, {
      method: 'PATCH',
      headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-csrf-token': token },
    });
    await expect(assertMutationAllowed(env, request, session)).resolves.toBeUndefined();
  });

  it('rejects a CSRF token minted for a different session', async () => {
    const token = await csrfTokenFor(env, 'a-different-record');
    const request = new Request(`${ORIGIN}/v1/me`, {
      method: 'PATCH',
      headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-csrf-token': token },
    });
    await expect(assertMutationAllowed(env, request, session)).rejects.toBeInstanceOf(PublicApiError);
  });

  it('binds the CSRF token to the stable record so rotation does not invalidate it', async () => {
    const first = await csrfTokenFor(env, session.recordId);
    const second = await csrfTokenFor(env, session.recordId);
    expect(first).toBe(second);
  });
});
