import type { AnalysisRepository } from './repository.js';
import type { PublicRateRecord } from '../shared/schema.js';
import type { CountryCode } from '../shared/schema.js';
import Decimal from 'decimal.js';

const SOFR_URL = 'https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json';
const TREASURY_URL = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${new Date().getUTCFullYear()}`;
const FSA_URL = 'https://www.fsa.usda.gov/tools/informational/rates/current-fsa-loan-interest-rates';
const CORRA_URL = 'https://www.bankofcanada.ca/valet/observations/CORRA/json?recent=1';
const CANADA_5Y_URL = 'https://www.bankofcanada.ca/valet/observations/V39053/json?recent=1';
/** Monthly chartered-bank business lending series, fetched live like CORRA. */
const CA_BUSINESS_LENDING_URL = 'https://www.bankofcanada.ca/valet/observations/V122667816/json?recent=1';
/** The human-readable table the Valet series is published from — what the UI links to. */
const CA_BUSINESS_LENDING_SOURCE =
  'https://www.bankofcanada.ca/rates/banking-and-financial-statistics/interest-rates-for-new-and-existing-lending-by-chartered-banks/';
const MAX_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1_000;

export interface RateFetcher { fetch(input: string, init?: RequestInit): Promise<Response>; }

/**
 * A published agricultural lending average or posted rate, shown beside the
 * farmer's own confirmed rate as labeled context.
 *
 * It is never a rate the borrower is offered, qualifies for, or should
 * receive: `kind: 'official_survey'` is a backward-looking average of loans
 * other people already closed, and `kind: 'posted_rate'` is a sticker rate
 * subject to credit approval. The UI states the difference as a fact and
 * draws no conclusion from it (AGENTS.md, "Direction kill list").
 */
export interface RateBenchmark {
  series: string;
  label: string;
  loanType: 'equipment' | 'operating' | 'real_estate' | 'any';
  countryCode: CountryCode;
  region: string;
  kind: 'official_survey' | 'posted_rate';
  valueBps: number | null;
  /** The date the published figure describes, ISO `YYYY-MM-DD`. */
  asOf: string;
  /** The publication's own period name, e.g. `Q2 2026` or `August 2026`. */
  asOfLabel: string;
  sourceName: string;
  sourceUrl: string;
  /** When an operator (US) or this service (CA) last read the source. */
  retrievedAt: string;
}

/**
 * US benchmarks are a static dataset, not a runtime fetch.
 *
 * The Federal Reserve district surveys publish as bot-walled quarterly PDFs
 * and the AgDirect rate sheet is a rendered marketing page: neither is a
 * machine-readable feed this Worker may depend on inside a request. So the
 * values are transcribed by hand and dated, and `pnpm run benchmarks:check`
 * (scripts/update-rate-benchmarks.ts) reports drift between this dataset and
 * whatever the sources say now.
 *
 * Refresh cadence:
 *  - KC Fed Ag Credit Survey (Tenth District) — quarterly, read manually.
 *  - Chicago Fed AgLetter (Seventh District) — quarterly, read manually.
 *  - AgDirect posted rates — monthly, checked by the script.
 *
 * `retrievedAt` is a literal, not `Date.now()`: it records when a human last
 * read the source, so it must not drift every time the Worker restarts.
 */
export const US_RATE_BENCHMARKS: readonly RateBenchmark[] = [
  {
    series: 'KC_FED_MACHINERY_FIXED',
    label: 'Farm machinery loans, fixed — Tenth District average',
    loanType: 'equipment',
    countryCode: 'US',
    region: 'Tenth Federal Reserve District',
    kind: 'official_survey',
    valueBps: 731,
    asOf: '2026-06-30',
    asOfLabel: 'Q2 2026',
    sourceName: 'KC Fed Ag Credit Survey',
    sourceUrl: 'https://www.kansascityfed.org/agriculture/ag-credit-survey/',
    retrievedAt: '2026-08-14',
  },
  {
    series: 'KC_FED_OPERATING_FIXED',
    label: 'Farm operating loans, fixed — Tenth District average',
    loanType: 'operating',
    countryCode: 'US',
    region: 'Tenth Federal Reserve District',
    kind: 'official_survey',
    valueBps: 751,
    asOf: '2026-06-30',
    asOfLabel: 'Q2 2026',
    sourceName: 'KC Fed Ag Credit Survey',
    sourceUrl: 'https://www.kansascityfed.org/agriculture/ag-credit-survey/',
    retrievedAt: '2026-08-14',
  },
  {
    series: 'KC_FED_REAL_ESTATE_FIXED',
    label: 'Farm real estate loans, fixed — Tenth District average',
    loanType: 'real_estate',
    countryCode: 'US',
    region: 'Tenth Federal Reserve District',
    kind: 'official_survey',
    valueBps: 697,
    asOf: '2026-06-30',
    asOfLabel: 'Q2 2026',
    sourceName: 'KC Fed Ag Credit Survey',
    sourceUrl: 'https://www.kansascityfed.org/agriculture/ag-credit-survey/',
    retrievedAt: '2026-08-14',
  },
  {
    series: 'CHI_FED_OPERATING',
    label: 'New farm operating loans — Seventh District average',
    loanType: 'operating',
    countryCode: 'US',
    region: 'Seventh Federal Reserve District',
    kind: 'official_survey',
    valueBps: 712,
    asOf: '2026-06-30',
    asOfLabel: 'Q2 2026',
    sourceName: 'Chicago Fed AgLetter No. 2013',
    sourceUrl: 'https://www.chicagofed.org/publications/agletter/2025-2029/august-2026',
    retrievedAt: '2026-08-14',
  },
  {
    series: 'CHI_FED_REAL_ESTATE',
    label: 'New farm real estate loans — Seventh District average',
    loanType: 'real_estate',
    countryCode: 'US',
    region: 'Seventh Federal Reserve District',
    kind: 'official_survey',
    valueBps: 679,
    asOf: '2026-06-30',
    asOfLabel: 'Q2 2026',
    sourceName: 'Chicago Fed AgLetter No. 2013',
    sourceUrl: 'https://www.chicagofed.org/publications/agletter/2025-2029/august-2026',
    retrievedAt: '2026-08-14',
  },
  {
    series: 'AGDIRECT_EQUIP_FIXED_5Y',
    label: 'AgDirect posted equipment rate — 5-year fixed, $100,000–$249,999 financed',
    loanType: 'equipment',
    countryCode: 'US',
    region: 'United States',
    kind: 'posted_rate',
    valueBps: 675,
    asOf: '2026-08-01',
    asOfLabel: 'August 2026',
    sourceName: 'AgDirect (Farm Credit)',
    sourceUrl: 'https://www.agdirect.com/rates',
    retrievedAt: '2026-08-14',
  },
];

export class PublicRateService {
  constructor(private readonly repository: AnalysisRepository, private readonly fetcher: RateFetcher = globalThis) {}

  async getContext(countryCode: CountryCode = 'US'): Promise<PublicRateRecord[]> {
    if (countryCode === 'CA') {
      const records = await Promise.all([
        this.withCache('CORRA', () => this.fetchBankOfCanada('CORRA', 'Canadian Overnight Repo Rate Average (CORRA)', CORRA_URL)),
        this.withCache('CANADA_5Y', () => this.fetchBankOfCanada('V39053', 'Government of Canada benchmark bond yield — 5-year', CANADA_5Y_URL, 'CANADA_5Y')),
      ]);
      return records.filter((record): record is PublicRateRecord => record !== null);
    }
    const records = await Promise.all([
      this.withCache('SOFR', () => this.fetchSofr()),
      this.withCache('TREASURY_5Y', () => this.fetchTreasury5Year()),
      this.withCache('FSA_DIRECT_RATES', () => this.fetchFsaRates()),
    ]);
    return records.filter((record): record is PublicRateRecord => record !== null);
  }

  /**
   * Lending benchmarks for one country. The US set is the transcribed dataset
   * above; Canada has one live monthly series and is fetched through the same
   * cache-and-fall-back path as every other public series. A source that is
   * unavailable and has no recent cached record is omitted — an absent
   * benchmark is correct, an invented one never is.
   */
  async getBenchmarks(countryCode: CountryCode = 'US'): Promise<RateBenchmark[]> {
    if (countryCode !== 'CA') return [...US_RATE_BENCHMARKS];
    const record = await this.withCache('CA_BUSINESS_LENDING', () => this.fetchBankOfCanada(
      'V122667816',
      'Chartered bank business lending, new funds advanced',
      CA_BUSINESS_LENDING_URL,
      'CA_BUSINESS_LENDING',
    ));
    if (!record) return [];
    return [{
      series: record.series,
      label: record.label,
      loanType: 'any',
      countryCode: 'CA',
      region: 'Canada',
      kind: 'official_survey',
      valueBps: record.valueBps,
      asOf: record.asOf,
      asOfLabel: monthLabel(record.asOf),
      sourceName: 'Bank of Canada',
      // The Valet JSON endpoint is the fetch path; the borrower is sent to the
      // published table it comes from.
      sourceUrl: CA_BUSINESS_LENDING_SOURCE,
      retrievedAt: record.retrievedAt,
    }];
  }

  private async fetchBankOfCanada(
    observationKey: string,
    label: string,
    sourceUrl: string,
    series = observationKey,
  ): Promise<PublicRateRecord> {
    const response = await this.fetcher.fetch(sourceUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('Bank of Canada source unavailable.');
    const payload = await response.json() as { observations?: Array<Record<string, { v?: string } | string>> };
    const item = payload.observations?.at(-1);
    const date = typeof item?.d === 'string' ? item.d : null;
    const value = item?.[observationKey];
    const percent = typeof value === 'object' && value !== null ? value.v : null;
    if (!date || percent === undefined || percent === null) throw new Error('Bank of Canada response did not include a rate.');
    return publicRecord(series, label, percent, date, sourceUrl);
  }

  private async withCache(series: string, fetchFresh: () => Promise<PublicRateRecord>): Promise<PublicRateRecord | null> {
    try {
      const record = await fetchFresh();
      await this.repository.putRateCache(record);
      return record;
    } catch {
      const cached = await this.repository.getRateCache(series);
      if (!cached) return null;
      const age = Date.now() - new Date(cached.retrievedAt).getTime();
      return age <= MAX_FRESHNESS_MS ? { ...cached, status: 'cached' } : null;
    }
  }

  private async fetchSofr(): Promise<PublicRateRecord> {
    const response = await this.fetcher.fetch(SOFR_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('SOFR source unavailable.');
    const payload = await response.json() as { refRates?: Array<{ effectiveDate?: string; percentRate?: number | string }> };
    const item = payload.refRates?.[0];
    if (!item?.effectiveDate || item.percentRate === undefined) throw new Error('SOFR response did not include a rate.');
    return publicRecord('SOFR', 'Secured Overnight Financing Rate (SOFR)', item.percentRate, item.effectiveDate, SOFR_URL);
  }

  private async fetchTreasury5Year(): Promise<PublicRateRecord> {
    const response = await this.fetcher.fetch(TREASURY_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('Treasury source unavailable.');
    const xml = await response.text();
    const entries = [...xml.matchAll(/<m:NEW_DATE>([^<]+)<\/m:NEW_DATE>[\s\S]*?<m:BC_5YEAR>([^<]+)<\/m:BC_5YEAR>/g)];
    const item = entries.at(-1);
    if (!item?.[1] || !item[2]) throw new Error('Treasury response did not include a 5-year yield.');
    return publicRecord('TREASURY_5Y', 'U.S. Treasury daily par yield curve — 5-year', item[2], item[1].slice(0, 10), TREASURY_URL);
  }

  private async fetchFsaRates(): Promise<PublicRateRecord> {
    const response = await this.fetcher.fetch(FSA_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('FSA source unavailable.');
    const html = await response.text();
    const directRate = html.match(/(?:Farm Operating|Operating).*?(\d+(?:\.\d+)?)\s*%/is)?.[1];
    const date = html.match(/(?:effective|as of)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
    if (!directRate || !date) throw new Error('FSA page structure changed.');
    const asOf = new Date(date).toISOString().slice(0, 10);
    return publicRecord('FSA_DIRECT_RATES', 'USDA FSA direct-loan rate context', directRate, asOf, FSA_URL);
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * `2026-05-01` → `May 2026`. Parsed from the string rather than through
 * `Date`, so a monthly observation cannot slide into the previous month in a
 * negative-offset timezone.
 */
function monthLabel(asOf: string): string {
  const [year, month] = asOf.split('-');
  const name = MONTH_NAMES[Number(month) - 1];
  return name && year ? `${name} ${year}` : asOf;
}

function publicRecord(series: string, label: string, percent: number | string, asOf: string, sourceUrl: string): PublicRateRecord {
  return {
    source: sourceUrl,
    series,
    valueBps: new Decimal(percent).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    asOf,
    retrievedAt: new Date().toISOString(),
    status: 'fresh',
    sourceUrl,
    label,
  };
}
