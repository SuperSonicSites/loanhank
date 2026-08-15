import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * Targets the DEPLOYED PWA surface: standalone/public. The root public/ tree
 * belongs to the frozen legacy adapter and is not shipped.
 */
describe('installable privacy-safe PWA (standalone)', () => {
  it('ships a stable manifest with required icons, shortcuts, and install screenshots', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../standalone/public/manifest.webmanifest', import.meta.url), 'utf8'),
    ) as {
      id: string; scope: string; display: string; start_url: string;
      icons: Array<{ sizes: string; purpose?: string }>;
      shortcuts: Array<{ url: string }>;
      screenshots: Array<{ form_factor: string; src: string }>;
    };
    expect(manifest).toMatchObject({ id: '/', scope: '/', display: 'standalone', start_url: '/?source=pwa' });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['180x180', '192x192', '512x512']));
    expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: 'maskable' })]));
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(2);
    // Retired paths survive only as redirects; no entry may point at them.
    for (const shortcut of manifest.shortcuts) expect(shortcut.url.startsWith('/app')).toBe(false);
    expect(manifest.screenshots.map((shot) => shot.form_factor)).toEqual(expect.arrayContaining(['narrow', 'wide']));
    for (const shot of manifest.screenshots) {
      await expect(
        stat(new URL(`../standalone/public${shot.src}`, import.meta.url)),
      ).resolves.toMatchObject({ size: expect.any(Number) });
    }
  });

  it('never handles API, auth, or private app responses in the service-worker cache', async () => {
    const worker = await readFile(new URL('../standalone/public/sw.js', import.meta.url), 'utf8');
    expect(worker).toContain("const NEVER_CACHE = ['/v1/', '/auth/', '/analyze', '/loans', '/watch', '/account']");
    expect(worker).toContain("caches.match('/offline.html')");
    expect(worker).toContain("addEventListener('push'");
    expect(worker).toContain("addEventListener('notificationclick'");
  });
});
