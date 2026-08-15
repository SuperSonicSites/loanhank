import { describe, expect, it } from 'vitest';
import { annualRecheckAt, maturityWatchWindows, nextMaturityWindow } from '../../standalone/src/alert-schedule.js';

/**
 * These exact values decide when a farmer is told a financing event is close.
 * The assertions were carried over verbatim from the ChatGPT Sites test suite
 * when that deployment was removed — they are the only place the month-end and
 * leap-year clamping behaviour is pinned, and the dates are chosen precisely
 * because they exercise it.
 */
describe('maturity and recheck scheduling', () => {
  it('uses exact 18/12/6-month and 90/30-day maturity windows', () => {
    expect(maturityWatchWindows('2028-02-29')).toEqual([
      '2026-08-29T12:00:00.000Z',
      '2027-02-28T12:00:00.000Z',
      '2027-08-29T12:00:00.000Z',
      '2027-12-01T12:00:00.000Z',
      '2028-01-30T12:00:00.000Z',
    ]);
  });

  it('picks the next window strictly after the moment asked about', () => {
    expect(nextMaturityWindow('2028-02-29', new Date('2027-03-01T00:00:00Z'))).toBe('2027-08-29T12:00:00.000Z');
  });

  it('clamps an annual recheck onto a shorter target month', () => {
    expect(annualRecheckAt('2028-02-29T17:30:00.000Z')).toBe('2029-02-28T17:30:00.000Z');
  });

  it('returns no windows for an unparseable maturity date rather than guessing', () => {
    expect(maturityWatchWindows('not-a-date')).toEqual([]);
    expect(nextMaturityWindow('not-a-date', new Date('2027-03-01T00:00:00Z'))).toBeNull();
  });

  it('returns no further window once every one has passed', () => {
    expect(nextMaturityWindow('2028-02-29', new Date('2028-02-28T00:00:00Z'))).toBeNull();
  });
});
