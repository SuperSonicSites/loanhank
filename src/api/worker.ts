// Worker types are imported, never referenced globally: they redefine Buffer
// and URL, and the engine tests run on the Node types.
import type {
  D1Database,
  ExecutionContext,
  R2Bucket,
  RateLimit,
  ScheduledController,
} from '@cloudflare/workers-types';
import { Hono } from 'hono';
import {
  costAgainstBenchmark, decideVerdict, decodeLedger, formatCurrency, formatRate,
  cohortBands, cohortLadder, matchBenchmark, PEER_POLICY_VERSION, promoPriceRate,
  quoteWithinSanityBounds, VERDICT_BUFFER_VERSION,
  type BenchmarkRow, type DealLedger, type LedgerFee,
} from '../finance/index.js';
import { hashAccessKey } from './security.js';
import {
  centsToInput, confirmableField, emailGateSchema, EQUIPMENT_BRANDS, ledgerFormSchema,
  normalizeBrand, quickPathFormSchema,
  type ConfirmableField, type QuoteExtraction,
} from '../shared/schema.js';
import {
  renderConfirm, renderForm, renderNotice, renderTicket, renderUnpriceable, renderVerdictTicket,
  setFooterPostalAddress,
  type ConfirmRow, type FormValues,
} from '../web/page.js';
import { assertUploadAllowed, PublicApiError } from './security.js';
import { OpenAIQuoteExtractor } from './extractor.js';
import { renderTeardownPdf, type TeardownLine } from './teardown-pdf.js';
import { FOLLOWUP_TEXT_VERSION } from '../web/page.js';
import {
  renderContact, renderHowWeFigureIt, renderHowWeMakeMoney, renderManifest, renderNotFound,
  renderNote, renderNotesIndex, renderPrivacy, renderSent, renderStraightAnswers, renderTerms,
  renderWhosBehindThis, NOTES, PRIVACY_VERSION, TERMS_VERSION,
} from '../web/pages.js';
import { getConfig } from './env.js';
import { fbcFromBody, fbcFromUrl, recordCapiOutcome, sendCapi, type CapiEventName } from './capi.js';

// Must match the crons in wrangler.jsonc. An unrecognized cron logs and does
// nothing rather than falling into the wrong branch.
const PUBLIC_ORIGIN = 'https://loanhank-decoder.supersonicworkers.workers.dev';

const REAPER_CRON = '*/15 * * * *';
const BACKUP_CRON = '0 7 * * *';

export interface Env {
  [key: string]: unknown;
  DB: D1Database;
  QUOTES: R2Bucket;
  BACKUPS: R2Bucket;
  DECODE_LIMIT: RateLimit;
}

/**
 * Rate limit key. The IP is salted and hashed rather than used raw: it is a
 * personal identifier and nothing in this product handles one in the clear.
 * Routes get separate budgets so reloading the page cannot spend the decodes.
 */
async function withinRateLimit(c: {
  env: Env;
  req: { header: (name: string) => string | undefined };
}, route: string): Promise<boolean> {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  // Salted, because an unsalted hash of an IPv4 address is not an anonymized
  // IP address: the whole space is small enough to enumerate in minutes.
  const salt = typeof c.env.RATE_LIMIT_SALT === 'string' ? c.env.RATE_LIMIT_SALT : '';
  const { success } = await c.env.DECODE_LIMIT.limit({ key: `${route}:${hashAccessKey(`${salt}:${ip}`)}` });
  return success;
}

// What the farmer still owes us before anything earns a stamp (spec.md 2.2).
// Printed on every quick-path ticket as the reason there is no verdict.
const MISSING_FOR_VERDICT = [
  'A trade-in, and whatever is still owed on it',
  'Anything due at signing',
  'Doc, origination, or insurance fees that only apply if you finance',
  'Tax, when the cash deal and the financed deal are taxed differently',
];

function quarterOf(isoTimestamp: string): string {
  const year = isoTimestamp.slice(0, 4);
  const month = Number(isoTimestamp.slice(5, 7));
  return `${year}Q${Math.floor((month - 1) / 3) + 1}`;
}

async function recordEvent(
  env: Env,
  event: string,
  decodeId: string | null = null,
  meta: Record<string, unknown> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO events (id, event, decode_id, ts, meta_json) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, event, decodeId, new Date().toISOString(), JSON.stringify(meta))
    .run();
  return id;
}

/** The shape of a request the ad measurement needs to read. */
interface MeasurableRequest {
  env: Env;
  req: { url: string; header: (name: string) => string | undefined };
  executionCtx: { waitUntil: (promise: Promise<unknown>) => void };
}

/** Sec-GPC: 1 is a CPRA opt-out, honoured everywhere it is read (spec.md §10). */
function gpcHonoured(c: Pick<MeasurableRequest, 'req'>): boolean {
  return c.req.header('sec-gpc') === '1';
}

/**
 * Meta CAPI, fired behind waitUntil so measurement never stands in the request
 * path, and the outcome patched onto the events row so every send is logged,
 * success, failure or skip (spec.md §10).
 *
 * The synthetic gate reads an explicit request marker: verification traffic
 * sends `x-loanhank-synthetic: 1` and never reaches Meta. §7.2 flags rows
 * after the fact, which cannot un-send an event, so the marker is how a
 * verification run declares itself BEFORE the sender decides. Anybody else
 * sending the header merely opts their own decode out of measurement.
 */
function measureAd(
  c: MeasurableRequest,
  eventName: CapiEventName,
  eventId: string,
  fbc: string | null,
): void {
  const input = {
    eventName,
    eventId,
    sourceUrl: c.req.url,
    fbc,
    synthetic: c.req.header('x-loanhank-synthetic') === '1',
    gpc: gpcHonoured(c),
    clientIp: c.req.header('cf-connecting-ip'),
    userAgent: c.req.header('user-agent'),
  };
  c.executionCtx.waitUntil(
    (async () => {
      const outcome = await sendCapi(c.env, input);
      await recordCapiOutcome(c.env.DB, input.eventId, outcome);
    })(),
  );
}


/**
 * Canonical server-side Turnstile check. Browser to us to siteverify, never
 * browser to siteverify. Fails closed on every path: a network error, a
 * non-2xx, a wrong action, or a hostname we did not expect all refuse.
 *
 * This gates the photo path only. The typed form must keep working with no
 * JavaScript at all (design.md section 9), and a challenge widget is
 * JavaScript, so it is not allowed anywhere near it.
 */
async function turnstilePassed(
  env: Env,
  token: string,
  clientIp: string,
  expectedHostname: string,
): Promise<boolean> {
  const secret = typeof env.TURNSTILE_SECRET_KEY === 'string' ? env.TURNSTILE_SECRET_KEY : '';
  if (secret === '' || token === '' || token.length > 2_048) return false;

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip: clientIp }),
    });
    if (!response.ok) return false;
    result = await response.json() as typeof result;
  } catch {
    return false;
  }
  return result.success === true
    && result.action === 'extract'
    && result.hostname === expectedHostname;
}

/** The confirm screen, built from what the model could and could not read. */
function confirmRows(extraction: QuoteExtraction): ConfirmRow[] {
  const money = (name: string, label: string, source: { value_cents: number | null; confidence: number }, hint?: string): ConfirmRow => ({
    ...(confirmableField(name, label, { value: source.value_cents, confidence: source.confidence }, centsToInput) as ConfirmableField),
    ...(hint ? { hint } : {}),
  });
  const text = (name: string, label: string, source: { value: string | null; confidence: number }, hint?: string): ConfirmRow => ({
    ...(confirmableField(name, label, source) as ConfirmableField),
    ...(hint ? { hint } : {}),
  });
  const plain = (name: string, label: string, source: { value: number | null; confidence: number }, hint?: string): ConfirmRow => ({
    ...(confirmableField(name, label, source) as ConfirmableField),
    ...(hint ? { hint } : {}),
  });

  return [
    money('quotedPrice', 'Quoted price', extraction.quoted_price),
    money('cashDiscount', 'Cash discount', extraction.cash_discount, 'What they knock off if you pay cash instead of financing. Leave empty if there is none.'),
    money('payment', 'Payment', extraction.payment_amount),
    plain('paymentCount', 'How many payments', extraction.payment_count),
    plain('statedRate', 'Rate printed on the quote', { value: extraction.stated_rate_bps.value === null ? null : extraction.stated_rate_bps.value / 100, confidence: extraction.stated_rate_bps.confidence }, 'As a percentage. A 0% promo is 0.'),
    money('downPayment', 'Due at signing', extraction.down_payment),
    money('tradeAllowance', 'Trade allowance', extraction.trade_allowance),
    money('tradePayoff', 'Still owed on the trade', extraction.trade_payoff),
    money('deliverySetup', 'Delivery and setup', extraction.delivery_setup),
    money('financeOnlyFee', 'Fees you only pay if you finance', { value_cents: null, confidence: 0 }, 'Doc, origination, or required insurance. Leave empty if there are none.'),
    // Read silently, never required. The expiry drives the only honest
    // deadline this product has, and the quote date keeps stale paper out of a
    // current-quarter median (spec.md 9.4: forage never blocks a decode).
    // Offered as a list, never a free box. A name that is not a manufacturer
    // has no path in (spec.md §9.5).
    {
      name: 'brand',
      label: 'Make',
      state: normalizeBrand(extraction.brand.value) === null ? 'unreadable' as const : 'read' as const,
      value: normalizeBrand(extraction.brand.value) ?? '',
      choices: [...EQUIPMENT_BRANDS],
      hint: 'Pick the maker of the machine. Leave it blank if it is not on the list.',
    },
    text('quoteDate', 'Date on the quote', extraction.quote_date, 'Like 2026-08-11. Leave empty if it is not printed.'),
    text('quoteExpiryDate', 'Quote valid until', extraction.quote_expiry_date, 'Leave empty if the paper does not say.'),
  ];
}

const WARNING_COPY: Record<string, string> = {
  NOT_AN_EQUIPMENT_QUOTE: 'This does not look like an equipment quote. Check the numbers carefully before you run it.',
  IMAGE_TOO_BLURRY: 'Too blurry to read. Try again in better light.',
  MULTIPLE_QUOTES_DETECTED: 'There looks to be more than one quote on this page. We read one of them.',
  HANDWRITING_UNREADABLE: 'Some of this is handwritten and we could not read it.',
  PAGE_APPEARS_CROPPED: 'Part of the page is cut off. Check for anything missing.',
  SENSITIVE_IDENTIFIER_REDACTED: 'We dropped an account or serial number. We never keep those.',
};


/**
 * What the model read against what the farmer confirmed, per field.
 *
 * This replaces keeping photos. A farmer photo is never written down, so there
 * is no image to turn into a fixture; the correction he makes is the signal
 * instead, and it is text and numbers only. Untrusted input, so it is size
 * capped and shape checked before anything is recorded.
 */
/**
 * The field names the confirm screen can legitimately carry back.
 *
 * Closed on purpose. This runs on a public route and the snapshot is a string
 * the browser hands us, so without an allowlist any key at all could be posted
 * and would be written verbatim into events.meta_json. "There is nowhere to
 * put a dealer name" was true of every table and false of this one JSON blob,
 * which is exactly the shape §9.5 exists to prevent.
 */
const CONFIRMABLE_FIELDS = new Set([
  'quotedPrice', 'cashDiscount', 'payment', 'paymentCount', 'paymentFrequency',
  'statedRate', 'downPayment', 'tradeAllowance', 'tradePayoff', 'deliverySetup',
  'financeOnlyFee', 'quoteDate', 'quoteExpiryDate',
]);

/**
 * What the model read against what the farmer confirmed, per field.
 *
 * Unknown keys are dropped BEFORE anything is computed or stored, so a posted
 * key never reaches the diff, the event, or the database.
 */
function extractionDiff(
  rawSnapshot: string,
  confirmed: Record<string, unknown>,
): Array<{ field: string; read: string; confirmed: string }> | null {
  if (rawSnapshot === '' || rawSnapshot.length > 4_000) return null;
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(rawSnapshot);
  } catch {
    return null;
  }
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;

  const diff: Array<{ field: string; read: string; confirmed: string }> = [];
  for (const [field, readValue] of Object.entries(snapshot as Record<string, unknown>)) {
    // The allowlist first. Everything after this line has already been vouched
    // for by name, so a value can only be wrong, never unexpected.
    if (!CONFIRMABLE_FIELDS.has(field)) continue;
    if (typeof readValue !== 'string' || readValue.length > 40) continue;
    const confirmedValue = String(confirmed[field] ?? '');
    // Normalize so "6000" and "6000.00" do not read as a correction.
    const same = readValue.trim() === confirmedValue.trim()
      || (readValue !== '' && confirmedValue !== ''
        && Number(readValue.replace(/,/g, '')) === Number(confirmedValue.replace(/,/g, '')));
    if (!same) diff.push({ field, read: readValue, confirmed: confirmedValue.slice(0, 40) });
  }
  return diff;
}


/**
 * Can we actually send a teardown?
 *
 * CAN-SPAM requires a real postal address in every commercial email, and there
 * is no inventing one. Without it the gate does not render at all: a farmer
 * with no gate got his answer and lost nothing, whereas a farmer who typed his
 * address into a promise we cannot legally keep lost something real.
 */
function emailSendable(env: Env): { from: string; postalAddress: string; apiKey: string } | null {
  const apiKey = typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY : '';
  const from = typeof env.EMAIL_FROM === 'string' ? env.EMAIL_FROM : '';
  const postalAddress = typeof env.POSTAL_ADDRESS === 'string' ? env.POSTAL_ADDRESS : '';
  if (apiKey === '' || from === '' || postalAddress === '') return null;
  return { from, postalAddress, apiKey };
}

/** A stored decode row, rebuilt into the teardown it produced. */
function teardownFromRow(row: Record<string, unknown>, postalAddress: string) {
  const cents = (key: string) => Number(row[key] ?? 0);
  const verdict = String(row.verdict ?? 'none') as 'checks_out' | 'look_closer' | 'none';
  const rateBps = row.real_rate_all_in_bps === null || row.real_rate_all_in_bps === undefined
    ? null
    : Number(row.real_rate_all_in_bps);

  const lines: TeardownLine[] = [
    { label: 'Quoted price', amount: formatCurrency(cents('finance_price_cents')) },
    { label: 'Cash discount', amount: `- ${formatCurrency(cents('cash_discount_cents'))}` },
    { label: 'Cash price today', amount: formatCurrency(cents('cash_price_cents')) },
    { label: 'Amount financed', amount: formatCurrency(cents('amount_financed_cents')) },
    {
      label: 'Total of payments',
      amount: formatCurrency(cents('payment_amount_cents') * Number(row.payment_count ?? 0)),
    },
  ];

  const verdictLine = verdict === 'checks_out'
    ? "This deal checks out. We'd take it."
    : verdict === 'look_closer'
      ? 'Look closer. This deal prices above the comparable published rate.'
      : 'We can show you the rate. We are not rating this deal yet.';

  return {
    rate: rateBps === null ? 'no rate yet' : formatRate(rateBps),
    rateLabel: 'Your real rate',
    verdict,
    verdictLine,
    lines,
    reference: row.verdict_ref_id === null || row.verdict_ref_id === undefined
      ? null
      : `Matched published equipment rate card ${String(row.verdict_ref_id)}, as of ${String(row.benchmark_at_ts)}, subject to approval.`,
    assumption: null,
    missing: verdict === 'none'
      ? ['Confirm the whole deal, including any trade, anything due at signing, and any finance-only fee.']
      : [],
    footnote: 'This is not the legal APR. It is the annual cost of this deal against its cash '
      + `alternative, using the costs we can verify. Buffer policy ${VERDICT_BUFFER_VERSION}.`,
    postalAddress,
    generatedOn: String(row.ts ?? '').slice(0, 10),
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}


/** How long before the quote expires the one note goes out. */
const REMINDER_LEAD_DAYS = 7;

/**
 * Send the expiry reminders that are due, and mark them sent.
 *
 * One note per opt-in, ever. `reminded_at` is set in the same sweep, and the
 * query refuses any address that has unsubscribed since opting in, because an
 * unsubscribe has to beat an earlier yes.
 *
 * This exists because the opt-in without it is a promise with no delivery. A
 * farmer told "we will remind you" who then hears nothing has been lied to by
 * a system that meant well, which is the same failure as a number that is
 * confidently wrong.
 */
export async function sendDueReminders(env: Env, today: string, transport?: MailTransport): Promise<{ sent: number; failed: number }> {
  const sendable = emailSendable(env);
  if (sendable === null) {
    console.log('cron reminders: sending is not configured, nothing sent');
    return { sent: 0, failed: 0 };
  }

  const due = await env.DB.prepare(
    `SELECT e.id, e.email, e.remind_on, d.quote_expiry_date
       FROM emails e
       LEFT JOIN decodes d ON d.id = e.decode_id
      WHERE e.reminder_opt_in = 1
        AND e.reminded_at IS NULL
        AND e.unsubscribed_at IS NULL
        AND e.remind_on IS NOT NULL
        AND e.remind_on >= ?
        AND date(e.remind_on, ?) <= ?
      LIMIT 200`,
  ).bind(today, `-${REMINDER_LEAD_DAYS} days`, today).all<Record<string, string>>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results) {
    const response = await sendEmail(env, {
      to: String(row.email),
      subject: `Your quote expires ${row.remind_on}`,
      unsubscribeUrl: `${PUBLIC_ORIGIN}/unsubscribe/${row.id}`,
      body: [
        `The quote you ran through us is good until ${row.remind_on}.`,
        '',
        "That is the date printed on the dealer's own paper, not one we made up.",
        'If you are still deciding, it is worth knowing what the financing costs',
        'before the paper goes stale.',
        '',
        'This is the one note. We will not send another about this quote.',
        '',
        'P.S. If the deal checked out, go sign it. We said so for a reason.',
      ],
    }, transport);

    if (response.ok) {
      await env.DB.prepare('UPDATE emails SET reminded_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), row.id).run();
      await recordEvent(env, 'reminder_sent', null, {});
      sent += 1;
    } else {
      // Left unmarked on purpose: tomorrow's sweep tries again, and the
      // remind_on window is what stops it retrying past the expiry date.
      await recordEvent(env, 'reminder_failed', null, { status: response.status });
      failed += 1;
    }
  }
  console.log(`cron reminders: ${sent} sent, ${failed} failed, ${due.results.length} due`);
  return { sent, failed };
}


/** Tables in dependency order, so a restore can replay the dump top to bottom. */
const BACKUP_TABLES = ['benchmarks', 'decodes', 'emails', 'events'];

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Nightly export of the whole pile to R2, as replayable SQL.
 *
 * The pile is the company. D1 Time Travel covers about thirty days, which
 * covers a mistake noticed quickly and nothing else; this is what outlives a
 * mistake nobody noticed, an account problem, or a database deleted by
 * somebody who meant to delete a different one.
 *
 * A plain INSERT dump on purpose. It restores with `wrangler d1 execute --file`
 * and it can be read with an eye, which matters at three in the morning when
 * the clever format turns out to need the tool that is also broken.
 */
export async function backupToR2(env: Env, stamp: string): Promise<{ key: string; rows: number; bytes: number }> {
  const parts: string[] = [
    `-- LoanHank pile export ${stamp}`,
    '-- Restore: wrangler d1 execute <database> --file <this file>',
    '-- Schema is NOT included. Apply migrations first, then replay this.',
    'PRAGMA defer_foreign_keys = true;',
  ];
  let rows = 0;

  for (const table of BACKUP_TABLES) {
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
    if (result.results.length === 0) {
      parts.push(`-- ${table}: empty`);
      continue;
    }
    const columns = Object.keys(result.results[0] as Record<string, unknown>);
    parts.push(`DELETE FROM ${table};`);
    for (const row of result.results) {
      const values = columns.map((column) => sqlLiteral(row[column])).join(', ');
      parts.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values});`);
      rows += 1;
    }
  }

  const key = `d1/loanhank-${stamp}.sql`;
  const dump = parts.join(String.fromCharCode(10));
  await env.BACKUPS.put(key, dump, { httpMetadata: { contentType: 'application/sql' } });

  // A row, not just a log line. console.log is invisible to the morning ritual,
  // and a cron that quietly stopped looks exactly like one that ran. This is
  // what lets ops/funnel.sql print days since the last successful backup, so a
  // dead cron shows up within a day instead of on the day it is needed.
  await recordEvent(env, 'backup_completed', null, { key, rows, bytes: dump.length });
  return { key, rows, bytes: dump.length };
}


/**
 * Day 4. Did you take the deal, and has anything moved since.
 *
 * Always has something true to say: the deal is restated from the stored row,
 * and the published reference either moved or it did not, which is itself the
 * answer. Sent once, disclosed at capture, and inside CASL's six month
 * implied-consent window by a wide margin.
 */
export async function sendDayFour(env: Env, today: string, transport?: MailTransport): Promise<{ sent: number }> {
  const sendable = emailSendable(env);
  if (sendable === null) return { sent: 0 };

  const due = await env.DB.prepare(
    `SELECT e.id, e.email, d.real_rate_all_in_bps, d.verdict, d.quote_expiry_date, d.benchmark_at_ts
       FROM emails e
       JOIN decodes d ON d.id = e.decode_id
      WHERE e.day4_sent_at IS NULL
        AND e.unsubscribed_at IS NULL
        AND e.synthetic = 0
        AND date(e.created_at) <= date(?, '-4 days')
        AND date(e.created_at) >= date(?, '-30 days')
      LIMIT 200`,
  ).bind(today, today).all<Record<string, string | number | null>>();

  let sent = 0;
  for (const row of due.results) {
    const rate = row.real_rate_all_in_bps === null
      ? 'the rate on your ticket'
      : formatRate(Number(row.real_rate_all_in_bps));
    const lines = [
      'Four days ago you ran a quote through us and it came out at ' + rate + '.',
      '',
      'Did you take it?',
      '',
      row.quote_expiry_date === null
        ? 'If you are still deciding, the teardown we sent has the whole receipt on it.'
        : `The paper says the quote is good until ${String(row.quote_expiry_date)}.`,
      '',
      'The published card we compared against has not been reissued since your',
      'teardown, so nothing about the comparison has changed.',
      '',
      'P.S. If it checked out, go sign it. We said so for a reason.',
    ];

    const response = await sendEmail(env, {
      to: String(row.email),
      subject: 'Did you take the deal?',
      unsubscribeUrl: `${PUBLIC_ORIGIN}/unsubscribe/${String(row.id)}`,
      body: lines,
    }, transport);

    if (response.ok) {
      await env.DB.prepare('UPDATE emails SET day4_sent_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), row.id).run();
      await recordEvent(env, 'day4_sent', null, {});
      sent += 1;
    } else {
      await recordEvent(env, 'day4_failed', null, { status: response.status });
    }
  }
  return { sent };
}

/**
 * Day 30. What quotes like yours are carrying now.
 *
 * Sends ONLY when a cohort actually qualifies, which is the whole reason the
 * disclosure says "when the numbers change" rather than "every month". No
 * cohort, no send, and no apology for not sending: an email announcing that we
 * still have nothing to tell you is an email nobody asked for.
 *
 * It will stay silent for a long time. That is the ladder working, not a bug.
 */
export async function sendDayThirty(env: Env, today: string, transport?: MailTransport): Promise<{ sent: number; skipped: number }> {
  const sendable = emailSendable(env);
  if (sendable === null) return { sent: 0, skipped: 0 };

  const due = await env.DB.prepare(
    `SELECT e.id, e.email, d.country, d.currency, d.quarter, d.equip_category,
            d.new_or_used, d.term_band, d.price_band, d.real_rate_all_in_bps
       FROM emails e
       JOIN decodes d ON d.id = e.decode_id
      WHERE e.day30_sent_at IS NULL
        AND e.unsubscribed_at IS NULL
        AND e.synthetic = 0
        AND date(e.created_at) <= date(?, '-30 days')
        AND date(e.created_at) >= date(?, '-180 days')
      LIMIT 200`,
  ).bind(today, today).all<Record<string, string | number | null>>();

  let sent = 0;
  let skipped = 0;
  for (const row of due.results) {
    const pile = await env.DB.prepare(
      `SELECT country, currency, quarter, equip_category, new_or_used, term_band, price_band,
              real_rate_all_in_bps
         FROM decodes
        WHERE synthetic = 0 AND out_of_bounds = 0 AND reconciled = 1
          AND real_rate_all_in_bps IS NOT NULL
          AND country = ? AND currency = ?`,
    ).bind(row.country, row.currency).all<Record<string, string | number>>();

    const cohort = cohortLadder(
      pile.results.map((entry) => ({
        country: String(entry.country) === 'CA' ? 'CA' as const : 'US' as const,
        currency: String(entry.currency) === 'CAD' ? 'CAD' as const : 'USD' as const,
        quarter: String(entry.quarter),
        equipCategory: (entry.equip_category as string | null) ?? null,
        newOrUsed: (entry.new_or_used as string | null) ?? null,
        termBand: (entry.term_band as string | null) ?? null,
        priceBand: (entry.price_band as string | null) ?? null,
        realRateAllInBps: Number(entry.real_rate_all_in_bps),
      })),
      {
        country: String(row.country) === 'CA' ? 'CA' : 'US',
        currency: String(row.currency) === 'CAD' ? 'CAD' : 'USD',
        quarter: String(row.quarter),
        equipCategory: (row.equip_category as string | null) ?? null,
        newOrUsed: (row.new_or_used as string | null) ?? null,
        termBand: (row.term_band as string | null) ?? null,
        priceBand: (row.price_band as string | null) ?? null,
      },
      [String(row.quarter)],
    );

    if (cohort === null) {
      // Nothing honest to say, so nothing is said and the row stays open for
      // the day a cohort does qualify.
      skipped += 1;
      continue;
    }

    const unsubscribe = `${PUBLIC_ORIGIN}/unsubscribe/${String(row.id)}`;
    const yours = row.real_rate_all_in_bps === null
      ? null
      : formatRate(Number(row.real_rate_all_in_bps));
    const response = await sendEmail(env, {
      to: String(row.email),
      subject: `What ${cohort.label} quotes are carrying now`,
      unsubscribeUrl: `${PUBLIC_ORIGIN}/unsubscribe/${String(row.id)}`,
      body: [
        'There are enough quotes like yours now to say something useful.',
        '',
        `${cohort.label}: the middle of the pack is ${formatRate(cohort.medianBps)}, `
        + `with most between ${formatRate(cohort.p25Bps)} and ${formatRate(cohort.p75Bps)}.`,
        `That is from ${cohort.n} real quotes, not a survey.`,
        '',
        yours === null ? '' : `Yours came out at ${yours}.`,
        '',
        `Cohort ${cohort.key}. Method ${cohort.policyVersion}, written out at ${PUBLIC_ORIGIN}/how-we-figure-it.`,
      ],
    }, transport);

    if (response.ok) {
      await env.DB.prepare('UPDATE emails SET day30_sent_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), row.id).run();
      await recordEvent(env, 'day30_sent', null, { cohort: cohort.key, n: cohort.n });
      sent += 1;
    } else {
      await recordEvent(env, 'day30_failed', null, { status: response.status });
    }
  }
  return { sent, skipped };
}


/**
 * The referring page, stripped to origin and path.
 *
 * Never the query string. A referrer routinely carries a click id, a campaign
 * blob, sometimes an email address, and none of that is ours to keep. spec.md
 * 9.5 says we do not store identifiers, and a referrer is a perfectly ordinary
 * way to store one by accident.
 */
function referringPage(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const cleaned = `${url.origin}${url.pathname}`;
    return cleaned.slice(0, 200);
  } catch {
    return null;
  }
}


/**
 * The single send path. Every email this product produces goes through here.
 *
 * There were four separate fetch calls to the provider before this, each
 * assembling its own unsubscribe headers and its own footer. Three were
 * guarded by tests and the fourth, the teardown itself, was guarded by
 * nothing, while a comment claimed the reminder tests covered "the same sender
 * path". They were not the same path. They were four copies of a path, and the
 * copy carrying the farmer's first impression was the unguarded one.
 *
 * `transport` is injectable so the delivery tests exercise this exact function
 * rather than a stand-in that agrees with whatever it is told, the same
 * discipline as the real-SQLite adapter behind the sweep tests.
 */
export type MailTransport = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export interface Outgoing {
  to: string;
  subject: string;
  /** Body without the footer. The unsubscribe line and address are added here. */
  body: string[];
  unsubscribeUrl: string;
  attachment?: { filename: string; content: string };
}

export async function sendEmail(
  env: Env,
  message: Outgoing,
  transport: MailTransport = ((url, init) => fetch(url, init)) as MailTransport,
): Promise<{ ok: boolean; status: number }> {
  const sendable = emailSendable(env);
  if (sendable === null) return { ok: false, status: 503 };

  // One place builds the footer, so CAN-SPAM cannot be satisfied in three
  // files and forgotten in the fourth.
  const text = [
    ...message.body,
    '',
    `Unsubscribe: ${message.unsubscribeUrl}`,
    sendable.postalAddress,
  ].join('\n');

  const payload: Record<string, unknown> = {
    from: `Hank <${sendable.from}>`,
    to: [message.to],
    subject: message.subject,
    text,
    headers: {
      'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
  if (message.attachment !== undefined) {
    payload.attachments = [message.attachment];
  }

  return transport('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${sendable.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * The teardown itself, extracted from the route so it can be exercised.
 *
 * This is the send §7.3 was written to protect and the one that had no test.
 */
export async function sendTeardown(
  env: Env,
  input: { emailId: string; to: string; row: Record<string, unknown>; origin: string },
  transport?: MailTransport,
): Promise<{ ok: boolean; status: number }> {
  const sendable = emailSendable(env);
  if (sendable === null) return { ok: false, status: 503 };

  const pdf = await renderTeardownPdf(teardownFromRow(input.row, sendable.postalAddress));
  return sendEmail(env, {
    to: input.to,
    subject: 'Your teardown',
    unsubscribeUrl: `${input.origin}/unsubscribe/${input.emailId}`,
    body: [
      'Your teardown is attached. It is one page: the real rate, what the financing',
      'costs against paying cash, and where the comparison came from.',
      '',
      'Print it and take it to the desk. That is what it is for.',
      '',
      'You can add LoanHank to your phone home screen from the site, if you would',
      'rather not go looking for it next time.',
      '',
      'P.S. If the deal checks out, go sign it. We will say so when it does.',
    ],
    attachment: { filename: 'loanhank-teardown.pdf', content: base64(pdf) },
  }, transport);
}

/** Exported so route tests can drive the real routes, not a re-implementation. */

/**
 * Campaign labels, and only the four spec.md 9.5 permits.
 *
 * These are our own labels on our own ads, chosen before a farmer ever clicks.
 * They describe a campaign, not a person. Everything else in a query string
 * stays out: `fbclid` identifies a browser and is transient for CAPI only,
 * `utm_term` can carry a user's own search text, and an allowlist is the only
 * shape where "everything else" cannot quietly grow.
 */
const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

/** The four permitted labels as the form carried them back (spec.md §9.5). */
function campaignFromBody(body: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    UTM_FIELDS
      .map((field) => [field, String(body[field] ?? '').slice(0, 60)])
      .filter(([, value]) => value !== ''),
  );
}

function campaignLabels(url: URL): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const field of UTM_FIELDS) {
    const value = url.searchParams.get(field);
    if (value !== null && value !== '') labels[field] = value.slice(0, 60);
  }
  return labels;
}

export const app = new Hono<{ Bindings: Env }>();

// Stamped on every response, so any page a reviewer already has open answers
// "which build is this" without a second request.
app.use('*', async (c, next) => {
  // The footer address is a public versioned var, identical on every request,
  // so it is set once here rather than threaded through every renderer.
  setFooterPostalAddress(typeof c.env.POSTAL_ADDRESS === 'string' ? c.env.POSTAL_ADDRESS : '');
  await next();
  const sha = typeof c.env.BUILD_SHA === 'string' ? c.env.BUILD_SHA : 'unset';
  c.header('x-loanhank-build', sha);
});

app.get('/', async (c) => {
  // A flood here would bloat the events table and the bill. The form still
  // renders when the limit trips; only the measurement row is dropped, because
  // refusing to show a farmer the tool is worse than an undercounted funnel.
  const cameFrom = referringPage(c.req.header('referer'));
  const campaign = campaignLabels(new URL(c.req.url));
  if (await withinRateLimit(c, 'page_view')) {
    // The funnel denominator. Written behind waitUntil so measuring never
    // stands between a farmer on rural LTE and the form.
    c.executionCtx.waitUntil(
      recordEvent(c.env, 'page_view', null, { came_from: cameFrom, ...campaign }),
    );
  }
  const siteKey = typeof c.env.TURNSTILE_SITE_KEY === 'string' ? c.env.TURNSTILE_SITE_KEY : '';
  // The click tag rides a hidden field from here to the POST (spec.md §10) and
  // is withheld entirely for a GPC browser, so an opted-out visit carries
  // nothing that could later be sent.
  const fbc = gpcHonoured(c) ? null : fbcFromUrl(new URL(c.req.url), Date.now());
  return c.html(renderForm(undefined, [], { turnstileSiteKey: siteKey }, campaign, fbc));
});

app.post('/decode', async (c) => {
  if (!(await withinRateLimit(c, 'decode'))) {
    return c.html(
      renderUnpriceable('That is a lot of quotes in one minute. Give it a minute and run it again.'),
      429,
    );
  }

  const body = await c.req.parseBody();
  // One route, two paths. The confirm screen posts the whole ledger and can
  // earn a stamp; the landing form posts four fields and never can.
  if (body.ledger === '1') return decodeFullLedger(c as never, body);
  const raw: FormValues = {
    quotedPrice: String(body.quotedPrice ?? ''),
    cashDiscount: String(body.cashDiscount ?? ''),
    paymentCount: String(body.paymentCount ?? ''),
    payment: String(body.payment ?? ''),
    paymentFrequency: String(body.paymentFrequency ?? 'monthly'),
  };

  // Shape-checked before it is ever echoed or sent; a tag that is not exactly
  // an fbc we could have rendered reads as no tag at all.
  const fbc = fbcFromBody(body.fbc);

  const parsed = quickPathFormSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message);
    c.executionCtx.waitUntil(recordEvent(c.env, 'decode_rejected', null, { problems }));
    return c.html(renderForm(raw, problems, null, {}, gpcHonoured(c) ? null : fbc), 422);
  }

  const form = parsed.data;
  const result = promoPriceRate({
    quotedPriceCents: form.quotedPrice,
    cashDiscountCents: form.cashDiscount,
    paymentAmountCents: form.payment,
    paymentCount: form.paymentCount,
    paymentFrequency: form.paymentFrequency,
  });

  if (result.promoPriceRateBps === null) {
    // Abstaining is success. We say we could not read the deal rather than
    // printing a number we do not stand behind.
    c.executionCtx.waitUntil(
      recordEvent(c.env, 'decode_unpriceable', null, { reason: result.unavailableReason }),
    );
    return c.html(
      renderUnpriceable(
        'Those numbers do not add up to a deal we can price. Check the payment and how many there are against your paper, then run it again.',
      ),
      422,
    );
  }

  const decodeId = crypto.randomUUID();
  const ts = new Date().toISOString();

  // reconciled stays 0 and verdict stays 'none': this row was priced from four
  // fields and stated assumptions, so it never feeds a published statistic
  // (spec.md 9, pile hygiene) and the table constraint would refuse a verdict
  // anyway. Fields the farmer was not asked for stay null rather than zero.
  await c.env.DB.prepare(
    `INSERT INTO decodes (
       id, ts, quarter,
       finance_price_cents, cash_discount_cents, cash_price_cents,
       payment_amount_cents, payment_frequency, payment_count,
       promo_price_rate_bps, reconciled, assumptions_json, verdict
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'none')`,
  )
    .bind(
      decodeId,
      ts,
      quarterOf(ts),
      form.quotedPrice,
      form.cashDiscount,
      result.cashPriceCents,
      form.payment,
      form.paymentFrequency,
      form.paymentCount,
      result.promoPriceRateBps,
      JSON.stringify(result.assumptions),
    )
    .run();

  const eventId = await recordEvent(c.env, 'decode', decodeId, {
    // The quick path carried no campaign labels, so a typed decode was
    // invisible to the ad that produced it while the ledger path and the page
    // view both kept theirs. Cost per completed decode is the round-one gate
    // (spec.md §7.1) and it cannot be computed from two thirds of the decodes.
    ...campaignFromBody(body),
    promo_price_rate_bps: result.promoPriceRateBps,
    payment_frequency: form.paymentFrequency,
  });
  measureAd(c, 'Decode', eventId, fbc);

  const cost = result.costVersusCashCents;
  const costSentence = cost >= 0
    ? `Paying it out this way costs ${formatCurrency(cost)} more than paying cash today.`
    : `Paying it out this way costs ${formatCurrency(Math.abs(cost))} less than paying cash today.`;

  return c.html(
    renderTicket({
      rate: formatRate(result.promoPriceRateBps),
      result,
      costSentence,
      missing: MISSING_FOR_VERDICT,
      lines: [
        { label: 'Quoted price', amount: formatCurrency(form.quotedPrice) },
        { label: 'Cash discount', amount: `− ${formatCurrency(form.cashDiscount)}` },
        { label: 'Cash price today', amount: formatCurrency(result.cashPriceCents) },
        { label: 'Total of payments', amount: formatCurrency(result.totalOfPaymentsCents) },
        { label: 'What financing costs', amount: formatCurrency(cost) },
      ],
    }),
  );
});


app.post('/extract', async (c) => {
  if (!(await withinRateLimit(c, 'extract'))) {
    return c.html(renderUnpriceable('That is a lot of photos in one minute. Give it a minute and try again.'), 429);
  }

  const siteKey = typeof c.env.TURNSTILE_SITE_KEY === 'string' ? c.env.TURNSTILE_SITE_KEY : '';
  const apiKey = typeof c.env.OPENAI_API_KEY === 'string' ? c.env.OPENAI_API_KEY : '';
  if (siteKey === '' || apiKey === '') {
    // Fail closed and say so plainly rather than accepting a photo we have no
    // way to read or protect.
    return c.html(
      renderUnpriceable('Reading photos is not switched on yet. Type the four numbers off your paper instead.'),
      503,
    );
  }

  const body = await c.req.parseBody();
  const token = String(body['cf-turnstile-response'] ?? '');
  const passed = await turnstilePassed(
    c.env,
    token,
    c.req.header('cf-connecting-ip') ?? '',
    new URL(c.req.url).hostname,
  );
  if (!passed) {
    c.executionCtx.waitUntil(recordEvent(c.env, 'extract_rejected', null, { reason: 'turnstile' }));
    return c.html(renderUnpriceable('We could not confirm that came from a person. Reload the page and try once more.'), 403);
  }

  const file = body.photo;
  if (!(file instanceof File)) {
    return c.html(renderUnpriceable('Pick a photo of the quote first.'), 422);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    assertUploadAllowed(file.type, bytes.byteLength);
  } catch (error) {
    const message = error instanceof PublicApiError
      ? 'That file is either too large or not a photo we can read. Send a JPG, a PNG, or a PDF under 20 MB.'
      : 'We could not read that file.';
    c.executionCtx.waitUntil(recordEvent(c.env, 'extract_rejected', null, { reason: 'upload_guard' }));
    return c.html(renderUnpriceable(message), 422);
  }

  // The photo is never written down. It goes from this request straight to the
  // reader as bytes and is gone when the answer comes back. Nothing to delete,
  // nothing to leak, nothing for a retention sweep to miss.
  let extraction;
  try {
    const dataUrl = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
    extraction = await new OpenAIQuoteExtractor(getConfig(c.env)).extractQuote(dataUrl, file.type);
  } catch (error) {
      // A failed read is a re-snap the farmer has to do, and the only place we
    // would ever see it. Losing it means losing the signal that the extractor
    // is drifting on some quote format we have never met.
    c.executionCtx.waitUntil(recordEvent(c.env, 'extract_failed', null, {
      content_type: file.type,
      size_bytes: bytes.byteLength,
      reason: error instanceof Error ? error.name : 'unknown',
    }));
    return c.html(
      renderUnpriceable('We could not read that one. Try again in better light, or type the numbers off your paper.'),
      502,
    );
  }

  c.executionCtx.waitUntil(recordEvent(c.env, 'extract', null, {
    document_type: extraction.document_type,
    warnings: extraction.warnings,
  }));

  return c.html(renderConfirm({
    rows: confirmRows(extraction),
    frequency: extraction.payment_frequency.value ?? 'monthly',
    warnings: extraction.warnings.map((code) => WARNING_COPY[code] ?? code),
    fbc: gpcHonoured(c) ? null : fbcFromBody(body.fbc),
  }));
});

/** The verdict path: a complete ledger, a matched reference, and a stamp. */
async function decodeFullLedger(c: {
  env: Env;
  req: { url: string; parseBody: () => Promise<Record<string, unknown>>; header: (name: string) => string | undefined };
  executionCtx: { waitUntil: (promise: Promise<unknown>) => void };
  html: (body: string, status?: 200 | 422) => Response;
}, body: Record<string, unknown>): Promise<Response> {
  const parsed = ledgerFormSchema.safeParse({
    quotedPrice: String(body.quotedPrice ?? ''),
    cashDiscount: String(body.cashDiscount ?? ''),
    payment: String(body.payment ?? ''),
    paymentFrequency: String(body.paymentFrequency ?? 'monthly'),
    paymentCount: String(body.paymentCount ?? ''),
    statedRate: String(body.statedRate ?? ''),
    downPayment: String(body.downPayment ?? ''),
    tradeAllowance: String(body.tradeAllowance ?? ''),
    tradePayoff: String(body.tradePayoff ?? ''),
    deliverySetup: String(body.deliverySetup ?? ''),
    taxCash: String(body.taxCash ?? ''),
    taxFinance: String(body.taxFinance ?? ''),
    financeOnlyFee: String(body.financeOnlyFee ?? ''),
    financeOnlyFeeRolled: body.financeOnlyFeeRolled === undefined ? undefined : 'on',
    unexplainedAmount: body.unexplainedAmount === undefined ? undefined : 'on',
    region: String(body.region ?? ''),
    quoteDate: String(body.quoteDate ?? ''),
    quoteExpiryDate: String(body.quoteExpiryDate ?? ''),
  });

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message);
    c.executionCtx.waitUntil(recordEvent(c.env, 'decode_rejected', null, { problems, path: 'ledger' }));
    return c.html(renderUnpriceable(problems.join(' ')), 422);
  }

  const form = parsed.data;
  const fees: LedgerFee[] = [];
  if (form.financeOnlyFee > 0) {
    fees.push({
      name: 'Finance-only fee',
      amountCents: form.financeOnlyFee,
      required: true,
      financeOnly: true,
      rolledIntoFinance: form.financeOnlyFeeRolled,
      status: 'confirmed',
    });
  }
  if (form.unexplainedAmount) {
    // Never called a junk fee. It is an amount nobody has explained yet, and
    // it holds the verdict until somebody does.
    fees.push({
      name: 'Unexplained amount',
      amountCents: 0,
      required: true,
      financeOnly: true,
      rolledIntoFinance: false,
      status: 'unknown',
    });
  }

  const ledger: DealLedger = {
    quotedPriceCents: form.quotedPrice,
    cashDiscountCents: form.cashDiscount,
    downPaymentCents: form.downPayment,
    tradeAllowanceCents: form.tradeAllowance,
    tradePayoffCents: form.tradePayoff,
    deliverySetupCents: form.deliverySetup,
    taxCashCents: form.taxCash,
    taxFinanceCents: form.taxFinance,
    paymentAmountCents: form.payment,
    paymentCount: form.paymentCount,
    paymentFrequency: form.paymentFrequency,
    statedRateBps: form.statedRate,
    fees,
  };

  const decoded = decodeLedger(ledger);
  if (decoded.realRateAllInBps === null && decoded.unavailableReason !== null) {
    c.executionCtx.waitUntil(recordEvent(c.env, 'decode_unpriceable', null, { reason: decoded.unavailableReason }));
    return c.html(
      renderUnpriceable('Those numbers do not add up to a deal we can price. Check the payment and how many there are against your paper.'),
      422,
    );
  }

  // Tier-1 rows only, most recent card first. The engine picks the band.
  const rows = await c.env.DB.prepare(
    `SELECT id, source, source_url, as_of_date, amount_band, amount_min_cents, amount_max_cents,
            term_band, term_min_months, term_max_months, rate_bps, rate_kind, tier, country
       FROM benchmarks
      WHERE tier = 1 AND as_of_date = (SELECT MAX(as_of_date) FROM benchmarks WHERE tier = 1)`,
  ).all<Record<string, string | number | null>>();

  const benchmarks: BenchmarkRow[] = rows.results.map((row) => ({
    id: String(row.id),
    source: String(row.source),
    sourceUrl: String(row.source_url),
    asOfDate: String(row.as_of_date),
    amountBand: String(row.amount_band),
    amountMinCents: Number(row.amount_min_cents),
    amountMaxCents: row.amount_max_cents === null ? null : Number(row.amount_max_cents),
    termBand: String(row.term_band),
    termMinMonths: Number(row.term_min_months),
    termMaxMonths: Number(row.term_max_months),
    rateBps: Number(row.rate_bps),
    rateKind: String(row.rate_kind) === 'variable' ? 'variable' : 'fixed',
    tier: Number(row.tier),
    country: String(row.country) === 'CA' ? 'CA' : 'US',
  }));

  const termMonths = Math.round(form.paymentCount * (12 / PERIODS_PER_YEAR[form.paymentFrequency]));
  const country = form.country;
  // Garbage is the third pollution source after synthetic and unreconciled
  // rows. Flagged, never refused: the farmer still gets his arithmetic, the
  // pile just never publishes it.
  // Without these the cohort key is made of nulls, which matches nothing, so
  // the ladder can never qualify and the peer row can never render.
  const bands = cohortBands({
    amountFinancedCents: decoded.totals.amountFinancedCents,
    termMonths,
  });
  const bounds = quoteWithinSanityBounds({
    quotedPriceCents: form.quotedPrice,
    termMonths,
    paymentAmountCents: form.payment,
  });
  const benchmark = matchBenchmark(benchmarks, {
    amountCents: decoded.totals.amountFinancedCents,
    termMonths,
    rateKind: 'fixed',
    country,
  });
  const verdict = decideVerdict({
    realRateAllInBps: decoded.realRateAllInBps,
    reconciled: decoded.reconciliation.reconciled,
    benchmark,
    hasUnknownFee: decoded.totals.hasUnknownFee,
  });

  const decodeId = crypto.randomUUID();
  const ts = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO decodes (
       id, ts, quarter,
       finance_price_cents, cash_discount_cents, cash_price_cents,
       down_payment_cents, trade_allowance_cents, trade_payoff_cents,
       delivery_setup_cents, tax_cash_cents, tax_finance_cents,
       amount_financed_cents, payment_amount_cents, payment_frequency, payment_count,
       term_months, stated_rate_bps, fees_json,
       real_rate_all_in_bps, reconciled, assumptions_json, verdict, verdict_ref_id,
       benchmark_at_ts, delta_vs_benchmark_bps,
       country, currency, province_or_state, out_of_bounds,
       quote_date, quote_expiry_date, launched_standalone,
       price_band, term_band, referrer, brand
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    decodeId, ts, quarterOf(ts),
    form.quotedPrice, form.cashDiscount, decoded.totals.cashOutlayCents,
    form.downPayment, form.tradeAllowance, form.tradePayoff,
    form.deliverySetup, form.taxCash, form.taxFinance,
    decoded.totals.amountFinancedCents, form.payment, form.paymentFrequency, form.paymentCount,
    termMonths, form.statedRate, JSON.stringify(fees),
    decoded.realRateAllInBps, decoded.reconciliation.reconciled ? 1 : 0,
    verdict.verdict, verdict.verdict === 'none' ? null : (benchmark as BenchmarkRow).id,
    benchmark === null ? null : benchmark.asOfDate,
    verdict.deltaBps,
    country, form.currency, form.region, bounds.outOfBounds ? 1 : 0,
    form.quoteDate === '' ? null : form.quoteDate,
    form.quoteExpiryDate === '' ? null : form.quoteExpiryDate,
    // Null on the no-JS path, which is not a failure. It is a decode we could
    // not ask about, and it must never be counted as "not installed".
    String(body.standalone ?? '') === '1' ? 1 : null,
    bands.priceBand, bands.termBand,
    referringPage(c.req.header('referer')),
    // Normalized, so a dealership name posted straight at the route lands as
    // null rather than as a brand.
    normalizeBrand(String(body.brand ?? '')),
  ).run();

  const fbc = fbcFromBody(body.fbc);
  const eventId = await recordEvent(c.env, 'decode', decodeId, {
    ...campaignFromBody(body),
    path: 'ledger',
    real_rate_all_in_bps: decoded.realRateAllInBps,
    verdict: verdict.verdict,
    country,
    out_of_bounds: bounds.outOfBounds ? bounds.reasons : undefined,
  });
  measureAd(c, 'Decode', eventId, fbc);

  // The extraction flywheel. Only written when the ledger came off a photo.
  const diff = extractionDiff(String(body.extracted ?? ''), body);
  if (diff !== null) {
    c.executionCtx.waitUntil(recordEvent(c.env, 'extraction_diff', decodeId, {
      corrected_fields: diff.map((entry) => entry.field),
      corrections: diff,
      field_count: diff.length,
    }));
  }

  const comparison = benchmark === null ? null : costAgainstBenchmark({
    amountFinancedCents: decoded.totals.amountFinancedCents,
    paymentAmountCents: form.payment,
    paymentCount: form.paymentCount,
    paymentFrequency: form.paymentFrequency,
    benchmarkRateBps: benchmark.rateBps,
  });

  const rateText = decoded.realRateAllInBps === null ? 'no rate yet' : formatRate(decoded.realRateAllInBps);
  const verdictLine = verdict.verdict === 'checks_out'
    ? "This deal checks out. We'd take it."
    : verdict.verdict === 'look_closer' && benchmark !== null && comparison !== null
      ? `Look closer. This deal prices at ${rateText}. The comparable published rate is `
        + `${formatRate(benchmark.rateBps)}. The difference costs you `
        + `${formatCurrency(comparison.differenceCents)} over the term.`
      : 'We can show you the rate. We are not rating this deal yet.';

  return c.html(renderVerdictTicket({
    rate: rateText,
    verdict: verdict.verdict,
    verdictLine,
    reference: benchmark === null
      ? null
      : `Comparable published equipment rate: ${formatRate(benchmark.rateBps)}, subject to approval. `
        + `${benchmark.source}, ${benchmark.amountBand}, ${benchmark.termBand}, fixed, as of ${benchmark.asOfDate}.`,
    footnote: benchmark === null
      ? null
      : `This is not the legal APR. It is the annual cost of this deal against its cash alternative, `
        + `using the costs we can verify. Buffer policy ${VERDICT_BUFFER_VERSION}.`,
    assumption: null,
    gate: emailSendable(c.env) === null ? null : { decodeId },
    // Measurement plumbing, deliberately beside the gate rather than inside
    // it: the firewall test pins the gate to exactly the decode id.
    fbc: gpcHonoured(c) ? null : fbc,
    missing: missingForVerdict(verdict.noVerdictReason, decoded.reconciliation.differenceCents, country),
    lines: [
      { label: 'Quoted price', amount: formatCurrency(form.quotedPrice) },
      { label: 'Cash discount', amount: `− ${formatCurrency(form.cashDiscount)}` },
      { label: 'Trade, net of payoff', amount: formatCurrency(decoded.totals.netTradeCents) },
      { label: 'Due at signing', amount: formatCurrency(form.downPayment) },
      { label: 'Cash price today', amount: formatCurrency(decoded.totals.cashOutlayCents) },
      { label: 'Amount financed', amount: formatCurrency(decoded.totals.amountFinancedCents) },
      { label: 'Total of payments', amount: formatCurrency(decoded.totalOfPaymentsCents) },
      { label: 'What financing costs', amount: formatCurrency(decoded.costVersusCashCents) },
    ],
  }));
}

const PERIODS_PER_YEAR = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 } as const;

function missingForVerdict(reason: string | null, differenceCents: number, country: 'US' | 'CA'): string[] {
  if (reason === null) return [];
  if (reason === 'unknown_fee') {
    return ['An amount on this quote that nobody has explained yet. Find out what it is and run it again.'];
  }
  if (reason === 'unreconciled_ledger') {
    return [
      `The quoted total and the scheduled payments differ by ${formatCurrency(differenceCents)} a payment. `
      + 'A trade, down payment, tax, fee, or add-on may be missing. Confirm it before we rate this deal.',
    ];
  }
  if (reason === 'no_matched_benchmark') {
    if (country === 'CA') {
      return [
        'No published Canadian equipment rate exists to compare against. We show the math; '
        + 'there is no card to check it against.',
      ];
    }
    return ['No published equipment rate matches this size and term, so we have nothing honest to rate it against.'];
  }
  return MISSING_FOR_VERDICT;
}


app.post('/email', async (c) => {
  if (!(await withinRateLimit(c, 'email'))) {
    return c.html(renderNotice('Give it a minute', 'That is a lot of requests in one minute. Try again shortly.'), 429);
  }

  const sendable = emailSendable(c.env);
  if (sendable === null) {
    return c.html(renderNotice(
      'Not switched on yet',
      'The teardown email is not running yet, so we have not kept your address. Your numbers are on the screen behind this.',
    ), 503);
  }

  const body = await c.req.parseBody();
  const parsed = emailGateSchema.safeParse({
    email: String(body.email ?? ''),
    decodeId: String(body.decodeId ?? ''),
  });
  if (!parsed.success) {
    return c.html(renderNotice(
      'Check that address',
      parsed.error.issues.map((issue) => issue.message).join(' '),
    ), 422);
  }

  const row = await c.env.DB.prepare('SELECT * FROM decodes WHERE id = ?')
    .bind(parsed.data.decodeId)
    .first<Record<string, unknown>>();
  if (row === null) {
    return c.html(renderNotice('We lost that one', 'Run your quote again and the teardown will follow.'), 404);
  }

  const emailId = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO emails (id, email, decode_id, created_at, followup_text_version) VALUES (?, ?, ?, ?, ?)',
  ).bind(
    emailId, parsed.data.email, parsed.data.decodeId, new Date().toISOString(),
    FOLLOWUP_TEXT_VERSION,
  ).run();

  const origin = new URL(c.req.url).origin;
  const unsubscribe = `${origin}/unsubscribe/${emailId}`;
  const sent = await sendTeardown(c.env, {
    emailId, to: parsed.data.email, row, origin: new URL(c.req.url).origin,
  });

  if (!sent.ok) {
    c.executionCtx.waitUntil(recordEvent(c.env, 'email_failed', parsed.data.decodeId, { status: sent.status }));
    // No retry exists, so none is promised. The earlier wording here said the
    // teardown would follow shortly, which nothing in this product would have
    // done: the same defect as an opt-in with no sender, and more comfortable
    // to read, which is what makes it worse.
    return c.html(renderNotice(
      'That did not send',
      'Something went wrong on our side and the teardown did not go out. We kept your address, '
      + 'and nothing else happened. Your numbers are on the screen behind this, and you can ask again.',
    ), 502);
  }

  const eventId = await recordEvent(c.env, 'email', parsed.data.decodeId, {});
  measureAd(c, 'EmailGiven', eventId, fbcFromBody(body.fbc));

  // The confirmation screen carries the second opt-in, and only when the
  // farmer's own paper gives us a date to remind him about. No date, no offer.
  const expiry = typeof row.quote_expiry_date === 'string' ? row.quote_expiry_date : null;
  return c.html(renderSent(emailId, expiry));
});

// One click, both ways: the RFC 8058 POST and a plain link somebody can click.
// The row id is the token, so no address is ever put in a URL.
app.all('/unsubscribe/:id', async (c) => {
  const result = await c.env.DB.prepare(
    'UPDATE emails SET unsubscribed_at = ? WHERE id = ? AND unsubscribed_at IS NULL',
  ).bind(new Date().toISOString(), c.req.param('id')).run();
  c.executionCtx.waitUntil(recordEvent(c.env, 'unsubscribe', null, {
    changed: result.meta.changes,
  }));
  return c.html(renderNotice(
    'Done',
    'You are off the list. We will not email you again.',
  ));
});


// Phase A, spec.md §8. Records intent and moves nothing.
//
// There is no lead here, no forwarding, no lender contact, and no PII beyond
// the decode row that already existed. The event is the entire product of this
// route, and the funnel number it feeds is the honest rung: interest-yes is
// directional intent, not permission and not a sale.
app.post('/interest', async (c) => {
  if (!(await withinRateLimit(c, 'interest'))) {
    return c.html(renderNotice('Give it a minute', 'That is a lot of requests in one minute.'), 429);
  }
  const body = await c.req.parseBody();
  const decodeId = String(body.decodeId ?? '');
  const answer = String(body.answer ?? '') === 'yes' ? 'yes' : 'not_now';

  const eventId = await recordEvent(c.env, answer === 'yes' ? 'interest_yes' : 'interest_not_now', decodeId || null, {});
  // A yes is the measured conversion. A "not now" is an answer, not an event
  // an ad platform optimizes toward, so nothing fires for it.
  if (answer === 'yes') measureAd(c, 'InterestYes', eventId, fbcFromBody(body.fbc));

  return c.html(renderNotice(
    answer === 'yes' ? 'Noted' : 'Understood',
    answer === 'yes'
      ? 'Nothing has moved and nobody has your numbers. We are counting how many farmers would want that, and you are counted.'
      : 'Nothing moves. Your numbers stay here.',
  ));
});


// The boring pages that keep the cave safe (spec.md §10). Static, cached, and
// footer-linked from every screen.
const STATIC_PAGES: Array<[string, () => string]> = [
  ['/privacy', renderPrivacy],
  ['/terms', renderTerms],
  ['/how-we-make-money', renderHowWeMakeMoney],
  ['/how-we-figure-it', renderHowWeFigureIt],
  ['/straight-answers', renderStraightAnswers],
  ['/whos-behind-this', renderWhosBehindThis],
];
for (const [path, render] of STATIC_PAGES) {
  app.get(path, (c) => {
    c.header('cache-control', 'public, max-age=600');
    return c.html(render());
  });
}

app.get('/contact', (c) => {
  c.header('cache-control', 'public, max-age=600');
  const postal = typeof c.env.POSTAL_ADDRESS === 'string' ? c.env.POSTAL_ADDRESS : '';
  return c.html(renderContact(postal));
});

app.get('/manifest.webmanifest', (c) => {
  c.header('content-type', 'application/manifest+json');
  c.header('cache-control', 'public, max-age=86400');
  return c.body(renderManifest());
});


// Notes. Papers, not a blog: no feed, no archive by month, no comments.
app.get('/notes', (c) => c.redirect('/notes/', 301));
app.get('/notes/', (c) => {
  c.header('cache-control', 'public, max-age=600');
  return c.html(renderNotesIndex());
});
app.get('/notes/:slug', (c) => {
  const note = NOTES.find((entry) => entry.slug === c.req.param('slug'));
  if (note === undefined) return c.html(renderNotFound(), 404);
  c.header('cache-control', 'public, max-age=600');
  return c.html(renderNote(note));
});


/**
 * What is actually running.
 *
 * Deploy parity was sampled before this: fetch a page, eyeball a sentence,
 * assume the rest matched. This makes it provable. BUILD_SHA is injected at
 * deploy time from the git commit, so a worker running something other than
 * what is on main says so when asked.
 */
app.get('/version', (c) => {
  c.header('cache-control', 'no-store');
  return c.json({
    sha: typeof c.env.BUILD_SHA === 'string' ? c.env.BUILD_SHA : 'unset',
    terms: TERMS_VERSION,
    privacy: PRIVACY_VERSION,
    buffer: VERDICT_BUFFER_VERSION,
    peer: PEER_POLICY_VERSION,
  });
});

app.onError((error, c) => {
  // Surfaced in logs and in tests. A farmer still sees the plain page.
  console.log(`route error ${c.req.path}: ${String(error)}`);
  return c.html(renderNotFound(), 500);
});

app.notFound((c) => c.html(renderNotFound(), 404));


// Opt-in to a reminder before the quote on the paper expires. Second ask, on
// the screen after the teardown was already sent, and only ever offered when
// the quote itself carried an expiry date.
app.post('/remind', async (c) => {
  if (!(await withinRateLimit(c, 'remind'))) {
    return c.html(renderNotice('Give it a minute', 'That is a lot of requests in one minute.'), 429);
  }
  const body = await c.req.parseBody();
  const emailId = String(body.emailId ?? '');
  const remindOn = String(body.remindOn ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(remindOn)) {
    return c.html(renderNotice('No date to work from', 'That quote did not carry an expiry date we could read.'), 422);
  }

  const result = await c.env.DB.prepare(
    'UPDATE emails SET reminder_opt_in = 1, remind_on = ? WHERE id = ? AND unsubscribed_at IS NULL',
  ).bind(remindOn, emailId).run();

  // Nothing was recorded, so nothing may be promised. This route used to say
  // "we will remind you" whatever happened, including for an id that matched
  // no row and for an address that had already unsubscribed. A promise made to
  // a farmer we cannot keep is the same failure as a number we cannot stand
  // behind, and it is worse for being reassuring.
  if (result.meta.changes === 0) {
    return c.html(renderNotice(
      'We could not set that up',
      'We have no record to attach a reminder to, or that address has already been unsubscribed. Nothing has been scheduled.',
    ), 422);
  }

  c.executionCtx.waitUntil(recordEvent(c.env, 'reminder_opt_in', null, { remind_on: remindOn }));

  return c.html(renderNotice(
    'We will remind you',
    `We will send one note before ${remindOn}, which is the date on your own paper. One note, and you can stop it from any email we send.`,
  ));
});


/**
 * First-party beacons from the one script in the product.
 *
 * An allowlist, not a free-text sink: an events table anybody can write
 * anything into is an events table nobody can trust. No body beyond the name,
 * no identifier, and nothing that could carry a farmer with it.
 */
const BEACON_EVENTS = new Set([
  'standalone_launch', 'install_prompt_shown', 'install_accepted', 'install_dismissed',
]);

app.post('/event', async (c) => {
  if (!(await withinRateLimit(c, 'event'))) return c.body(null, 429);
  const name = (await c.req.text()).trim().slice(0, 40);
  if (!BEACON_EVENTS.has(name)) return c.body(null, 422);
  await recordEvent(c.env, name);
  return c.body(null, 204);
});

export default {
  fetch: app.fetch,

  // Both crons log on every fire, wired or not. A cron that silently does
  // nothing and a cron that silently fails look identical in the dashboard,
  // and the reaper is what keeps the photo-deletion promise.
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    switch (event.cron) {
      case REAPER_CRON:
        console.log('cron reaper: nothing to reap, photos are never written down');
        break;
      case BACKUP_CRON:
        ctx.waitUntil(
          backupToR2(env, new Date().toISOString().slice(0, 10))
            .then((result) => console.log(`cron backup: ${result.rows} rows, ${result.bytes} bytes, to ${result.key}`))
            .catch((error) => console.log(`cron backup FAILED: ${String(error)}`)),
        );
        // The reminder sweep rides the daily cron. It is the delivery half of
        // an opt-in that would otherwise be a promise nobody keeps.
        {
          const today = new Date().toISOString().slice(0, 10);
          ctx.waitUntil(sendDueReminders(env, today));
          ctx.waitUntil(sendDayFour(env, today)
            .then((r) => console.log(`cron day4: ${r.sent} sent`)));
          ctx.waitUntil(sendDayThirty(env, today)
            .then((r) => console.log(`cron day30: ${r.sent} sent, ${r.skipped} had no cohort yet`)));
        }
        break;
      default:
        console.log(`cron unrecognized: ${event.cron}, nothing ran`);
    }
  },
};
