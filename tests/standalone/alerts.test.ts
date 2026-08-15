import { describe, expect, it } from 'vitest';
import {
  evaluateAlert,
  PAYMENT_DUE_LEAD_DAYS,
  type AlertEvaluation,
  type AlertRuleSnapshot,
} from '../../standalone/src/alerts.js';
import type { PublicRateRecord } from '../../src/shared/schema.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');

function rate(overrides: Partial<PublicRateRecord> = {}): PublicRateRecord {
  return {
    source: 'https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json',
    series: 'SOFR',
    valueBps: 420,
    asOf: '2026-08-13',
    retrievedAt: NOW.toISOString(),
    status: 'fresh',
    sourceUrl: 'https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json',
    label: 'SOFR',
    ...overrides,
  };
}

function snapshot(overrides: Partial<AlertRuleSnapshot> = {}): AlertRuleSnapshot {
  return {
    kind: 'public_rate_threshold',
    benchmarkSeries: 'SOFR',
    thresholdBps: 450,
    direction: 'at_or_below',
    lastReferenceState: 'not_met',
    lastNotifiedAt: null,
    maturityDate: null,
    // A loan with no payment schedule at all is the neutral starting point:
    // every kind that predates `payment_due` decides exactly as it always did.
    paymentFrequency: null,
    nextPaymentDate: null,
    remainingPayments: null,
    leadDays: null,
    ...overrides,
  };
}

describe('watch evaluation', () => {
  it('fires a threshold watch only on a crossing, not on every run', () => {
    const crossing = evaluateAlert(snapshot(), NOW, new Map([['SOFR', rate()]]));
    expect(crossing.trigger).toBe(true);
    expect(crossing.state).toBe('met');

    const alreadyMet = evaluateAlert(snapshot({ lastReferenceState: 'met' }), NOW, new Map([['SOFR', rate()]]));
    expect(alreadyMet.trigger).toBe(false);
  });

  it('respects the cooldown after a recent notification', () => {
    const recent = evaluateAlert(
      snapshot({ lastNotifiedAt: new Date(NOW.getTime() - 86_400_000).toISOString() }),
      NOW,
      new Map([['SOFR', rate()]]),
    );
    expect(recent.trigger).toBe(false);
  });

  it('never fires on a stale or unavailable reference', () => {
    for (const status of ['stale', 'unavailable'] as const) {
      const result = evaluateAlert(snapshot(), NOW, new Map([['SOFR', rate({ status })]]));
      expect(result.trigger, status).toBe(false);
      expect(result.dedupeKey, status).toBe('unavailable');
    }
    const missingValue = evaluateAlert(snapshot(), NOW, new Map([['SOFR', rate({ valueBps: null })]]));
    expect(missingValue.trigger).toBe(false);
    const missingSeries = evaluateAlert(snapshot(), NOW, new Map());
    expect(missingSeries.trigger).toBe(false);
  });

  it('fires a Canadian CORRA watch on a crossing exactly like the US series', () => {
    const corra = rate({ series: 'CORRA', label: 'CORRA', valueBps: 430, sourceUrl: 'https://www.bankofcanada.ca/valet/observations/CORRA/json?recent=1' });
    const crossing = evaluateAlert(
      snapshot({ benchmarkSeries: 'CORRA' }),
      NOW,
      new Map([['CORRA', corra]]),
    );
    expect(crossing.trigger).toBe(true);
    expect(crossing.dedupeKey).toBe('CORRA:2026-08-13:met');
  });

  it('keys deduplication on the series, its as-of date, and the state', () => {
    const result = evaluateAlert(snapshot(), NOW, new Map([['SOFR', rate()]]));
    expect(result.dedupeKey).toBe('SOFR:2026-08-13:met');
  });

  it('schedules the next maturity window and refuses to fire without a maturity date', () => {
    const withDate = evaluateAlert(snapshot({ kind: 'maturity', maturityDate: '2028-03-01' }), NOW, new Map());
    expect(withDate.trigger).toBe(true);
    expect(withDate.nextDueAt).toBeTruthy();

    const withoutDate = evaluateAlert(snapshot({ kind: 'maturity', maturityDate: null }), NOW, new Map());
    expect(withoutDate.trigger).toBe(false);
    expect(withoutDate.nextDueAt).toBeNull();
  });

  it('re-arms the annual recheck a year out', () => {
    const result = evaluateAlert(snapshot({ kind: 'annual_recheck' }), NOW, new Map());
    expect(result.trigger).toBe(true);
    expect(result.nextDueAt?.slice(0, 4)).toBe('2027');
  });

  /**
   * Frozen decisions of the ChatGPT Sites evaluator this one replaced.
   *
   * The two implementations were run side by side on these ten cases and agreed
   * on every field before the Sites deployment was deleted; this table is that
   * recording. It is the regression guard for the migration: if a change ever
   * makes a watch fire, or stop firing, at a different moment than the evaluator
   * farmers were already living with, one of these fails.
   *
   * Do not repair a failure by editing an expectation. Work out why the decision
   * moved.
   */
  const SITES_DECISIONS: Array<[string, AlertRuleSnapshot, PublicRateRecord | null, AlertEvaluation]> = [
    ['a fresh crossing', snapshot(), rate(),
      { trigger: true, state: 'met', nextDueAt: '2026-08-14T13:00:00.000Z', dedupeKey: 'SOFR:2026-08-13:met' }],
    ['a threshold already met', snapshot({ lastReferenceState: 'met' }), rate(),
      { trigger: false, state: 'met', nextDueAt: '2026-08-14T13:00:00.000Z', dedupeKey: 'SOFR:2026-08-13:met' }],
    ['a first evaluation with no prior state', snapshot({ lastReferenceState: 'unknown' }), rate(),
      { trigger: false, state: 'met', nextDueAt: '2026-08-14T13:00:00.000Z', dedupeKey: 'SOFR:2026-08-13:met' }],
    ['a reference that crossed back out', snapshot({ lastReferenceState: 'met' }), rate({ valueBps: 500 }),
      { trigger: false, state: 'not_met', nextDueAt: '2026-08-14T13:00:00.000Z', dedupeKey: 'SOFR:2026-08-13:not_met' }],
    ['an at-or-above threshold', snapshot({ direction: 'at_or_above', thresholdBps: 300 }), rate(),
      { trigger: true, state: 'met', nextDueAt: '2026-08-14T13:00:00.000Z', dedupeKey: 'SOFR:2026-08-13:met' }],
    ['a crossing inside the cooldown', snapshot({ lastNotifiedAt: new Date(NOW.getTime() - 86_400_000).toISOString() }), rate(),
      { trigger: false, state: 'met', nextDueAt: '2026-08-14T13:00:00.000Z', dedupeKey: 'SOFR:2026-08-13:met' }],
    ['a stale reference', snapshot(), rate({ status: 'stale' }),
      { trigger: false, state: 'not_met', nextDueAt: '2026-08-14T13:00:00.000Z', dedupeKey: 'unavailable' }],
    ['an annual recheck', snapshot({ kind: 'annual_recheck' }), null,
      { trigger: true, state: 'due', nextDueAt: '2027-08-14T12:00:00.000Z', dedupeKey: 'annual:2026-08-14' }],
    ['a maturity watch with a date', snapshot({ kind: 'maturity', maturityDate: '2028-03-01' }), null,
      { trigger: true, state: 'due', nextDueAt: '2026-09-01T12:00:00.000Z', dedupeKey: 'maturity:2028-03-01:2026-08-14' }],
    ['a maturity watch with no date', snapshot({ kind: 'maturity', maturityDate: null }), null,
      { trigger: false, state: 'due', nextDueAt: null, dedupeKey: 'maturity:unknown:2026-08-14' }],
  ];

  it.each(SITES_DECISIONS)('decides %s exactly as the evaluator it replaced did', (_name, rule, reference, expected) => {
    const rates = new Map(reference ? [[reference.series, reference]] : []);
    expect(evaluateAlert(rule, NOW, rates)).toEqual(expected);
  });
});

describe('payment_due decisions', () => {
  /**
   * A payment reminder fires once per payment, inside a lead window the user
   * can set. Every expectation below is a decision about *when* — the copy that
   * eventually goes out carries no date, amount, or balance at all.
   *
   * Dates are pinned at noon UTC throughout, the same instant convention the
   * maturity windows use, so a reminder cannot slide a day either way when a
   * reader is east or west of UTC.
   */
  const PAYMENT_DECISIONS: Array<[string, Partial<AlertRuleSnapshot>, Date, AlertEvaluation]> = [
    [
      'a monthly payment inside the seven-day default window',
      { paymentFrequency: 'monthly', nextPaymentDate: '2026-08-20', remainingPayments: 12 },
      NOW,
      {
        trigger: true,
        state: 'due',
        nextDueAt: '2026-09-13T12:00:00.000Z',
        dedupeKey: 'payment_due:2026-08-20',
      },
    ],
    [
      'a monthly payment still outside the window',
      { paymentFrequency: 'monthly', nextPaymentDate: '2026-09-20', remainingPayments: 12 },
      NOW,
      {
        trigger: false,
        state: 'due',
        nextDueAt: '2026-09-13T12:00:00.000Z',
        dedupeKey: 'payment_due:2026-09-20',
      },
    ],
    [
      'the same window seen again five days later',
      { paymentFrequency: 'monthly', nextPaymentDate: '2026-08-20', remainingPayments: 12 },
      new Date('2026-08-19T23:00:00.000Z'),
      {
        trigger: true,
        state: 'due',
        nextDueAt: '2026-09-13T12:00:00.000Z',
        dedupeKey: 'payment_due:2026-08-20',
      },
    ],
    [
      'a chosen lead time of 21 days reaching a payment the default would not',
      { paymentFrequency: 'monthly', nextPaymentDate: '2026-09-01', remainingPayments: 12, leadDays: 21 },
      NOW,
      {
        trigger: true,
        state: 'due',
        nextDueAt: '2026-09-10T12:00:00.000Z',
        dedupeKey: 'payment_due:2026-09-01',
      },
    ],
    [
      'the same payment under the seven-day default instead',
      { paymentFrequency: 'monthly', nextPaymentDate: '2026-09-01', remainingPayments: 12 },
      NOW,
      {
        trigger: false,
        state: 'due',
        nextDueAt: '2026-08-25T12:00:00.000Z',
        dedupeKey: 'payment_due:2026-09-01',
      },
    ],
    [
      'a schedule back-counted from maturity when no next payment date was confirmed',
      { paymentFrequency: 'quarterly', maturityDate: '2027-02-20', remainingPayments: 3 },
      NOW,
      {
        trigger: true,
        state: 'due',
        nextDueAt: '2026-11-13T12:00:00.000Z',
        dedupeKey: 'payment_due:2026-08-20',
      },
    ],
    [
      'a loan with no regular frequency',
      { paymentFrequency: 'irregular', nextPaymentDate: '2026-08-20', remainingPayments: 12 },
      NOW,
      { trigger: false, state: 'due', nextDueAt: null, dedupeKey: 'payment_due:none' },
    ],
    [
      'a loan with a frequency but nothing dated to hang it on',
      { paymentFrequency: 'monthly' },
      NOW,
      { trigger: false, state: 'due', nextDueAt: null, dedupeKey: 'payment_due:none' },
    ],
    [
      'a schedule whose remaining payments are all behind us',
      { paymentFrequency: 'monthly', nextPaymentDate: '2026-01-15', remainingPayments: 3 },
      NOW,
      { trigger: false, state: 'due', nextDueAt: null, dedupeKey: 'payment_due:none' },
    ],
    [
      'a 29 February anchor clamping into a common year',
      { paymentFrequency: 'annual', nextPaymentDate: '2028-02-29', remainingPayments: 5 },
      new Date('2029-02-01T12:00:00.000Z'),
      {
        trigger: true,
        state: 'due',
        nextDueAt: '2030-01-29T12:00:00.000Z',
        dedupeKey: 'payment_due:2029-02-28',
      },
    ],
    [
      'that same anchor returning to 29 February in the next leap year, on its final payment',
      { paymentFrequency: 'annual', nextPaymentDate: '2028-02-29', remainingPayments: 5 },
      new Date('2032-02-01T12:00:00.000Z'),
      {
        trigger: true,
        state: 'due',
        nextDueAt: null,
        dedupeKey: 'payment_due:2032-02-29',
      },
    ],
  ];

  it.each(PAYMENT_DECISIONS)('decides %s', (_name, overrides, now, expected) => {
    expect(evaluateAlert(snapshot({ kind: 'payment_due', ...overrides }), now, new Map())).toEqual(expected);
  });

  it('reminds a monthly or quarterly payer a week out and a longer-cycle payer a month out', () => {
    expect(PAYMENT_DUE_LEAD_DAYS).toEqual({ monthly: 7, quarterly: 7, semiannual: 30, annual: 30 });
  });

  it('keeps one dedupe key for one payment across every evaluation inside its window', () => {
    const rule = snapshot({
      kind: 'payment_due',
      paymentFrequency: 'monthly',
      nextPaymentDate: '2026-08-20',
      remainingPayments: 12,
    });
    const keys = new Set(
      ['2026-08-13T12:00:00.000Z', '2026-08-14T12:00:00.000Z', '2026-08-19T23:00:00.000Z']
        .map((instant) => evaluateAlert(rule, new Date(instant), new Map()))
        .map((decision) => {
          expect(decision.trigger).toBe(true);
          return decision.dedupeKey;
        }),
    );
    expect([...keys]).toEqual(['payment_due:2026-08-20']);
  });

  it('advances to the next payment once the current one is behind the borrower', () => {
    const rule = snapshot({
      kind: 'payment_due',
      paymentFrequency: 'monthly',
      nextPaymentDate: '2026-08-20',
      remainingPayments: 12,
    });
    const inWindow = evaluateAlert(rule, NOW, new Map());
    const afterPayment = evaluateAlert(rule, new Date('2026-09-14T12:00:00.000Z'), new Map());
    expect(inWindow.nextDueAt).toBe('2026-09-13T12:00:00.000Z');
    expect(afterPayment.dedupeKey).toBe('payment_due:2026-09-20');
    expect(afterPayment.nextDueAt).toBe('2026-10-13T12:00:00.000Z');
  });
});
