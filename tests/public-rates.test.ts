import { describe, expect, it } from 'vitest';
import { PublicRateService, type RateFetcher } from '../src/api/public-rates.js';
import { InMemoryRepository } from '../src/api/repository.js';
import type { PublicRateRecord } from '../src/shared/schema.js';

const fetcher: RateFetcher = {
  async fetch(input) {
    if (input.includes('CORRA')) return new Response(JSON.stringify({ observations: [{ d: '2026-08-12', CORRA: { v: '2.745' } }] }));
    // Monthly chartered-bank business lending series; May 2026 is the last observation.
    if (input.includes('V122667816')) return new Response(JSON.stringify({ observations: [{ d: '2026-05-01', V122667816: { v: '4.64' } }] }));
    if (input.includes('V39053')) return new Response(JSON.stringify({ observations: [{ d: '2026-08-12', V39053: { v: '3.216' } }] }));
    if (input.includes('newyorkfed')) return new Response(JSON.stringify({ refRates: [{ effectiveDate: '2026-08-12', percentRate: '4.375' }] }));
    if (input.includes('treasury.gov')) return new Response('<m:NEW_DATE>2026-08-12T00:00:00</m:NEW_DATE><m:BC_5YEAR>3.125</m:BC_5YEAR>');
    return new Response('Farm Operating direct loan rate: 4.125% effective August 1, 2026');
  },
};

function record(overrides: Partial<PublicRateRecord> = {}): PublicRateRecord {
  return {
    source: 'https://example.test/rates', series: 'SOFR', valueBps: 438,
    asOf: '2026-08-12', retrievedAt: new Date().toISOString(), status: 'fresh',
    sourceUrl: 'https://example.test/rates', label: 'SOFR', ...overrides,
  };
}

describe('public rate context', () => {
  it('converts official decimal percentages to integer basis points without binary rounding', async () => {
    const rates = await new PublicRateService(new InMemoryRepository(), fetcher).getContext();
    expect(rates).toEqual(expect.arrayContaining([
      expect.objectContaining({ series: 'SOFR', valueBps: 438, asOf: '2026-08-12', status: 'fresh' }),
      expect.objectContaining({ series: 'TREASURY_5Y', valueBps: 313, asOf: '2026-08-12', status: 'fresh' }),
      expect.objectContaining({ series: 'FSA_DIRECT_RATES', valueBps: 413, asOf: '2026-08-01', status: 'fresh' }),
    ]));
  });

  it('uses a recent cached source record when the official source is temporarily offline', async () => {
    const repository = new InMemoryRepository();
    await repository.putRateCache(record());
    const offline: RateFetcher = { fetch: async () => { throw new Error('offline'); } };
    const rates = await new PublicRateService(repository, offline).getContext();
    expect(rates).toEqual([expect.objectContaining({ series: 'SOFR', status: 'cached', valueBps: 438 })]);
  });

  it('loads Canadian CORRA and 5-year benchmark context from official Valet series', async () => {
    const rates = await new PublicRateService(new InMemoryRepository(), fetcher).getContext('CA');
    expect(rates).toEqual(expect.arrayContaining([
      expect.objectContaining({ series: 'CORRA', valueBps: 275, asOf: '2026-08-12', status: 'fresh' }),
      expect.objectContaining({ series: 'CANADA_5Y', valueBps: 322, asOf: '2026-08-12', status: 'fresh' }),
    ]));
  });

  it('does not present an expired cached public rate as usable context', async () => {
    const repository = new InMemoryRepository();
    await repository.putRateCache(record({ retrievedAt: '2026-01-01T00:00:00.000Z' }));
    const offline: RateFetcher = { fetch: async () => { throw new Error('offline'); } };
    expect(await new PublicRateService(repository, offline).getContext()).toEqual([]);
  });
});

describe('lending rate benchmarks', () => {
  it('serves the six transcribed US benchmarks, every one of them sourced and dated', async () => {
    const benchmarks = await new PublicRateService(new InMemoryRepository(), fetcher).getBenchmarks('US');
    expect(benchmarks).toHaveLength(6);
    expect(benchmarks.map((benchmark) => benchmark.series)).toEqual([
      'KC_FED_MACHINERY_FIXED',
      'KC_FED_OPERATING_FIXED',
      'KC_FED_REAL_ESTATE_FIXED',
      'CHI_FED_OPERATING',
      'CHI_FED_REAL_ESTATE',
      'AGDIRECT_EQUIP_FIXED_5Y',
    ]);
    // Product rule 10: a user-visible figure is traceable or it is not shown.
    for (const benchmark of benchmarks) {
      expect(benchmark.countryCode, benchmark.series).toBe('US');
      expect(benchmark.valueBps, benchmark.series).toBeTypeOf('number');
      expect(Number.isInteger(benchmark.valueBps), benchmark.series).toBe(true);
      expect(benchmark.sourceName.length, benchmark.series).toBeGreaterThan(0);
      expect(benchmark.sourceUrl, benchmark.series).toMatch(/^https:\/\//);
      expect(benchmark.asOf, benchmark.series).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(benchmark.asOfLabel.length, benchmark.series).toBeGreaterThan(0);
      expect(benchmark.retrievedAt, benchmark.series).toBe('2026-08-14');
      expect(benchmark.region.length, benchmark.series).toBeGreaterThan(0);
    }
  });

  it('carries each district average and the posted rate at its published value and kind', async () => {
    const benchmarks = await new PublicRateService(new InMemoryRepository(), fetcher).getBenchmarks();
    expect(benchmarks).toEqual(expect.arrayContaining([
      expect.objectContaining({ series: 'KC_FED_MACHINERY_FIXED', loanType: 'equipment', valueBps: 731, kind: 'official_survey', asOfLabel: 'Q2 2026' }),
      expect.objectContaining({ series: 'KC_FED_OPERATING_FIXED', loanType: 'operating', valueBps: 751, kind: 'official_survey' }),
      expect.objectContaining({ series: 'KC_FED_REAL_ESTATE_FIXED', loanType: 'real_estate', valueBps: 697, kind: 'official_survey' }),
      expect.objectContaining({ series: 'CHI_FED_OPERATING', loanType: 'operating', valueBps: 712, sourceName: 'Chicago Fed AgLetter No. 2013' }),
      expect.objectContaining({ series: 'CHI_FED_REAL_ESTATE', loanType: 'real_estate', valueBps: 679, region: 'Seventh Federal Reserve District' }),
      // The only posted rate in the set, and the only one the UI footnotes as
      // a sticker rate subject to credit approval.
      expect.objectContaining({ series: 'AGDIRECT_EQUIP_FIXED_5Y', loanType: 'equipment', valueBps: 675, kind: 'posted_rate', asOfLabel: 'August 2026' }),
    ]));
    expect(benchmarks.filter((benchmark) => benchmark.kind === 'posted_rate')).toHaveLength(1);
  });

  it('reads the Canadian benchmark live from the Valet series and links the published table', async () => {
    const benchmarks = await new PublicRateService(new InMemoryRepository(), fetcher).getBenchmarks('CA');
    expect(benchmarks).toEqual([expect.objectContaining({
      series: 'CA_BUSINESS_LENDING',
      label: 'Chartered bank business lending, new funds advanced',
      countryCode: 'CA',
      region: 'Canada',
      loanType: 'any',
      kind: 'official_survey',
      valueBps: 464,
      asOf: '2026-05-01',
      asOfLabel: 'May 2026',
      sourceName: 'Bank of Canada',
      sourceUrl: 'https://www.bankofcanada.ca/rates/banking-and-financial-statistics/interest-rates-for-new-and-existing-lending-by-chartered-banks/',
    })]);
    expect(benchmarks[0]!.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('falls back to the recent cached Canadian record when the Valet source is offline', async () => {
    const repository = new InMemoryRepository();
    await repository.putRateCache(record({
      series: 'CA_BUSINESS_LENDING',
      label: 'Chartered bank business lending, new funds advanced',
      valueBps: 464,
      asOf: '2026-05-01',
    }));
    const offline: RateFetcher = { fetch: async () => { throw new Error('offline'); } };
    expect(await new PublicRateService(repository, offline).getBenchmarks('CA')).toEqual([
      expect.objectContaining({ series: 'CA_BUSINESS_LENDING', valueBps: 464, asOfLabel: 'May 2026' }),
    ]);
  });

  it('omits the Canadian benchmark rather than inventing one when there is nothing to serve', async () => {
    const offline: RateFetcher = { fetch: async () => { throw new Error('offline'); } };
    expect(await new PublicRateService(new InMemoryRepository(), offline).getBenchmarks('CA')).toEqual([]);
  });

  it('never serves a US benchmark to a Canadian flow, or the reverse', async () => {
    const service = new PublicRateService(new InMemoryRepository(), fetcher);
    expect((await service.getBenchmarks('CA')).every((benchmark) => benchmark.countryCode === 'CA')).toBe(true);
    expect((await service.getBenchmarks('US')).every((benchmark) => benchmark.countryCode === 'US')).toBe(true);
  });
});
