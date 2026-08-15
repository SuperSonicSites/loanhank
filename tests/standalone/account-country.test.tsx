// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile } from '../../src/shared/schema.js';
import type { AppShellState } from '../../standalone/src/app/App.js';
import { getProfile, signIn, updateProfile } from '../../standalone/src/app/api.js';
import { AccountScreen } from '../../standalone/src/app/screens/Account.js';

vi.mock('../../standalone/src/app/api.js', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  getPushConfig: vi.fn(),
  registerPushSubscription: vi.fn(),
  unregisterPushSubscription: vi.fn(),
  deleteAccount: vi.fn(),
  importSavedLoan: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Minimal stub — a plain object, not reactive state, so recording a call on
 * (say) `setCountry` never itself triggers a re-render or a new `shell`
 * identity the way the real App.tsx shell would. */
function makeShell(overrides: Partial<AppShellState> = {}): AppShellState {
  return {
    authenticated: false,
    country: 'US',
    setCountry: vi.fn(),
    navigate: vi.fn(),
    goHome: vi.fn(),
    notify: vi.fn(),
    refreshSession: vi.fn(async () => {}),
    documentProcessingReady: null,
    turnstileSiteKey: null,
    unreadCount: 0,
    setUnreadCount: vi.fn(),
    ...overrides,
  };
}

function makeProfile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    accountId: '11111111-1111-4111-8111-111111111111',
    email: 'grower@example.com',
    displayName: 'Grower',
    defaultCountryCode: 'US',
    timezone: 'America/Chicago',
    emailAlertsEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('guest sign-in country selection', () => {
  it('renders both country chips and threads the selected country plus save=1 into the signIn redirectTo', async () => {
    window.history.pushState({}, '', '/account?save=1');
    vi.mocked(signIn).mockResolvedValue({ status: 'sent', message: 'Check your email' });

    render(<AccountScreen shell={makeShell({ authenticated: false, country: 'US' })} />);

    const usChip = screen.getByRole('button', { name: 'US' });
    const caChip = screen.getByRole('button', { name: 'Canada' });
    expect(usChip).toHaveAttribute('aria-pressed', 'true');
    expect(caChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(caChip);
    expect(caChip).toHaveAttribute('aria-pressed', 'true');
    expect(usChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'grower@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));

    await waitFor(() => expect(vi.mocked(signIn)).toHaveBeenCalledTimes(1));
    const [emailArg, redirectTo] = vi.mocked(signIn).mock.calls[0]!;
    expect(emailArg).toBe('grower@example.com');
    expect(redirectTo).toContain('country=CA');
    expect(redirectTo).toContain('save=1');
  });
});

describe('post-auth country threading', () => {
  it('applies ?country= via updateProfile before any getProfile-sourced country, then strips only that param', async () => {
    window.history.pushState({}, '', '/account?country=CA&foo=bar');
    const patchedProfile = makeProfile({ displayName: 'Patched Person', defaultCountryCode: 'CA' });
    const fetchedProfile = makeProfile({ displayName: 'Fetched Person', defaultCountryCode: 'US' });
    vi.mocked(updateProfile).mockResolvedValue({ profile: patchedProfile });
    vi.mocked(getProfile).mockResolvedValue({ authenticated: true, profile: fetchedProfile });

    const shell = makeShell({ authenticated: true, country: 'US' });
    render(<AccountScreen shell={shell} />);

    await waitFor(() => expect(vi.mocked(updateProfile)).toHaveBeenCalledWith({ defaultCountryCode: 'CA' }));
    // The PATCHed profile must win this pass — a fetched profile must never
    // race it or overwrite it.
    expect(vi.mocked(getProfile)).not.toHaveBeenCalled();
    expect(shell.setCountry).toHaveBeenCalledWith('CA');
    await screen.findByText('Patched Person');

    expect(window.location.search).not.toContain('country');
    expect(window.location.search).toContain('foo=bar');
  });

  it('does not call updateProfile on mount when no ?country= param is present', async () => {
    window.history.pushState({}, '', '/account');
    vi.mocked(getProfile).mockResolvedValue({ authenticated: true, profile: makeProfile() });

    render(<AccountScreen shell={makeShell({ authenticated: true, country: 'US' })} />);

    await waitFor(() => expect(vi.mocked(getProfile)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateProfile)).not.toHaveBeenCalled();
  });
});
