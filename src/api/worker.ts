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
  benchmarksCurrentOn, costAgainstBenchmark, decideVerdict, decodeLedger, formatCurrency, formatRate,
  cohortBands, cohortLadder, matchBenchmark, PEER_POLICY_VERSION, promoPriceRate,
  quoteWithinSanityBounds, VERDICT_BUFFER_VERSION,
  type BenchmarkRow, type DealLedger, type LedgerFee,
} from '../finance/index.js';
import { hashAccessKey } from './security.js';
import {
  centsToInput, confirmableField, confirmFrequency, emailGateSchema, EQUIPMENT_BRANDS, ledgerFormSchema,
  normalizeBrand, quickPathFormSchema,
  type ConfirmableField, type QuoteExtraction,
} from '../shared/schema.js';
import {
  renderConfirm, renderExtractFailure, renderForm, renderNotice, renderTicket, renderUnpriceable, renderUnsubscribeConfirm,
  renderVerdictTicket, setFooterPostalAddress,
  type ConfirmRow, type FormValues,
} from '../web/page.js';
import { assertUploadBytes, MAX_PHOTOS_PER_DECODE, MAX_TOTAL_UPLOAD_BYTES, PublicApiError } from './security.js';
import { ExtractionFailedError, OpenAIQuoteExtractor } from './extractor.js';
import { renderTeardownPdf, type TeardownLine } from './teardown-pdf.js';
import { FOLLOWUP_TEXT_VERSION } from '../web/page.js';
import {
  renderContact, renderDoNotSell, renderHowWeFigureIt, renderHowWeMakeMoney, renderManifest, renderNotFound,
  renderNote, renderNotesIndex, renderPrivacy, renderSent, renderStraightAnswers, renderTerms,
  renderWhosBehindThis, NOTES, PRIVACY_VERSION, TERMS_VERSION,
} from '../web/pages.js';
import { getConfig } from './env.js';
import { fbcFromBody, fbcFromUrl, recordCapiOutcome, sendCapi, type CapiEventName } from './capi.js';

// Must match the crons in wrangler.jsonc. An unrecognized cron logs and does
// nothing rather than falling into the wrong branch.
const PUBLIC_ORIGIN = 'https://www.loanhank.com';

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

type EventContext = { env: Env; req: { header: (name: string) => string | undefined } };

/**
 * Verification traffic announces itself (spec.md 7.2) and the announcement
 * must land on every row the request writes, at insert time. Two mop-up
 * migrations exist because flagging used to be a memory.
 */
function isSynthetic(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return c.req.header('x-loanhank-synthetic') === '1';
}

/**
 * Route call sites pass the request context so the row self-flags; cron call
 * sites pass the bare env, and a cron is never synthetic.
 */
async function recordEvent(
  source: Env | EventContext,
  event: string,
  decodeId: string | null = null,
  meta: Record<string, unknown> = {},
): Promise<string> {
  const fromRequest = typeof (source as EventContext).req?.header === 'function';
  const env = fromRequest ? (source as EventContext).env : source as Env;
  const synthetic = fromRequest && isSynthetic(source as EventContext) ? 1 : 0;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO events (id, event, decode_id, ts, meta_json, synthetic) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, event, decodeId, new Date().toISOString(), JSON.stringify(meta), synthetic)
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
 * Every screen that refuses a decode and offers the retry, in one place.
 *
 * The retry form carries the campaign labels and the click tag forward, so a
 * farmer who is refused, fixes his numbers and completes still counts as the
 * ad-attributed decode he is. Without that, cost per completed decode inflates
 * and the §7.1 wall reads wrong.
 *
 * One function rather than the argument list repeated at four call sites: the
 * threading was got right three times and forgotten once, which is the shape
 * of defect that comes back. There is now a single place to get it wrong, and
 * a test that says so.
 */
function refuseDecode<R>(
  c: Pick<MeasurableRequest, 'req'> & { html: (body: string, status?: never) => R },
  body: Record<string, unknown>,
  message: string,
  status: 422 | 429,
): R {
  return c.html(
    renderUnpriceable(
      message,
      campaignFromBody(body),
      gpcHonoured(c) ? null : fbcFromBody(body.fbc),
    ),
    status as never,
  );
}

/**
 * A refused LEDGER decode re-renders the confirm screen with everything the
 * farmer posted: his dozen corrections, his region, his checkboxes, and the
 * original extraction snapshot, so one typo no longer destroys the whole
 * photo-path session and dumps him on an empty four-field form that can
 * never earn a verdict.
 */
function refuseLedger<R>(
  c: Pick<MeasurableRequest, 'req'> & { html: (body: string, status?: never) => R },
  body: Record<string, unknown>,
  problems: string[],
  issues: Map<string, string>,
): R {
  return c.html(
    renderConfirm({
      rows: confirmRowsFromBody(body, issues),
      frequency: String(body.paymentFrequency ?? ''),
      warnings: [],
      problems,
      region: String(body.region ?? ''),
      financeOnlyFeeRolled: body.financeOnlyFeeRolled !== undefined,
      unexplainedAmount: body.unexplainedAmount !== undefined,
      extractedJson: typeof body.extracted === 'string' ? body.extracted : undefined,
      photoCount: Math.min(4, Math.max(0, Math.trunc(Number(body.photoCount)) || 0)),
      fbc: gpcHonoured(c) ? null : fbcFromBody(body.fbc),
      campaign: campaignFromBody(body),
    }),
    422 as never,
  );
}

/**
 * Meta CAPI, fired behind waitUntil so measurement never stands in the request
 * path, and the outcome patched onto the events row so every send is logged,
 * success, failure or skip (spec.md §10).
 *
 * The synthetic gate reads the request marker spec.md §7.2 defines:
 * verification traffic sends `x-loanhank-synthetic: 1` and never reaches Meta,
 * because an event cannot be un-sent the way a row can be flagged. Note which
 * way it fails: the header is opt-in, so forgetting it sends a real event. It
 * is the second line of defence; the dev dataset or an unset META_DATASET_ID
 * is the first. A stranger sending the header merely opts their own decode
 * out of measurement.
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

/**
 * The confirm screen's field order, labels, hints, and closed lists, in one
 * table so the extraction render and the refusal re-render cannot drift.
 */
const CONFIRM_FIELDS: Array<{ name: string; label: string; hint?: string; choices?: readonly string[] }> = [
  { name: 'quotedPrice', label: 'Quoted price' },
  { name: 'cashDiscount', label: 'Cash discount', hint: 'What they knock off if you pay cash instead of financing. Leave empty if there is none.' },
  { name: 'payment', label: 'Payment' },
  { name: 'paymentCount', label: 'How many payments' },
  { name: 'statedRate', label: 'Rate printed on the quote', hint: 'As a percentage. A 0% promo is 0.' },
  { name: 'downPayment', label: 'Due at signing' },
  { name: 'tradeAllowance', label: 'Trade allowance' },
  { name: 'tradePayoff', label: 'Still owed on the trade' },
  { name: 'balloon', label: 'Balloon at the end', hint: 'One big payment due after the regular ones. Leave it empty if there is none.' },
  { name: 'deliverySetup', label: 'Delivery and setup' },
  { name: 'financeOnlyFee', label: 'Fees you only pay if you finance', hint: 'Doc, origination, or required insurance. Leave empty if there are none.' },
  // Offered as a list, never a free box. A name that is not a manufacturer
  // has no path in (spec.md §9.5).
  { name: 'brand', label: 'Make', hint: 'Pick the maker of the machine. Leave it blank if it is not on the list.', choices: EQUIPMENT_BRANDS },
  // Read silently, never required. The expiry drives the only honest deadline
  // this product has, and the quote date keeps stale paper out of a
  // current-quarter median (spec.md 9.4: forage never blocks a decode).
  { name: 'quoteDate', label: 'Date on the quote', hint: 'Like 2026-08-11. Leave empty if it is not printed.' },
  { name: 'quoteExpiryDate', label: 'Quote valid until', hint: 'Leave empty if the paper does not say.' },
];

const CONFIRM_FIELD_META = new Map(CONFIRM_FIELDS.map((field) => [field.name, field]));

/**
 * The confirm screen, built from what the model could and could not read.
 * Exported for the eval gate: null in, empty amber box out.
 */
export function confirmRows(extraction: QuoteExtraction): ConfirmRow[] {
  const decorate = (name: string, row: ConfirmableField): ConfirmRow => {
    const meta = CONFIRM_FIELD_META.get(name);
    return { ...row, ...(meta?.hint ? { hint: meta.hint } : {}) };
  };
  const label = (name: string) => CONFIRM_FIELD_META.get(name)?.label ?? name;
  const money = (name: string, source: { value_cents: number | null; confidence: number }): ConfirmRow =>
    decorate(name, confirmableField(name, label(name), { value: source.value_cents, confidence: source.confidence }, centsToInput) as ConfirmableField);
  const text = (name: string, source: { value: string | null; confidence: number }): ConfirmRow =>
    decorate(name, confirmableField(name, label(name), source) as ConfirmableField);
  const plain = (name: string, source: { value: number | null; confidence: number }): ConfirmRow =>
    decorate(name, confirmableField(name, label(name), source) as ConfirmableField);

  return [
    money('quotedPrice', extraction.quoted_price),
    money('cashDiscount', extraction.cash_discount),
    money('payment', extraction.payment_amount),
    plain('paymentCount', extraction.payment_count),
    plain('statedRate', { value: extraction.stated_rate_bps.value === null ? null : extraction.stated_rate_bps.value / 100, confidence: extraction.stated_rate_bps.confidence }),
    money('downPayment', extraction.down_payment),
    money('tradeAllowance', extraction.trade_allowance),
    money('tradePayoff', extraction.trade_payoff),
    money('balloon', extraction.balloon),
    money('deliverySetup', extraction.delivery_setup),
    money('financeOnlyFee', { value_cents: null, confidence: 0 }),
    {
      name: 'brand',
      label: label('brand'),
      state: normalizeBrand(extraction.brand.value) === null ? 'unreadable' as const : 'read' as const,
      value: normalizeBrand(extraction.brand.value) ?? '',
      choices: [...EQUIPMENT_BRANDS],
      hint: CONFIRM_FIELD_META.get('brand')?.hint as string,
    },
    text('quoteDate', extraction.quote_date),
    text('quoteExpiryDate', extraction.quote_expiry_date),
  ];
}

/**
 * The same screen, rebuilt from what the farmer just posted, so a refusal
 * hands his work back instead of an empty form. Every value is his own typed
 * string, so no row claims it was read from the paper.
 */
function confirmRowsFromBody(body: Record<string, unknown>, issues: Map<string, string>): ConfirmRow[] {
  return CONFIRM_FIELDS.map((field) => ({
    name: field.name,
    label: field.label,
    ...(field.hint ? { hint: field.hint } : {}),
    ...(field.choices ? { choices: [...field.choices] } : {}),
    state: 'read' as const,
    value: String(body[field.name] ?? ''),
    ...(issues.has(field.name) ? { problem: issues.get(field.name) as string } : {}),
  }));
}

const WARNING_COPY: Record<string, string> = {
  NOT_AN_EQUIPMENT_QUOTE: 'This does not look like an equipment quote. Check the numbers carefully before you run it.',
  IMAGE_TOO_BLURRY: 'Too blurry to read. Try again in better light, or type the numbers.',
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
  'statedRate', 'downPayment', 'tradeAllowance', 'tradePayoff', 'balloon',
  'deliverySetup', 'financeOnlyFee', 'quoteDate', 'quoteExpiryDate',
]);

// The value shapes (spec.md 9.5, closed by value as well as by key). The
// allowlist vouches for the field NAME; these vouch for what a value under it
// may look like. Letters have no shape here, so a letterhead fragment or a
// salesperson's name misread into a date box has no path into the pile. The
// date shape is strict ISO or empty on purpose: a looser digits-and-dashes
// shape would admit an SSN.
const NUMERIC_VALUE = /^[0-9.,$% ]{0,40}$/;
const DATE_VALUE = /^(\d{4}-\d{2}-\d{2})?$/;
const FREQUENCY_VALUES = new Set(['', 'monthly', 'quarterly', 'semiannual', 'annual']);

function valueShapeHolds(field: string, value: string): boolean {
  if (field === 'quoteDate' || field === 'quoteExpiryDate') return DATE_VALUE.test(value);
  if (field === 'paymentFrequency') return FREQUENCY_VALUES.has(value);
  return NUMERIC_VALUE.test(value);
}

/**
 * What the model read against what the farmer confirmed, per field.
 *
 * Unknown keys are dropped BEFORE anything is computed or stored, so a posted
 * key never reaches the diff, the event, or the database. A value that fails
 * its field's shape is blanked: the field name still feeds the flywheel count,
 * and the value itself goes nowhere.
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
    if (!same) {
      const shaped = valueShapeHolds(field, readValue.trim())
        && valueShapeHolds(field, confirmedValue.slice(0, 40).trim());
      diff.push(shaped
        ? { field, read: readValue, confirmed: confirmedValue.slice(0, 40) }
        : { field, read: '', confirmed: '' });
    }
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
/** One page of rows per query, one multipart part per ~8 MB of SQL text. */
const BACKUP_PAGE_ROWS = 5_000;
const BACKUP_PART_BYTES = 8 * 1024 * 1024;
/**
 * Events older than this are deleted by the nightly cron, and only after that
 * night's backup has been written, so every pruned row survives in at least
 * ninety days of backups (spec.md section 5). decodes, emails, and benchmarks
 * are never pruned: the pile is the company; events is its access log.
 */
const EVENTS_RETENTION_DAYS = 180;

export async function backupToR2(env: Env, stamp: string): Promise<{ key: string; rows: number; bytes: number }> {
  const key = `d1/loanhank-${stamp}.sql`;
  // Multipart, so memory holds one page of rows and one part of text however
  // large the pile grows. The old single-put built the whole dump in the
  // isolate twice, which fails at exactly the traffic ad spend is buying.
  // ponytail: single-pass multipart, no resume; if a nightly ever exceeds the
  // cron budget, split per-table objects.
  const upload = await env.BACKUPS.createMultipartUpload(key, {
    httpMetadata: { contentType: 'application/sql' },
  });
  const uploadedParts: Awaited<ReturnType<typeof upload.uploadPart>>[] = [];
  let buffer = [
    `-- LoanHank pile export ${stamp}`,
    '-- Restore: wrangler d1 execute <database> --file <this file>',
    '-- Schema is NOT included. Apply migrations first, then replay this.',
    'PRAGMA defer_foreign_keys = true;',
    '',
  ].join(String.fromCharCode(10));
  let bytes = 0;
  let rows = 0;

  const flushPart = async () => {
    uploadedParts.push(await upload.uploadPart(uploadedParts.length + 1, buffer));
    bytes += buffer.length;
    buffer = '';
  };

  try {
    for (const table of BACKUP_TABLES) {
      // Keyset pagination on rowid: stable however many rows land mid-backup.
      let cursor = -9_007_199_254_740_991;
      let first = true;
      for (;;) {
        const page = await env.DB.prepare(
          `SELECT rowid AS __rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${BACKUP_PAGE_ROWS}`,
        ).bind(cursor).all<Record<string, unknown>>();
        if (page.results.length === 0) {
          if (first) buffer += `-- ${table}: empty${String.fromCharCode(10)}`;
          break;
        }
        const columns = Object.keys(page.results[0] as Record<string, unknown>)
          .filter((column) => column !== '__rowid');
        if (first) {
          buffer += `DELETE FROM ${table};${String.fromCharCode(10)}`;
          first = false;
        }
        for (const row of page.results) {
          const values = columns.map((column) => sqlLiteral(row[column])).join(', ');
          buffer += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values});${String.fromCharCode(10)}`;
          rows += 1;
          if (buffer.length >= BACKUP_PART_BYTES) await flushPart();
        }
        cursor = Number(page.results[page.results.length - 1]?.__rowid);
      }
    }
    if (buffer.length > 0) await flushPart();
    await upload.complete(uploadedParts);
  } catch (error) {
    // Leave nothing half-written, and prune nothing: retention only runs
    // behind a landed backup.
    await upload.abort();
    throw error;
  }

  const pruned = await env.DB.prepare(
    `DELETE FROM events WHERE ts < datetime('now', '-${EVENTS_RETENTION_DAYS} days')`,
  ).run();

  // A row, not just a log line. console.log is invisible to the morning ritual,
  // and a cron that quietly stopped looks exactly like one that ran. This is
  // what lets ops/funnel.sql print days since the last successful backup, so a
  // dead cron shows up within a day instead of on the day it is needed.
  await recordEvent(env, 'backup_completed', null, { key, rows, bytes, pruned: pruned.meta.changes });
  return { key, rows, bytes };
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

  // One question, answered once per sweep: has a newer tier-1 card landed?
  // The sentence below used to assert "has not been reissued" without ever
  // checking, which made it a false factual statement any send after a new
  // card. Now it is checked, and a decode that matched no card says nothing
  // about a card at all.
  const latest = await env.DB.prepare(
    'SELECT MAX(as_of_date) AS latest FROM benchmarks WHERE tier = 1',
  ).first<{ latest: string | null }>();

  let sent = 0;
  for (const row of due.results) {
    const rate = row.real_rate_all_in_bps === null
      ? 'the rate on your ticket'
      : formatRate(Number(row.real_rate_all_in_bps));
    const cardLines = row.benchmark_at_ts === null
      ? []
      : latest?.latest != null && String(latest.latest) > String(row.benchmark_at_ts)
        ? [
          'A newer published card has come out since your teardown, so the',
          'comparison on it is out of date. Worth running the quote again before',
          'you decide.',
          '',
        ]
        : [
          'The published card we compared against has not been reissued since your',
          'teardown, so nothing about the comparison has changed.',
          '',
        ];
    const lines = [
      'Four days ago you ran a quote through us and it came out at ' + rate + '.',
      '',
      'Did you take it?',
      '',
      row.quote_expiry_date === null
        ? 'If you are still deciding, the teardown we sent has the whole receipt on it.'
        : `The paper says the quote is good until ${String(row.quote_expiry_date)}.`,
      '',
      ...cardLines,
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
      recordEvent(c, 'page_view', null, { came_from: cameFrom, ...campaign }),
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
    return refuseDecode(
      c,
      await c.req.parseBody().catch(() => ({})),
      'That is a lot of quotes in one minute. Give it a minute and run it again.',
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
    // A missing frequency is rejected with a plain ask, never assumed monthly:
    // an assumed frequency is a rate multiplier guessed on the farmer's behalf.
    paymentFrequency: String(body.paymentFrequency ?? ''),
    balloon: String(body.balloon ?? ''),
  };

  // Shape-checked before it is ever echoed or sent; a tag that is not exactly
  // an fbc we could have rendered reads as no tag at all.
  const fbc = fbcFromBody(body.fbc);

  const parsed = quickPathFormSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message);
    c.executionCtx.waitUntil(recordEvent(c, 'decode_rejected', null, { problems }));
    // The campaign labels ride the retry, or a farmer who fixes one stray
    // character stops counting as the ad-attributed decode he is (spec 7.1).
    // The camera hero stays off on purpose: he is mid-typed-flow with
    // problems to fix in these exact boxes.
    return c.html(renderForm(raw, problems, null, campaignFromBody(body), gpcHonoured(c) ? null : fbc), 422);
  }

  const form = parsed.data;
  const result = promoPriceRate({
    quotedPriceCents: form.quotedPrice,
    cashDiscountCents: form.cashDiscount,
    paymentAmountCents: form.payment,
    paymentCount: form.paymentCount,
    paymentFrequency: form.paymentFrequency,
    balloonCents: form.balloon,
  });

  if (result.promoPriceRateBps === null) {
    // Abstaining is success. We say we could not read the deal rather than
    // printing a number we do not stand behind, and the farmer keeps every
    // value he typed for the fix.
    c.executionCtx.waitUntil(
      recordEvent(c, 'decode_unpriceable', null, { reason: result.unavailableReason }),
    );
    return c.html(renderForm(
      raw,
      ['Those numbers do not add up to a deal we can price. Check the payment and how many there are against your paper, then run it again.'],
      null,
      campaignFromBody(body),
      gpcHonoured(c) ? null : fbc,
    ), 422);
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
       payment_amount_cents, payment_frequency, payment_count, balloon_cents,
       promo_price_rate_bps, reconciled, assumptions_json, verdict, synthetic
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'none', ?)`,
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
      // Asked on the form, so an empty box is an answer: zero, not null.
      form.balloon,
      result.promoPriceRateBps,
      JSON.stringify(result.assumptions),
      isSynthetic(c) ? 1 : 0,
    )
    .run();

  const eventId = await recordEvent(c, 'decode', decodeId, {
    // The quick path carried no campaign labels, so a typed decode was
    // invisible to the ad that produced it while the ledger path and the page
    // view both kept theirs. Cost per completed decode is the round-one gate
    // (spec.md §7.1) and it cannot be computed from two thirds of the decodes.
    ...campaignFromBody(body),
    // Which door the farmer came through: the manual disclosure, or the typed
    // fields rendered beside a photo failure. The camera hero lands on the
    // ledger path, so the three are distinguishable in the funnel (spec.md
    // §7.1 calibration note).
    entry: String(body.entry ?? '') === 'recovery' ? 'recovery' : 'typed',
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
        ...(form.balloon > 0 ? [{ label: 'Balloon at the end', amount: formatCurrency(form.balloon) }] : []),
        { label: 'What financing costs', amount: formatCurrency(cost) },
      ],
    }),
  );
});


app.post('/extract', async (c) => {
  if (!(await withinRateLimit(c, 'extract'))) {
    return c.html(renderExtractFailure('That is a lot of photos in one minute. Give it a minute and try again, or type the numbers.'), 429);
  }

  const siteKey = typeof c.env.TURNSTILE_SITE_KEY === 'string' ? c.env.TURNSTILE_SITE_KEY : '';
  const apiKey = typeof c.env.OPENAI_API_KEY === 'string' ? c.env.OPENAI_API_KEY : '';
  if (siteKey === '' || apiKey === '') {
    // Fail closed and say so plainly rather than accepting a photo we have no
    // way to read or protect.
    return c.html(
      renderExtractFailure('Reading photos is not switched on yet. Type the four numbers off your paper instead.'),
      503,
    );
  }

  // Every failure from here down renders the typed fields inline beside the
  // message, so no farmer meets a dead end without the typing path in view.
  const body = await c.req.parseBody({ all: true });
  const campaign = campaignFromBody(body);
  const fbc = gpcHonoured(c) ? null : fbcFromBody(body.fbc);
  const fail = (message: string, status: 403 | 413 | 422 | 502) =>
    c.html(renderExtractFailure(message, campaign, fbc), status);

  const token = String(body['cf-turnstile-response'] ?? '');
  const passed = await turnstilePassed(
    c.env,
    token,
    c.req.header('cf-connecting-ip') ?? '',
    new URL(c.req.url).hostname,
  );
  if (!passed) {
    c.executionCtx.waitUntil(recordEvent(c, 'extract_rejected', null, { reason: 'turnstile' }));
    return fail('We could not confirm that came from a person. Reload the page and try once more, or type the numbers.', 403);
  }

  // Many photos, one decode: pages of the same paper, merged into one read.
  const files = [body.photo].flat().filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return fail('Pick a photo of the quote first.', 422);
  }
  if (files.length > MAX_PHOTOS_PER_DECODE) {
    c.executionCtx.waitUntil(recordEvent(c, 'extract_rejected', null, { reason: 'too_many_photos' }));
    return fail('One decode reads up to four photos. Pick the four that show the whole deal.', 413);
  }

  // The per-image size law is unchanged: each photo passes the same guard one
  // always did, and one oversized page refuses the lot. The summed cap is the
  // isolate's law: every page is buffered and base64-doubled in memory, so
  // the decode is refused before buffering past the line, not after the OOM.
  const pages: Array<{ dataUrl: string; contentType: string }> = [];
  let totalBytes = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
      c.executionCtx.waitUntil(recordEvent(c, 'extract_rejected', null, { reason: 'total_too_large' }));
      return fail('Those photos add up to more than we can take in one upload. Send fewer pages, or type the numbers.', 413);
    }
    try {
      // Type, size, and the magic bytes: a file is what its first bytes say
      // it is, not what the browser labeled it.
      assertUploadBytes(file.type, bytes, bytes.byteLength);
    } catch (error) {
      const message = error instanceof PublicApiError
        ? 'One of those files is either too large or not a photo we can read. Send JPGs, PNGs, or PDFs under 20 MB each.'
        : 'We could not read one of those files.';
      c.executionCtx.waitUntil(recordEvent(c, 'extract_rejected', null, {
        reason: error instanceof PublicApiError ? error.code : 'unreadable',
      }));
      return fail(message, error instanceof PublicApiError && error.status === 413 ? 413 : 422);
    }
    pages.push({ dataUrl: `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`, contentType: file.type });
  }

  // The photos are never written down. They go from this request straight to
  // the reader as bytes and are gone when the answer comes back. Nothing to
  // delete, nothing to leak, nothing for a retention sweep to miss.
  let extraction;
  try {
    // OPENAI_CLIENT is the test seam; production never sets it.
    extraction = await new OpenAIQuoteExtractor(
      getConfig(c.env),
      c.env.OPENAI_CLIENT as ConstructorParameters<typeof OpenAIQuoteExtractor>[1],
    ).extractQuote(pages);
  } catch (error) {
    // A failed read is a re-snap the farmer has to do, and the only place we
    // would ever see it. Losing it means losing the signal that the extractor
    // is drifting on some quote format we have never met.
    const kind = error instanceof ExtractionFailedError ? error.kind : 'unknown';
    c.executionCtx.waitUntil(recordEvent(c, 'extract_failed', null, {
      photo_count: files.length,
      size_bytes: pages.reduce((total, page) => total + page.dataUrl.length, 0),
      kind,
      fallback_tried: error instanceof ExtractionFailedError ? error.attemptedFallback : false,
    }));
    // An outage, a dead key, and an unreadable page are different failures,
    // and two of them are ours. Blaming the photo for a provider being down
    // burns the farmer's retries on a camera that cannot succeed.
    const readerDown = kind === 'auth' || kind === 'timeout' || kind === 'provider';
    return fail(readerDown
      ? 'Our reader is down right now, not your photo. Type the numbers off your paper instead.'
      : 'Too blurry to read. Try again in better light, or type the numbers.', 502);
  }

  c.executionCtx.waitUntil(recordEvent(c, 'extract', null, {
    document_type: extraction.document_type,
    warnings: extraction.warnings,
    photo_count: files.length,
  }));

  return c.html(renderConfirm({
    rows: confirmRows(extraction),
    frequency: confirmFrequency(extraction.payment_frequency),
    warnings: extraction.warnings.map((code) => WARNING_COPY[code] ?? code),
    fbc,
    photoCount: files.length,
    campaign,
  }));
});

/** The verdict path: a complete ledger, a matched reference, and a stamp. */
async function decodeFullLedger(c: {
  env: Env;
  req: { url: string; parseBody: () => Promise<Record<string, unknown>>; header: (name: string) => string | undefined };
  executionCtx: { waitUntil: (promise: Promise<unknown>) => void };
  html: (body: string, status?: 200 | 422) => Response;
}, body: Record<string, unknown>): Promise<Response> {
  // Shape-checked before it is ever sent; a tag that is not exactly an fbc we
  // could have rendered reads as no tag at all. The refusal screens below read
  // it again through refuseDecode, which is the one place that threading lives.
  const fbc = fbcFromBody(body.fbc);
  const parsed = ledgerFormSchema.safeParse({
    quotedPrice: String(body.quotedPrice ?? ''),
    cashDiscount: String(body.cashDiscount ?? ''),
    payment: String(body.payment ?? ''),
    paymentFrequency: String(body.paymentFrequency ?? ''),
    paymentCount: String(body.paymentCount ?? ''),
    statedRate: String(body.statedRate ?? ''),
    downPayment: String(body.downPayment ?? ''),
    tradeAllowance: String(body.tradeAllowance ?? ''),
    tradePayoff: String(body.tradePayoff ?? ''),
    balloon: String(body.balloon ?? ''),
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
    // Per-field messages attach to their rows; everything lands in the banner
    // too, because region and frequency issues have no row of their own.
    const issues = new Map<string, string>();
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field !== '' && !issues.has(field)) issues.set(field, issue.message);
    }
    c.executionCtx.waitUntil(recordEvent(c, 'decode_rejected', null, { problems, path: 'ledger' }));
    return refuseLedger(c, body, problems, issues);
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
    balloonCents: form.balloon,
    country: form.country,
    fees,
  };

  const decoded = decodeLedger(ledger);
  if (decoded.realRateAllInBps === null && decoded.unavailableReason !== null) {
    c.executionCtx.waitUntil(recordEvent(c, 'decode_unpriceable', null, { reason: decoded.unavailableReason }));
    return refuseLedger(
      c,
      body,
      ['Those numbers do not add up to a deal we can price. Check the payment and how many there are against your paper.'],
      new Map(),
    );
  }

  // Tier-1 rows only, most recent card first. The engine picks the band.
  const rows = await c.env.DB.prepare(
    `SELECT id, source, source_url, as_of_date, amount_band, amount_min_cents, amount_max_cents,
            term_band, term_min_months, term_max_months, rate_bps, rate_kind, tier, country, valid_through
       FROM benchmarks
      WHERE tier = 1 AND as_of_date = (SELECT MAX(as_of_date) FROM benchmarks WHERE tier = 1)`,
  ).all<Record<string, string | number | null>>();

  const allBenchmarks: BenchmarkRow[] = rows.results.map((row) => ({
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
    validThrough: row.valid_through === null ? null : String(row.valid_through),
  }));

  // The staleness gate (spec.md section 4): a card past its own printed
  // validity is not a benchmark, and the decode abstains rather than stamping
  // against a rate nobody is offering.
  const { current: benchmarks, lapsed: benchmarkLapsed } = benchmarksCurrentOn(
    allBenchmarks,
    new Date().toISOString().slice(0, 10),
  );

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
    benchmarkLapsed,
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
       amount_financed_cents, payment_amount_cents, payment_frequency, payment_count, balloon_cents,
       term_months, stated_rate_bps, fees_json,
       real_rate_all_in_bps, reconciled, rate_convention, assumptions_json, verdict, verdict_ref_id,
       benchmark_at_ts, delta_vs_benchmark_bps,
       country, currency, province_or_state, out_of_bounds,
       quote_date, quote_expiry_date, launched_standalone,
       price_band, term_band, referrer, brand, synthetic
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    decodeId, ts, quarterOf(ts),
    form.quotedPrice, form.cashDiscount, decoded.totals.cashOutlayCents,
    form.downPayment, form.tradeAllowance, form.tradePayoff,
    form.deliverySetup, form.taxCash, form.taxFinance,
    decoded.totals.amountFinancedCents, form.payment, form.paymentFrequency, form.paymentCount, form.balloon,
    termMonths, form.statedRate, JSON.stringify(fees),
    decoded.realRateAllInBps, decoded.reconciliation.reconciled ? 1 : 0,
    // The receipt for reconciled = 1: which lawful compounding reading held.
    // Null when nothing reconciled; the best-attempt reading is not a claim.
    decoded.reconciliation.reconciled ? decoded.reconciliation.convention : null,
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
    isSynthetic(c) ? 1 : 0,
  ).run();

  const eventId = await recordEvent(c, 'decode', decodeId, {
    ...campaignFromBody(body),
    path: 'ledger',
    // The ledger arrives off the confirm screen, which is the camera hero's
    // landing. photo_count is what the farmer's browser claimed, clamped to
    // the same ceiling the upload route enforces for real.
    entry: 'hero',
    photo_count: Math.min(4, Math.max(0, Math.trunc(Number(body.photoCount)) || 0)),
    real_rate_all_in_bps: decoded.realRateAllInBps,
    verdict: verdict.verdict,
    country,
    out_of_bounds: bounds.outOfBounds ? bounds.reasons : undefined,
  });
  measureAd(c, 'Decode', eventId, fbc);

  // The extraction flywheel. Only written when the ledger came off a photo.
  const diff = extractionDiff(String(body.extracted ?? ''), body);
  if (diff !== null) {
    c.executionCtx.waitUntil(recordEvent(c, 'extraction_diff', decodeId, {
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
    balloonCents: form.balloon,
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
    missing: missingForVerdict(verdict.noVerdictReason, decoded.reconciliation.differenceCents, country),
    lines: [
      { label: 'Quoted price', amount: formatCurrency(form.quotedPrice) },
      { label: 'Cash discount', amount: `− ${formatCurrency(form.cashDiscount)}` },
      { label: 'Trade, net of payoff', amount: formatCurrency(decoded.totals.netTradeCents) },
      { label: 'Due at signing', amount: formatCurrency(form.downPayment) },
      { label: 'Cash price today', amount: formatCurrency(decoded.totals.cashOutlayCents) },
      { label: 'Amount financed', amount: formatCurrency(decoded.totals.amountFinancedCents) },
      { label: 'Total of payments', amount: formatCurrency(decoded.totalOfPaymentsCents) },
      ...(form.balloon > 0 ? [{ label: 'Balloon at the end', amount: formatCurrency(form.balloon) }] : []),
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
      + 'A trade, down payment, tax, fee, balloon, or add-on may be missing. Confirm it before we rate this deal.',
    ];
  }
  if (reason === 'benchmark_lapsed') {
    return [
      'The published card we compare against lapsed and the current one is not entered yet. '
      + 'Your math is above; the stamp waits for a card that is actually on offer.',
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
    'INSERT INTO emails (id, email, decode_id, created_at, followup_text_version, synthetic) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    emailId, parsed.data.email, parsed.data.decodeId, new Date().toISOString(),
    FOLLOWUP_TEXT_VERSION, isSynthetic(c) ? 1 : 0,
  ).run();

  const sent = await sendTeardown(c.env, {
    emailId, to: parsed.data.email, row, origin: new URL(c.req.url).origin,
  });

  if (!sent.ok) {
    c.executionCtx.waitUntil(recordEvent(c, 'email_failed', parsed.data.decodeId, { status: sent.status }));
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

  // Measured in the events table only. Meta hears about decodes and nothing
  // else (spec.md §10, one event not three), so nothing fires here.
  await recordEvent(c, 'email', parsed.data.decodeId, {});

  // The confirmation screen carries the second opt-in, and only when the
  // farmer's own paper gives us a date to remind him about. No date, no offer.
  const expiry = typeof row.quote_expiry_date === 'string' ? row.quote_expiry_date : null;
  return c.html(renderSent(emailId, expiry));
});

// The row id is the token, so no address is ever put in a URL.
//
// The plain link in an email body lands on GET, which renders a confirm page
// and touches nothing: mail security scanners prefetch every link with GET,
// and a GET that mutated was a phantom unsubscribe machine. It renders the
// same page whatever the id, so it cannot confirm which addresses we hold.
app.get('/unsubscribe/:id', (c) => c.html(renderUnsubscribeConfirm(c.req.param('id'))));

// The mutation. RFC 8058 one-click POSTs land here directly; the confirm page
// button lands here too. The opt-out law is about the address, not the row: a
// farmer with three teardowns has three rows and one no, and it means all of
// them.
app.post('/unsubscribe/:id', async (c) => {
  const result = await c.env.DB.prepare(
    `UPDATE emails SET unsubscribed_at = ?
      WHERE email = (SELECT email FROM emails WHERE id = ?)
        AND unsubscribed_at IS NULL`,
  ).bind(new Date().toISOString(), c.req.param('id')).run();
  c.executionCtx.waitUntil(recordEvent(c, 'unsubscribe', null, {
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

  // Measured in the events table only. Meta hears about decodes and nothing
  // else (spec.md §10, one event not three), so nothing fires here either way.
  await recordEvent(c, answer === 'yes' ? 'interest_yes' : 'interest_not_now', decodeId || null, {});

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
  // CCPA opt-out. Footer-linked site-wide, because a rights link nobody can
  // find is not a rights path (spec.md §10, lawyer stone 2).
  ['/do-not-sell', renderDoNotSell],
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

  c.executionCtx.waitUntil(recordEvent(c, 'reminder_opt_in', null, { remind_on: remindOn }));

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
  await recordEvent(c, name);
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
