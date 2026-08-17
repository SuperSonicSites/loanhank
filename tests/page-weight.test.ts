import { readdir, stat } from 'node:fs/promises';
import { brotliCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderForm } from '../src/web/page.js';

// design.md §9: page weight under 150KB total, fonts included, because rural
// LTE is the median network and speed is trust. Measured as the wire measures
// it: the HTML brotli-compressed, which is how Cloudflare serves it, plus the
// woff2 files as-is, because woff2 is already Brotli inside.
//
// This exists because the homepage grew a camera hero, a disclosure, a
// whose-side block and a worked ticket in one ruling, and a budget nobody
// measures is a budget that is already gone.

const BUDGET_BYTES = 150 * 1024;

describe('the landing page stays inside the weight budget', () => {
  it('HTML on the wire plus every font stays under 150KB', async () => {
    const html = renderForm(undefined, [], {
      turnstileSiteKey: '0x4AAAAAAAAAAAAAAAAAAAAAAA',
    });
    const wireBytes = brotliCompressSync(Buffer.from(html)).byteLength;

    const fontsDir = new URL('../public/fonts/', import.meta.url);
    let fontBytes = 0;
    for (const name of await readdir(fontsDir)) {
      fontBytes += (await stat(new URL(name, fontsDir))).size;
    }

    expect(fontBytes, 'no fonts found to measure, the budget check is blind').toBeGreaterThan(0);
    expect(
      wireBytes + fontBytes,
      `landing page is ${wireBytes} B compressed + ${fontBytes} B fonts, over the 150KB budget`,
    ).toBeLessThan(BUDGET_BYTES);
  });
});
