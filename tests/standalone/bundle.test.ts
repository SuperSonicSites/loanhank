import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = path.resolve(process.cwd(), 'standalone/dist/client');

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry);
    if ((await stat(full)).isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

async function textFiles(): Promise<Array<{ file: string; content: string }>> {
  const files = (await walk(DIST)).filter((file) => /\.(?:js|css|html|json|webmanifest|txt)$/.test(file));
  return Promise.all(files.map(async (file) => ({
    file: path.relative(DIST, file),
    content: await readFile(file, 'utf8'),
  })));
}

describe('shipped client bundle', () => {
  it('contains no credential of any kind', async () => {
    const forbidden = [
      /sb_secret_/,
      /service_role/,
      /\bsk-proj-/,
      /SUPABASE_SECRET_KEY/,
      /SESSION_ENCRYPTION_KEY/,
      /ACCOUNT_DATA_ENCRYPTION_KEY/,
      /ALERT_JOB_SECRET/,
      /VAPID_PRIVATE_KEY/,
      // eyJ… is the shape of a JWT; no signed token belongs in a bundle.
      /eyJ[A-Za-z0-9_-]{20,}\./,
    ];
    for (const { file, content } of await textFiles()) {
      for (const pattern of forbidden) {
        expect(pattern.test(content), `${file} matched ${pattern}`).toBe(false);
      }
    }
  });

  it('does not even carry a publishable key, because the client never talks to Supabase', async () => {
    for (const { file, content } of await textFiles()) {
      expect(content.includes('sb_publishable_'), file).toBe(false);
      expect(content.includes('supabase.co'), file).toBe(false);
    }
  });

  it('never writes to browser storage', async () => {
    for (const { file, content } of await textFiles()) {
      if (!file.endsWith('.js')) continue;
      expect(content.includes('localStorage'), file).toBe(false);
      expect(content.includes('sessionStorage'), file).toBe(false);
      expect(content.includes('indexedDB'), file).toBe(false);
    }
  });

  it('requests nothing from a third-party host', async () => {
    // `react.dev` appears inside React's error-message strings, which are never
    // fetched; the CSP test proves the policy would block a request anyway.
    // `challenges.cloudflare.com` is Turnstile — the single allowed third-party
    // script origin, loaded only by the app-shell upload step and mirrored in
    // the CSP's script-src/frame-src.
    const benign = ['www.w3.org', 'localhost', '127.0.0.1', 'react.dev', 'challenges.cloudflare.com'];
    for (const { file, content } of await textFiles()) {
      if (file === 'sw.js') continue; // its cache allow-list is asserted separately
      const hosts = [...content.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)]
        .map((match) => match[1]!.toLowerCase())
        .filter((host) => !benign.includes(host));
      expect(hosts, file).toEqual([]);
    }
  });

  it('loads no markup or stylesheet resource from another origin', async () => {
    for (const { file, content } of await textFiles()) {
      if (!/\.(?:html|css|webmanifest)$/.test(file)) continue;
      const references = [...content.matchAll(/(?:src|href|url)\s*=?\s*["'(]?(https?:\/\/[^"')\s]+)/gi)]
        .map((match) => match[1]!);
      expect(references, file).toEqual([]);
    }
  });

  it('serves the whole font set from this origin', async () => {
    const fonts = await readdir(path.join(DIST, 'fonts'));
    expect(fonts.filter((file) => file.endsWith('.woff2')).length).toBeGreaterThanOrEqual(9);
    expect(fonts.every((file) => file.endsWith('.woff2'))).toBe(true);
  });

  it('ships the PWA surface the manifest promises', async () => {
    const manifest = JSON.parse(await readFile(path.join(DIST, 'manifest.webmanifest'), 'utf8')) as {
      start_url: string;
      icons: Array<{ src: string; purpose?: string }>;
      shortcuts: Array<{ url: string }>;
    };
    expect(manifest.start_url).toBe('/?source=pwa');
    // No entry may point at a retired path — those only survive as redirects.
    for (const shortcut of manifest.shortcuts) expect(shortcut.url.startsWith('/app')).toBe(false);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    const present = new Set(await walk(DIST));
    for (const icon of manifest.icons) {
      expect(present.has(path.join(DIST, icon.src.replace(/^\//, '').replace(/\//g, path.sep))), icon.src).toBe(true);
    }
  });

  it('keeps private paths out of the service worker cache', async () => {
    const sw = await readFile(path.join(DIST, 'sw.js'), 'utf8');
    expect(sw).toContain("const NEVER_CACHE = ['/v1/', '/auth/', '/analyze', '/loans', '/watch', '/account']");
    // The offline fallback is a static page, never a stored copy of private HTML.
    expect(sw).toContain("caches.match('/offline.html')");
  });
});
