import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderVerdictTicket, type VerdictTicketView } from '../src/web/page.js';

// THE FIREWALL — spec.md §3.1.
//
// The verdict judges the paper the farmer already holds. It is arithmetic
// against a published card, not a lead qualifier and not an argument for
// anything we might later sell.
//
// A firewall with one wall is a funnel, so this asserts both directions and
// the property that ties them: the question does not move with the answer.

const PAGE = new URL('../src/web/page.ts', import.meta.url);
const DESIGN = new URL('../docs/design.md', import.meta.url);

/** Words that would turn a stamp into a sales cue. */
const BUSINESS_WORDS = [
  'partner', 'refinance', 'refinancing', 'compete', 'competing',
  'lender could', 'hear from', 'introduction', 'quote this deal',
  'interest question', 'better rate elsewhere', 'we can find',
];

/**
 * Words that would let the business lean on the verdict for leverage.
 *
 * Stems, not phrases. The first version of this list held 'checks out' and
 * sailed straight past a planted "Your deal did not check out", which is
 * exactly the sentence the firewall exists to stop. A blocklist of whole
 * phrases only catches the violation you already imagined.
 */
const VERDICT_WORDS = [
  'check', 'closer', 'stamp', 'verdict', 'rate', 'basis point',
  'comparable', 'published', 'overpay', 'too high', 'too much',
  'save', 'saving', 'cheaper', 'expensive', 'higher than', 'lower than',
];

const view = (verdict: VerdictTicketView['verdict']): VerdictTicketView => ({
  rate: '9.90%',
  verdict,
  verdictLine: verdict === 'checks_out'
    ? "This deal checks out. We'd take it."
    : verdict === 'look_closer'
      ? 'Look closer. This deal prices at 9.90%. The comparable published rate is 7.25%. '
        + 'The difference costs you $3,726 over the term.'
      : 'We can show you the rate. We are not rating this deal yet.',
  lines: [{ label: 'Quoted price', amount: '$62,000' }],
  reference: 'Comparable published equipment rate: 7.25%, subject to approval. AgDirect, '
    + '$25,000-$99,999, 4 years, fixed, as of 2026-08-01.',
  footnote: 'This is not the legal APR.',
  missing: verdict === 'none' ? ['A trade-in, and whatever is still owed on it'] : [],
  assumption: null,
  gate: { decodeId: '00000000-0000-4000-8000-000000000000' },
});

/** The verdict half of the ticket: everything above the gates. */
function verdictHalf(html: string): string {
  const end = html.indexOf('<div class="gate');
  return (end === -1 ? html : html.slice(0, end))
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();
}

/** The business half: the gates, and nothing above them. */
function businessHalf(html: string): string {
  const start = html.indexOf('<div class="gate');
  expect(start, 'the ticket rendered no gate block to test').toBeGreaterThan(-1);
  // Stops at the footer. The footer is site chrome that appears on every page
  // including pages with no gate at all, so counting it as "the business half"
  // made the canonical trust line look like the gates were quoting the verdict.
  const end = html.indexOf('<footer', start);
  return html.slice(start, end === -1 ? undefined : end)
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();
}

describe('the verdict never references the business', () => {
  for (const verdict of ['checks_out', 'look_closer', 'none'] as const) {
    it(`${verdict} says nothing about partners, refinancing or the question below it`, () => {
      const half = verdictHalf(renderVerdictTicket(view(verdict)));
      for (const word of BUSINESS_WORDS) {
        expect(half, `the ${verdict} verdict says "${word}"`).not.toContain(word);
      }
    });
  }

  it('never tells the farmer what to do about a bad number', () => {
    // A LOOK CLOSER says the deal prices above the card. The moment it says
    // what to do about that, the stamp is selling.
    const half = verdictHalf(renderVerdictTicket(view('look_closer')));
    for (const nudge of ['you should', 'we can help', 'talk to', 'get a better', 'shop it']) {
      expect(half).not.toContain(nudge);
    }
  });

  it('keeps the canonical examples clean too', async () => {
    const design = await readFile(DESIGN, 'utf8');
    const canon = design.slice(
      design.indexOf('<!-- canon:start -->'),
      design.indexOf('<!-- canon:end -->'),
    ).toLowerCase();
    expect(canon.length).toBeGreaterThan(0);
    for (const word of BUSINESS_WORDS) {
      expect(canon, `canon says "${word}"`).not.toContain(word);
    }
  });
});

describe('the business never references the verdict', () => {
  it('asks its one question and carries no argument', () => {
    const half = businessHalf(renderVerdictTicket(view('look_closer')));
    // The gate block is the email gate plus the interest question. Neither may
    // reach for the number above it as leverage.
    for (const word of VERDICT_WORDS) {
      expect(half, `the gates say "${word}"`).not.toContain(word);
    }
  });

  it('never quotes a rate at the farmer while asking', () => {
    const half = businessHalf(renderVerdictTicket(view('look_closer')));
    expect(half).not.toMatch(/\d+\.\d+\s*%/);
    expect(half).not.toMatch(/\$\d/);
  });

  it('keeps the interest wording free of the verdict in source, not just in render', async () => {
    const page = await readFile(PAGE, 'utf8');
    const block = page.slice(page.indexOf('function interestBlock'), page.indexOf('export interface VerdictTicketView'));
    const rendered = block.slice(block.indexOf('return `')).toLowerCase();
    for (const word of VERDICT_WORDS) {
      expect(rendered, `the interest block says "${word}"`).not.toContain(word);
    }
  });
});

describe('the question does not move with the answer', () => {
  it('renders identically whatever the verdict was', () => {
    // Showing the question only to farmers whose deals looked expensive would
    // be steering by omission, which is the same sin performed quietly.
    const good = businessHalf(renderVerdictTicket(view('checks_out')));
    const amber = businessHalf(renderVerdictTicket(view('look_closer')));
    const none = businessHalf(renderVerdictTicket(view('none')));
    expect(amber).toBe(good);
    expect(none).toBe(good);
  });

  it('offers the disclosure beside the question, which is the one permitted crossing', () => {
    // FTC guidance wants the disclosure near the action. It runs from the
    // business toward the truth about it, never from the verdict toward the
    // business.
    const html = renderVerdictTicket(view('checks_out'));
    expect(businessHalf(html)).toContain('how we make money');
    expect(verdictHalf(html)).not.toContain('how we make money');
  });
});


describe('the firewall is wired in production, not only in the template', () => {
  // renderVerdictTicket obeys the firewall, but the route decides what it is
  // handed. Everything above tests the template; this tests the wiring, which
  // is the part that could quietly start passing a verdict into the gate.
  it('hands the gate a decode id and nothing about the verdict', async () => {
    const worker = await readFile(new URL('../src/api/worker.ts', import.meta.url), 'utf8');
    const wiring = /gate:\s*emailSendable\(c\.env\)\s*===\s*null\s*\?\s*null\s*:\s*\{([^}]*)\}/
      .exec(worker);
    expect(wiring, 'the verdict route no longer wires the gate the way this test expects').not.toBeNull();

    const handed = (wiring as RegExpExecArray)[1] as string;
    // Exactly the decode id. Not the verdict, not the rate, not the delta.
    expect(handed.trim()).toBe('decodeId');
    for (const leak of ['verdict', 'rate', 'delta', 'benchmark', 'cohort']) {
      expect(handed.toLowerCase(), `the route hands "${leak}" to the gate`).not.toContain(leak);
    }
  });

  it('renders the same gate whatever verdict the route computed', async () => {
    const worker = await readFile(new URL('../src/api/worker.ts', import.meta.url), 'utf8');
    // A conditional on verdict anywhere near the gate wiring would be steering
    // by omission, which is the sin spec.md §3.1 names.
    const around = worker.slice(
      Math.max(0, worker.indexOf('gate: emailSendable') - 400),
      worker.indexOf('gate: emailSendable') + 200,
    );
    expect(around).not.toMatch(/verdict\s*===\s*'(checks_out|look_closer|none)'[^;]*gate/);
  });
});
