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
  matchBenchmark, promoPriceRate, quoteWithinSanityBounds, VERDICT_BUFFER_VERSION,
  type BenchmarkRow, type DealLedger, type LedgerFee,
} from '../finance/index.js';
import { hashAccessKey } from './security.js';
import {
  centsToInput, confirmableField, emailGateSchema, ledgerFormSchema, quickPathFormSchema,
  type ConfirmableField, type QuoteExtraction,
} from '../shared/schema.js';
import {
  renderConfirm, renderForm, renderNotice, renderTicket, renderUnpriceable, renderVerdictTicket,
  type ConfirmRow, type FormValues,
} from '../web/page.js';
import { assertUploadAllowed, PublicApiError } from './security.js';
import { OpenAIQuoteExtractor } from './extractor.js';
import { renderTeardownPdf, type TeardownLine } from './teardown-pdf.js';
import {
  renderContact, renderHowWeFigureIt, renderHowWeMakeMoney, renderManifest, renderNotFound,
  renderPrivacy, renderSent, renderStraightAnswers, renderTerms, renderWhosBehindThis,
} from '../web/pages.js';
import { getConfig } from './env.js';

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
  // Salted, because an unsalted hash of an IPv4 address is not an anonymised
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
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO events (id, event, decode_id, ts, meta_json) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), event, decodeId, new Date().toISOString(), JSON.stringify(meta))
    .run();
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
export async function sendDueReminders(env: Env, today: string): Promise<{ sent: number; failed: number }> {
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
    const unsubscribe = `${PUBLIC_ORIGIN}/unsubscribe/${row.id}`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${sendable.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: `Hank <${sendable.from}>`,
        to: [row.email],
        subject: `Your quote expires ${row.remind_on}`,
        text: [
          `The quote you ran through us is good until ${row.remind_on}.`,
          '',
          'That is the date printed on the dealer\'s own paper, not one we made up.',
          'If you are still deciding, it is worth knowing what the financing costs',
          'before the paper goes stale.',
          '',
          'This is the one note. We will not send another about this quote.',
          '',
          `P.S. If the deal checked out, go sign it. We said so for a reason.`,
          '',
          `Unsubscribe: ${unsubscribe}`,
          sendable.postalAddress,
        ].join('\n'),
        headers: {
          'List-Unsubscribe': `<${unsubscribe}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });

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

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  // A flood here would bloat the events table and the bill. The form still
  // renders when the limit trips; only the measurement row is dropped, because
  // refusing to show a farmer the tool is worse than an undercounted funnel.
  if (await withinRateLimit(c, 'page_view')) {
    // The funnel denominator. Written behind waitUntil so measuring never
    // stands between a farmer on rural LTE and the form.
    c.executionCtx.waitUntil(recordEvent(c.env, 'page_view'));
  }
  const siteKey = typeof c.env.TURNSTILE_SITE_KEY === 'string' ? c.env.TURNSTILE_SITE_KEY : '';
  return c.html(renderForm(undefined, [], { turnstileSiteKey: siteKey }));
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

  const parsed = quickPathFormSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message);
    c.executionCtx.waitUntil(recordEvent(c.env, 'decode_rejected', null, { problems }));
    return c.html(renderForm(raw, problems), 422);
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

  await recordEvent(c.env, 'decode', decodeId, {
    promo_price_rate_bps: result.promoPriceRateBps,
    payment_frequency: form.paymentFrequency,
  });

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
  }));
});

/** The verdict path: a complete ledger, a matched reference, and a stamp. */
async function decodeFullLedger(c: {
  env: Env;
  req: { parseBody: () => Promise<Record<string, unknown>> };
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
       quote_date, quote_expiry_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  ).run();

  await recordEvent(c.env, 'decode', decodeId, {
    path: 'ledger',
    real_rate_all_in_bps: decoded.realRateAllInBps,
    verdict: verdict.verdict,
    country,
    out_of_bounds: bounds.outOfBounds ? bounds.reasons : undefined,
  });

  // The extraction flywheel. Only written when the ledger came off a photo.
  const diff = extractionDiff(String(body.extracted ?? ''), body);
  if (diff !== null) {
    c.executionCtx.waitUntil(recordEvent(c.env, 'extraction_diff', decodeId, {
      corrected_fields: diff.map((entry) => entry.field),
      corrections: diff,
      field_count: Object.keys(JSON.parse(String(body.extracted))).length,
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
    'INSERT INTO emails (id, email, decode_id, created_at) VALUES (?, ?, ?, ?)',
  ).bind(emailId, parsed.data.email, parsed.data.decodeId, new Date().toISOString()).run();

  const origin = new URL(c.req.url).origin;
  const unsubscribe = `${origin}/unsubscribe/${emailId}`;
  const pdf = await renderTeardownPdf(teardownFromRow(row, sendable.postalAddress));

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sendable.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `Hank <${sendable.from}>`,
      to: [parsed.data.email],
      subject: 'Your teardown',
      text: [
        'Your teardown is attached. It is one page: the real rate, what the financing',
        'costs against paying cash, and where the comparison came from.',
        '',
        'Print it and take it to the desk. That is what it is for.',
        '',
        `P.S. If the deal checks out, go sign it. We will say so when it does.`,
        '',
        'You can add LoanHank to your phone home screen from the site, if you would',
        'rather not go looking for it next time.',
        '',
        `Unsubscribe: ${unsubscribe}`,
        sendable.postalAddress,
      ].join('\n'),
      attachments: [{ filename: 'loanhank-teardown.pdf', content: base64(pdf) }],
      headers: {
        // RFC 8058 one-click, plus the plain link in the body. CAN-SPAM, no
        // exceptions, and it works before anybody opens the attachment.
        'List-Unsubscribe': `<${unsubscribe}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
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

  await recordEvent(c.env, 'email', parsed.data.decodeId, {});

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

  await recordEvent(c.env, answer === 'yes' ? 'interest_yes' : 'interest_not_now', decodeId || null, {});

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
        console.log('cron backup: not wired yet, no rows to export');
        // The reminder sweep rides the daily cron. It is the delivery half of
        // an opt-in that would otherwise be a promise nobody keeps.
        ctx.waitUntil(sendDueReminders(env, new Date().toISOString().slice(0, 10)));
        break;
      default:
        console.log(`cron unrecognized: ${event.cron}, nothing ran`);
    }
  },
};
