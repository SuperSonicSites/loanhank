// The rate card refreshes itself (spec.md section 4).
//
// AgDirect republishes its equipment rate card monthly. The card used to be
// hand-transcribed into a migration, which made every month-end a manual
// ritual and a lapsed card the default state of the product. Now the worker
// fetches the page, parses the four band tables and the printed validity
// line, and writes the new card only after it passes the same guards the
// hand-entered seed passes plus a continuity check against the card it
// replaces. Anything unexpected is refused, archived for a person to look
// at, and reported; the old card simply stays lapsed, which is the honest
// abstention the verdict path already knows how to render.
//
// Read from the paper, never guessed: a rate that does not parse as a rate
// is a refusal, not a zero.

import type { Env } from './worker.js';
import type { BenchmarkRow } from '../finance/index.js';
import { parseMoneyToCents, parseRateToBps } from '../shared/schema.js';

export const AGDIRECT_RATES_URL = 'https://www.agdirect.com/rates';

/** The card as printed, before it is trusted. */
export interface CardRow {
  amountBand: string;
  amountMinCents: number;
  amountMaxCents: number | null;
  termBand: string;
  termMinMonths: number;
  termMaxMonths: number;
  rateBps: number;
  rateKind: 'fixed' | 'variable';
}

export interface ParsedCard {
  asOfDate: string;
  validThrough: string;
  rows: CardRow[];
}

export class CardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardParseError';
  }
}

/**
 * The largest month-to-month move in one cell that is still plausibly a
 * repriced card rather than a misread. Equipment cards move 25 to 50 bps
 * between months; a 300 bps jump is a decimal in the wrong place.
 */
export const MAX_CELL_MOVE_BPS = 300;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const stripTags = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** "$250,000 +" or "$100,000 - $249,999", in the seed's own label form. */
export function parseBandLabel(label: string): Pick<CardRow, 'amountBand' | 'amountMinCents' | 'amountMaxCents'> | null {
  const compact = label.replace(/\s+/g, '');
  const open = /^\$([\d,]+)\+$/.exec(compact);
  if (open) {
    const min = parseMoneyToCents(open[1] as string);
    return min === null ? null : { amountBand: `$${open[1]}+`, amountMinCents: min, amountMaxCents: null };
  }
  const closed = /^\$([\d,]+)-\$([\d,]+)$/.exec(compact);
  if (closed) {
    const min = parseMoneyToCents(closed[1] as string);
    const max = parseMoneyToCents(closed[2] as string);
    if (min === null || max === null || max <= min) return null;
    return { amountBand: `$${closed[1]}-$${closed[2]}`, amountMinCents: min, amountMaxCents: max };
  }
  return null;
}

/** "2 - 3 years" or "4 years", in the seed's own label form. */
export function parseTermLabel(label: string): Pick<CardRow, 'termBand' | 'termMinMonths' | 'termMaxMonths'> | null {
  const compact = label.replace(/\s+/g, '');
  const range = /^(\d+)-(\d+)years?$/i.exec(compact);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (high <= low) return null;
    return { termBand: `${low}-${high} years`, termMinMonths: low * 12, termMaxMonths: high * 12 };
  }
  const single = /^(\d+)years?$/i.exec(compact);
  if (single) {
    const years = Number(single[1]);
    return { termBand: `${years} years`, termMinMonths: years * 12, termMaxMonths: years * 12 };
  }
  return null;
}

/**
 * The page as AgDirect publishes it: one accordion item per amount band, a
 * term table inside each, and one "Rates effective <Month> 01-30 <year>"
 * sentence for the whole card. Every structural surprise throws; the
 * caller treats a throw as a refusal, never as an empty card.
 */
export function parseAgDirectCard(html: string): ParsedCard {
  const effective = /Rates effective\s+([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s+(\d{4})/i.exec(stripTags(html));
  if (effective === null) throw new CardParseError('no "Rates effective" sentence on the page');
  const month = MONTHS[(effective[1] as string).toLowerCase()];
  if (month === undefined) throw new CardParseError(`unreadable month: ${effective[1]}`);
  const year = Number(effective[4]);
  const mm = String(month).padStart(2, '0');
  const asOfDate = `${year}-${mm}-${String(Number(effective[2])).padStart(2, '0')}`;
  const validThrough = `${year}-${mm}-${String(Number(effective[3])).padStart(2, '0')}`;
  if (validThrough < asOfDate) throw new CardParseError(`validity ends before it starts: ${asOfDate} to ${validThrough}`);

  const rows: CardRow[] = [];
  const panels = html.matchAll(/id="accordion-item-(\d+)-button"[^>]*>([\s\S]*?)<\/button>[\s\S]*?id="accordion-item-\1-panel"[\s\S]*?<table>([\s\S]*?)<\/table>/g);
  for (const panel of panels) {
    const band = parseBandLabel(stripTags(panel[2] as string));
    if (band === null) throw new CardParseError(`unreadable amount band: ${stripTags(panel[2] as string)}`);
    const table = panel[3] as string;
    const header = stripTags((/<tr>([\s\S]*?)<\/tr>/.exec(table)?.[1]) ?? '');
    if (!/^Term Fixed Rate Variable Rate$/i.test(header)) throw new CardParseError(`unexpected table header: ${header}`);
    for (const row of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...(row[1] as string).matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) => stripTags(cell[1] as string));
      if (cells.length === 0) continue; // the header row
      if (cells.length !== 3) throw new CardParseError(`a rate row has ${cells.length} cells, not 3`);
      const term = parseTermLabel(cells[0] as string);
      if (term === null) throw new CardParseError(`unreadable term: ${cells[0]}`);
      const fixed = parseRateToBps(cells[1] as string);
      const variable = parseRateToBps(cells[2] as string);
      if (fixed === null || variable === null) throw new CardParseError(`unreadable rate in ${band.amountBand} ${term.termBand}`);
      rows.push({ ...band, ...term, rateBps: fixed, rateKind: 'fixed' });
      rows.push({ ...band, ...term, rateBps: variable, rateKind: 'variable' });
    }
  }
  if (rows.length === 0) throw new CardParseError('no rate tables found on the page');
  return { asOfDate, validThrough, rows };
}

const cellKey = (row: Pick<CardRow, 'amountBand' | 'termBand' | 'rateKind'>): string =>
  `${row.amountBand}|${row.termBand}|${row.rateKind}`;

/**
 * Why a parsed card must not be written. Empty means it may.
 *
 * The first block is the seed guard, the same laws tests/benchmark-seed
 * enforces on hand-typed rows. The second is continuity against the card
 * being replaced: same cells, and no cell moved further than a card ever
 * moves in a month. A brand new structure is a page redesign, and a page
 * redesign is a person's job to read, not a parser's.
 */
export type PreviousCell = Pick<BenchmarkRow, 'amountBand' | 'termBand' | 'rateKind' | 'rateBps'>;

export function cardProblems(card: ParsedCard, previous: PreviousCell[]): string[] {
  const problems: string[] = [];
  for (const row of card.rows) {
    if (row.rateBps <= 0 || row.rateBps >= 3_000) problems.push(`${cellKey(row)}: rate ${row.rateBps} bps looks like a unit error`);
  }
  const bands = [...new Map(card.rows.map((row) => [row.amountBand, row])).values()]
    .sort((a, b) => a.amountMinCents - b.amountMinCents);
  for (let index = 1; index < bands.length; index += 1) {
    const prior = bands[index - 1] as CardRow;
    const current = bands[index] as CardRow;
    if (prior.amountMaxCents === null || current.amountMinCents <= prior.amountMaxCents || current.amountMinCents - prior.amountMaxCents > 100) {
      problems.push(`bands ${prior.amountBand} and ${current.amountBand} leave a gap or overlap`);
    }
  }
  const keys = new Set(card.rows.map(cellKey));
  if (keys.size !== card.rows.length) problems.push('a band and term appears twice');

  if (previous.length > 0) {
    const before = new Map(previous.map((row) => [cellKey(row), row]));
    for (const key of before.keys()) {
      if (!keys.has(key)) problems.push(`the card lost a cell the last one had: ${key}`);
    }
    for (const row of card.rows) {
      const old = before.get(cellKey(row));
      if (old === undefined) {
        problems.push(`the card grew a cell the last one lacked: ${cellKey(row)}`);
      } else if (Math.abs(row.rateBps - old.rateBps) > MAX_CELL_MOVE_BPS) {
        problems.push(`${cellKey(row)} moved ${old.rateBps} to ${row.rateBps} bps, more than a card moves in a month`);
      }
    }
  }
  return problems;
}

const bandSlug = (row: CardRow): string => `${Math.round(row.amountMinCents / 100_000)}k`;
const termSlug = (row: CardRow): string =>
  row.termMinMonths === row.termMaxMonths
    ? `${row.termMinMonths / 12}y`
    : `${row.termMinMonths / 12}to${row.termMaxMonths / 12}y`;

export type RefreshOutcome =
  | { outcome: 'unchanged'; asOfDate: string }
  | { outcome: 'refreshed'; asOfDate: string; rows: number; snapshotKey: string }
  | { outcome: 'refused'; reasons: string[]; snapshotKey: string | null }
  | { outcome: 'unreachable'; detail: string };

async function recordOutcome(env: Env, outcome: RefreshOutcome): Promise<void> {
  const event = `benchmark_${outcome.outcome}`;
  await env.DB.prepare(
    'INSERT INTO events (id, event, decode_id, ts, meta_json, synthetic) VALUES (?, ?, NULL, ?, ?, 0)',
  ).bind(crypto.randomUUID(), event, new Date().toISOString(), JSON.stringify(outcome)).run();
}

/**
 * Fetch, parse, guard, archive, write. Idempotent: the same card twice is
 * "unchanged". Every outcome lands as an events row so the morning query
 * and the ops digest can see what happened without reading logs.
 */
export async function refreshBenchmarks(
  env: Env,
  today: string,
  fetcher: typeof fetch = fetch,
): Promise<RefreshOutcome> {
  const finish = async (outcome: RefreshOutcome): Promise<RefreshOutcome> => {
    await recordOutcome(env, outcome);
    return outcome;
  };

  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher(AGDIRECT_RATES_URL, {
        signal: controller.signal,
        headers: { 'user-agent': 'LoanHank benchmark snapshot (contact via www.loanhank.com/contact)' },
      });
      if (!response.ok) return finish({ outcome: 'unreachable', detail: `HTTP ${response.status}` });
      html = await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return finish({ outcome: 'unreachable', detail: error instanceof Error ? error.message : String(error) });
  }

  const previousRows = await env.DB.prepare(
    `SELECT amount_band, term_band, rate_kind, rate_bps, as_of_date
       FROM benchmarks
      WHERE tier = 1 AND source = 'AgDirect'
        AND as_of_date = (SELECT MAX(as_of_date) FROM benchmarks WHERE tier = 1 AND source = 'AgDirect')`,
  ).all<Record<string, string | number>>();
  const previous: PreviousCell[] = previousRows.results.map((row) => ({
    amountBand: String(row.amount_band),
    termBand: String(row.term_band),
    rateKind: String(row.rate_kind) === 'variable' ? 'variable' as const : 'fixed' as const,
    rateBps: Number(row.rate_bps),
  }));
  const previousAsOf = previousRows.results[0] === undefined ? null : String(previousRows.results[0].as_of_date);

  let card: ParsedCard;
  try {
    card = parseAgDirectCard(html);
  } catch (error) {
    const snapshotKey = `benchmarks/agdirect/refused-${today}.html`;
    await env.SNAPSHOTS.put(snapshotKey, html, { httpMetadata: { contentType: 'text/html' } });
    return finish({
      outcome: 'refused',
      reasons: [error instanceof Error ? error.message : String(error)],
      snapshotKey,
    });
  }

  if (previousAsOf !== null && card.asOfDate === previousAsOf) {
    return finish({ outcome: 'unchanged', asOfDate: card.asOfDate });
  }
  const reasons = cardProblems(card, previous);
  if (previousAsOf !== null && card.asOfDate < previousAsOf) {
    reasons.push(`the page shows an older card (${card.asOfDate}) than the one we hold (${previousAsOf})`);
  }
  if (reasons.length > 0) {
    const snapshotKey = `benchmarks/agdirect/refused-${today}.html`;
    await env.SNAPSHOTS.put(snapshotKey, html, { httpMetadata: { contentType: 'text/html' } });
    return finish({ outcome: 'refused', reasons, snapshotKey });
  }

  // Archive first, then write: a row must never point at a snapshot that
  // does not exist (spec.md section 4, the snapshot rule).
  const snapshotKey = `benchmarks/agdirect/${card.asOfDate}.html`;
  await env.SNAPSHOTS.put(snapshotKey, html, { httpMetadata: { contentType: 'text/html' } });

  const insert = env.DB.prepare(
    `INSERT INTO benchmarks (id, source, source_url, as_of_date, snapshot_key, amount_band,
                             amount_min_cents, amount_max_cents, term_band, term_min_months,
                             term_max_months, rate_bps, rate_kind, tier, country, valid_through)
     VALUES (?, 'AgDirect', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'US', ?)`,
  );
  await env.DB.batch(card.rows.map((row) => insert.bind(
    `agdirect-${card.asOfDate}-${bandSlug(row)}-${termSlug(row)}-${row.rateKind === 'variable' ? 'var' : 'fixed'}`,
    AGDIRECT_RATES_URL, card.asOfDate, snapshotKey, row.amountBand,
    row.amountMinCents, row.amountMaxCents, row.termBand, row.termMinMonths,
    row.termMaxMonths, row.rateBps, row.rateKind, card.validThrough,
  )));

  return finish({ outcome: 'refreshed', asOfDate: card.asOfDate, rows: card.rows.length, snapshotKey });
}

/**
 * Whether a lapsed card is worth trying to refresh right now. Once an hour
 * at most: a lapsed card with an unreachable source must not turn every
 * decode into a ten-second fetch against somebody else's website.
 */
export async function refreshDue(env: Env, now: Date = new Date()): Promise<boolean> {
  const last = await env.DB.prepare(
    `SELECT MAX(ts) AS ts FROM events
      WHERE event IN ('benchmark_unchanged', 'benchmark_refreshed', 'benchmark_refused', 'benchmark_unreachable')`,
  ).first<{ ts: string | null }>();
  if (last?.ts == null) return true;
  return now.getTime() - Date.parse(last.ts) > 60 * 60 * 1000;
}
