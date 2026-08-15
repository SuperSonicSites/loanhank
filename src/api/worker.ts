// Worker types are imported, never referenced globally: they redefine Buffer
// and URL, and the engine tests run on the Node types.
import type {
  D1Database,
  ExecutionContext,
  R2Bucket,
  ScheduledController,
} from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { formatCurrency, formatRate, promoPriceRate } from '../finance/index.js';
import { quickPathFormSchema } from '../shared/schema.js';
import { renderForm, renderTicket, renderUnpriceable, type FormValues } from '../web/page.js';

// Must match the crons in wrangler.jsonc. An unrecognized cron logs and does
// nothing rather than falling into the wrong branch.
const REAPER_CRON = '*/15 * * * *';
const BACKUP_CRON = '0 7 * * *';

export interface Env {
  DB: D1Database;
  QUOTES: R2Bucket;
  BACKUPS: R2Bucket;
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

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
  // The funnel denominator. Written behind waitUntil so measuring never
  // stands between a farmer on rural LTE and the form.
  c.executionCtx.waitUntil(recordEvent(c.env, 'page_view'));
  return c.html(renderForm());
});

app.post('/decode', async (c) => {
  const body = await c.req.parseBody();
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

export default {
  fetch: app.fetch,

  // Both crons log on every fire, wired or not. A cron that silently does
  // nothing and a cron that silently fails look identical in the dashboard,
  // and the reaper is what keeps the photo-deletion promise.
  scheduled(event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    switch (event.cron) {
      case REAPER_CRON:
        console.log('cron reaper: not wired yet, no photos to reap');
        break;
      case BACKUP_CRON:
        console.log('cron backup: not wired yet, no rows to export');
        break;
      default:
        console.log(`cron unrecognized: ${event.cron}, nothing ran`);
    }
  },
};
