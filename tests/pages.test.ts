import { describe, expect, it } from 'vitest';
import { COHORT_MIN_N, PEER_POLICY_VERSION, VERDICT_BUFFER_VERSION } from '../src/finance/index.js';
import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  renderContact,
  renderHowWeFigureIt,
  renderHowWeMakeMoney,
  renderManifest,
  renderNotFound,
  renderPrivacy,
  renderStraightAnswers,
  renderTerms,
  renderWhosBehindThis,
} from '../src/web/pages.js';

const PAGES: Array<[string, string]> = [
  ['privacy', renderPrivacy()],
  ['terms', renderTerms()],
  ['how-we-make-money', renderHowWeMakeMoney()],
  ['how-we-figure-it', renderHowWeFigureIt()],
  ['straight-answers', renderStraightAnswers()],
  ['contact', renderContact()],
  ['whos-behind-this', renderWhosBehindThis()],
  ['404', renderNotFound()],
];

/** Strip tags so voice rules are checked against what a farmer actually reads. */
const prose = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');

describe('Hank voice holds on every page', () => {
  it.each(PAGES)('%s uses no em dashes', (_name, html) => {
    // design.md §2: comma, period, or a new sentence. An em dash is the single
    // most reliable tell that a machine wrote the sentence.
    expect(prose(html)).not.toMatch(/—/);
  });

  it.each(PAGES)('%s uses no exclamation marks', (_name, html) => {
    expect(prose(html)).not.toMatch(/!/);
  });

  it.each(PAGES)('%s avoids the banned startup vocabulary', (_name, html) => {
    for (const word of ['unlock', 'supercharge', 'empower', 'journey', 'seamless', 'leverage']) {
      expect(prose(html).toLowerCase()).not.toContain(word);
    }
  });

  it.each(PAGES)('%s carries the footer nav to every other page', (_name, html) => {
    for (const href of ['/privacy', '/terms', '/how-we-figure-it', '/contact']) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});

describe('privacy says what the machinery actually does', () => {
  const html = prose(renderPrivacy());

  it('states plainly that the photo is never saved', () => {
    expect(html).toContain('Your photo is never saved.');
    expect(html).toContain('gone when the answer comes back');
  });

  it('states the one-day backstop without pretending it is the promise', () => {
    // The rule cannot express ten seconds. Saying so is the point.
    expect(html).toContain('deletes everything in it after a day');
    expect(html).toContain('Today nothing writes to it at all.');
  });

  it('names what can never be stored', () => {
    expect(html).toContain('has nowhere to put any of them');
    expect(html).toContain('We rank quotes. We never rank dealers.');
  });

  it('carries a version, because the text somebody saw is the text that binds', () => {
    expect(html).toContain(PRIVACY_VERSION);
  });

  it('promises no cookie banner and explains why there is none', () => {
    expect(html).toContain('no cookie banner');
  });
});

describe('terms describe today, and say so', () => {
  const html = prose(renderTerms());

  it('is versioned as pre-counsel so the two texts stay distinct records', () => {
    expect(TERMS_VERSION).toContain('pre-counsel');
    expect(html).toContain(TERMS_VERSION);
  });

  it('states the three facts that are true today', () => {
    expect(html).toContain('We are not a lender.');
    expect(html).toContain('We do not arrange, broker or place financing.');
    expect(html).toContain('no such handoff exists in this product today');
  });

  it('does not overclaim about future versions', () => {
    // The sentence becomes load-bearing the day consent ships. It has to read
    // as a description of the present, not a promise about every version.
    expect(html).toContain('not a promise about every future version');
  });

  it('refuses to promise a saving', () => {
    expect(html).toContain('We do not guarantee any saving');
    expect(html).toContain('subject to credit approval');
  });
});

describe('how we figure it shows the work', () => {
  const html = prose(renderHowWeFigureIt());

  it('prints the buffer policy version', () => {
    expect(html).toContain(VERDICT_BUFFER_VERSION);
    expect(html).toContain('is our policy, not a discovered truth');
  });

  it('prints the peer policy version', () => {
    expect(html).toContain(PEER_POLICY_VERSION);
  });

  it('tells a farmer how to reproduce our median himself', () => {
    // The receipt test, extended to statistics.
    expect(html).toContain("PERCENTILE.INC");
    expect(html).toContain('you will get our answer back');
  });

  it('states the n floor out loud', () => {
    expect(html).toContain(String(COHORT_MIN_N));
  });

  it('names the source, the date and the archive', () => {
    expect(html).toContain('AgDirect');
    expect(html).toContain('2026-08-01');
    expect(html).toContain('archived copy');
  });

  it('says a published rate is not an offer', () => {
    expect(html).toContain('not an offer to you');
  });

  it('admits what would make us wrong', () => {
    expect(html).toContain('What would make us wrong');
  });
});

describe('the pages that depend on facts we do not have yet', () => {
  it('contact refuses to print a placeholder postal address', () => {
    const html = prose(renderContact());
    expect(html).toContain('not going to put a placeholder address');
  });

  it("who's behind this admits it is unfinished rather than inventing a person", () => {
    const html = prose(renderWhosBehindThis());
    expect(html).toContain('This page is not finished');
    // The failure mode to guard against is a plausible invented byline.
    expect(html).not.toMatch(/\bby [A-Z][a-z]+ [A-Z][a-z]+\b/);
  });
});

describe('how we make money makes the damaging admission', () => {
  const html = prose(renderHowWeMakeMoney());

  it('says we earn nothing today', () => {
    expect(html).toContain('This tool earns nothing.');
  });

  it('names the angle instead of letting the reader guess it', () => {
    expect(html).toContain('Now you know our angle.');
  });

  it('says the verdict is not for sale', () => {
    expect(html).toContain('It does not buy a nudge.');
  });
});

describe('straight answers stays small', () => {
  it('answers between six and eight objections, not a knowledge base', () => {
    const questions = (renderStraightAnswers().match(/<h2>/g) ?? []).length;
    expect(questions).toBeGreaterThanOrEqual(6);
    expect(questions).toBeLessThanOrEqual(8);
  });
});

describe('the manifest installs the tool and nothing more', () => {
  const manifest = JSON.parse(renderManifest());

  it('has no service worker and no push', () => {
    // A cache that served yesterday's HTML would show yesterday's rate card
    // with today's confidence, on a tool whose whole brand is the number.
    expect(Object.keys(manifest)).not.toContain('serviceworker');
    expect(Object.keys(manifest)).not.toContain('gcm_sender_id');
  });

  it('does not ask to be installed as a standalone app', () => {
    // design.md §10: no app-store badges, nothing that interrupts.
    expect(manifest.display).toBe('browser');
  });

  it('uses the paper colour so the phone chrome matches the page', () => {
    expect(manifest.theme_color).toBe('#F7F5EF');
  });
});
