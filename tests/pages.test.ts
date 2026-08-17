import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { COHORT_MIN_N, PEER_POLICY_VERSION, VERDICT_BUFFER_VERSION } from '../src/finance/index.js';
import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  renderContact,
  renderDoNotSell,
  renderHowWeFigureIt,
  renderHowWeMakeMoney,
  renderManifest,
  renderNotFound,
  renderPrivacy,
  renderStraightAnswers,
  renderTerms,
  renderNote,
  renderNotesIndex,
  renderWhosBehindThis,
  NOTES,
} from '../src/web/pages.js';
import { renderForm } from '../src/web/page.js';

/** The configured footer form, exactly as wrangler.jsonc carries it. */
const POSTAL = 'LoanHank · 109b - 1917 Peninsula Rd, Ucluelet, BC V0R 3A0, Canada';

const PAGES: Array<[string, string]> = [
  // The front door sweeps with everything else. It carries the whose-side
  // block and the worked ticket now, which is exactly the copy the banned
  // list below exists to police.
  ['home', renderForm(undefined, [], { turnstileSiteKey: 'sweep-check' })],
  ['privacy', renderPrivacy()],
  ['terms', renderTerms()],
  ['how-we-make-money', renderHowWeMakeMoney()],
  ['how-we-figure-it', renderHowWeFigureIt()],
  ['straight-answers', renderStraightAnswers()],
  ['contact', renderContact(POSTAL)],
  ['do-not-sell', renderDoNotSell()],
  ['whos-behind-this', renderWhosBehindThis()],
  ['404', renderNotFound()],
  // Every note obeys every copy law the rest of the site does, so they join
  // the same sweep rather than getting their own softer one.
  ['notes-index', renderNotesIndex()],
  ...NOTES.map((note) => [`note:${note.slug}`, renderNote(note)] as [string, string]),
];

/**
 * Strip markup so voice rules are checked against what a farmer actually reads.
 *
 * Script and style blocks come out WHOLE, before any tag stripping. Leaving
 * them to the tag regex is what let a `<` inside an inline script swallow
 * every line between it and `</script>`, which hid two exclamation marks and
 * would have hidden any real copy that followed them. A sweep that can quietly
 * eat its own input is worse than no sweep, so `provesItReadsTheBody` below
 * checks that the stripper left the page behind.
 */
const prose = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
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

  it.each(PAGES)('%s takes no side by label and frames no victim', (_name, html) => {
    // design.md §10 whose-side stones. The posture is the canon block; the
    // label and the victim framing are banned everywhere a farmer can read.
    const text = prose(html).toLowerCase();
    for (const banned of [
      'screwed', 'ripped off', 'scammed', 'tricked',
      'consumer advocacy', 'watchdog', 'on behalf of farmers',
    ]) {
      expect(text, `product copy says "${banned}"`).not.toContain(banned);
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
    expect(html).toContain('We never save your photo.');
    expect(html).toContain('our copy is gone');
  });

  it('names the reading service and what it may hold, rather than implying we are alone', () => {
    // The old paragraph described our own machinery honestly and stopped
    // there, which read as though nobody else ever touched the file. The
    // provider's abuse screening is a real thing a farmer would want to know.
    expect(html).toContain('does not train on it and does not keep it for us');
    expect(html).toContain('up to 30 days under their policy');
  });

  it('follows the photo paragraph with no future-tense sentence', () => {
    const start = html.indexOf('We never save your photo.');
    const paragraph = html.slice(start, start + 600);
    // A conditional about a future version of the tool used to sit here, and a
    // promise about the future is not what a privacy statement is for.
    expect(paragraph).not.toMatch(/will/);
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
    // Name the function a farmer's accountant would actually reach for. We
    // publish a median and quartiles, so QUARTILE.INC is the direct check.
    expect(html).toContain('QUARTILE.INC');
    expect(html).toContain('PERCENTILE.INC');
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
  it('contact prints the real postal address, verbatim', () => {
    // CAN-SPAM wants a valid physical address, and the same string has to
    // appear here and in every email footer, so it is printed and never
    // reformatted.
    const html = prose(renderContact(POSTAL));
    expect(html).toContain(POSTAL);
    expect(html).not.toContain('not going to put a placeholder address');
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

  it('is installable for real, and standalone once installed', () => {
    // Chrome dropped the service-worker requirement for installability, so
    // standalone costs nothing and buys the metric that matters: decodes
    // launched from the icon rather than from an ad every time.
    expect(manifest.display).toBe('standalone');
  });

  it('invites without interrupting', () => {
    // design.md §10: nothing interrupts. The invitation is one line on the
    // confirmation screen and one line in the delivery email. There is no
    // install banner and no prompt anywhere in the decode flow.
    expect(prose(renderNotFound())).not.toContain('Install');
    expect(prose(renderPrivacy())).not.toContain('Install');
  });

  it('uses the paper colour so the phone chrome matches the page', () => {
    expect(manifest.theme_color).toBe('#F7F5EF');
  });
});

describe('the sweep can actually see the page', () => {
  // A stripper that eats its input passes every copy rule by accident. These
  // assert the body survived, so a silent sweep fails instead of reassuring.
  it.each(PAGES)('%s still has its own words after stripping', (_name, html) => {
    const text = prose(html);
    // 404 is legitimately one line, so the floor is low. The real canary is
    // the two sentences below: if the stripper ate the body, they go first.
    expect(text.length).toBeGreaterThan(150);
    expect(text).toContain('LoanHank');
    expect(text).toContain('Runs the numbers. Takes no side.');
  });

  it('would catch an exclamation mark hidden behind a script', () => {
    // The exact shape that got through: a '<' inside a script, then copy after
    // it. Under the old stripper everything from the '<' to '</script>' went
    // missing, this line included.
    const booby = '<p>Before</p><script>for(var i=0;i<9;i++){}</script><p>After!</p>';
    expect(prose(booby)).toContain('After!');
    expect(prose(booby)).toContain('Before');
  });

  it('does not let script source count as product copy', () => {
    const withScript = '<script>if(!x)return;</script><p>Clean copy.</p>';
    expect(prose(withScript)).not.toContain('!');
    expect(prose(withScript)).toContain('Clean copy.');
  });
});

describe('the product is written in American English', () => {
  // design.md §2 and spec.md §12.1. A Nebraska farmer reading "nought per cent"
  // hears a foreigner, and trust does not come back once it goes. This is not
  // a style preference; it is the same rule as the fonts and the palette, and
  // it fails the build for the same reason.
  //
  // Word boundaries throughout: "analyses" is the correct plural noun in
  // American English and must not be flagged for containing "analyse".
  const BRITISH: Array<[string, string]> = [
    ['nought', 'zero'],
    ['anonymise', 'anonymize'],
    ['anonymised', 'anonymized'],
    ['anonymisation', 'anonymization'],
    ['subsidise', 'subsidize'],
    ['subsidised', 'subsidized'],
    ['organise', 'organize'],
    ['organised', 'organized'],
    ['recognise', 'recognize'],
    ['recognised', 'recognized'],
    ['normalise', 'normalize'],
    ['normalised', 'normalized'],
    ['categorise', 'categorize'],
    ['categorised', 'categorized'],
    ['prioritise', 'prioritize'],
    ['specialise', 'specialize'],
    ['standardise', 'standardize'],
    ['authorise', 'authorize'],
    ['authorised', 'authorized'],
    ['minimise', 'minimize'],
    ['maximise', 'maximize'],
    ['summarise', 'summarize'],
    ['realise', 'realize'],
    ['apologise', 'apologize'],
    ['criticise', 'criticize'],
    ['analyse', 'analyze'],
    ['analysed', 'analyzed'],
    ['colour', 'color'],
    ['behaviour', 'behavior'],
    ['labour', 'labor'],
    ['favour', 'favor'],
    ['neighbour', 'neighbor'],
    ['honour', 'honor'],
    ['licence', 'license'],
    ['defence', 'defense'],
    ['offence', 'offense'],
    ['practise', 'practice'],
    ['centre', 'center'],
    ['metre', 'meter'],
    ['litre', 'liter'],
    ['cheque', 'check'],
    ['programme', 'program'],
    ['instalment', 'installment'],
    ['fulfil', 'fulfill'],
    ['enrol', 'enroll'],
    ['judgement', 'judgment'],
    ['ageing', 'aging'],
    ['grey', 'gray'],
    ['whilst', 'while'],
    ['amongst', 'among'],
    ['learnt', 'learned'],
    ['spelt', 'spelled'],
    ['travelled', 'traveled'],
    ['cancelled', 'canceled'],
    ['per cent', 'percent'],
  ];

  it.each(PAGES)('%s uses no British or Canadian spellings', (_name, html) => {
    const text = prose(html).toLowerCase();
    for (const [british, american] of BRITISH) {
      const pattern = new RegExp(`\\b${british}\\b`);
      expect(
        pattern.test(text),
        `write "${american}", not "${british}"`,
      ).toBe(false);
    }
  });

  it('keeps the correct American plural, which is not a violation', () => {
    // "analyses" is right in American English. A dictionary check that fails
    // on it teaches people to delete the dictionary check.
    const pattern = new RegExp('\\banalyse\\b');
    expect(pattern.test('the analyses were filed')).toBe(false);
    expect(pattern.test('we analyse the quote')).toBe(true);
  });
});


describe('notes are papers, not a blog', () => {
  it('has exactly one ask, and it is to run the numbers', () => {
    const html = renderNotesIndex();
    // One ask per piece (design.md §2½ item 7). A note that wants a second
    // ask is two notes.
    expect((html.match(/<h2>/g) ?? []).length).toBe(1);
    expect(prose(html)).toContain('Run the numbers');
  });

  it('is honest about being empty rather than padding the shelf', () => {
    expect(NOTES).toHaveLength(0);
    expect(prose(renderNotesIndex())).toContain('There is nothing here yet.');
  });

  it('ships no feed, comment or newsletter machinery', () => {
    // Hunt the machinery, not the word. The page says "no comments" out loud,
    // which an earlier version of this test flagged as a comment system.
    const html = renderNotesIndex().toLowerCase();
    for (const machinery of [
      'rel="alternate"', '.xml', 'application/rss', 'application/atom',
      '<textarea', 'name="comment', 'action="/subscribe',
    ]) {
      expect(html, `the notes page ships ${machinery}`).not.toContain(machinery);
    }
  });

  it('gives every future note the same ask and the same laws', () => {
    // Rendered against a stand-in so the rule is enforced before the first
    // real paper arrives, not after somebody writes four of them.
    const html = renderNote({
      slug: 'stand-in', title: 'A stand-in note',
      standfirst: 'Proves the template obeys the copy laws before any note exists.',
      body: '<p>Body text.</p>',
    });
    expect((html.match(/<h2>/g) ?? []).length).toBe(1);
    expect(prose(html)).toContain('Run the numbers');
    expect(prose(html)).not.toMatch(/!/);
    expect(prose(html)).not.toMatch(/—/);
  });
});

// ---------------------------------------------------------------------------
// THE PRIVACY SURFACE — spec.md §14, the gate on ads measurement.
//
// META_DATASET_ID stays unset in production until all of this is live, and
// "live" has to mean something a test can check. CAPI is itself the CCPA share
// that triggers these pages (§10, lawyer stone 2), so the code shipping before
// the copy is fine and the secret being set before it is not.
//
// The two canon paragraphs are read OUT OF docs/spec.md rather than retyped,
// so drift in either direction fails the build: paraphrasing the page breaks
// it, and quietly editing the law without the page breaks it too.
// ---------------------------------------------------------------------------

const SPEC = new URL('../docs/spec.md', import.meta.url);

/** A canon blockquote line from spec.md, stripped to the words themselves. */
async function canon(contains: string): Promise<string> {
  const spec = await readFile(SPEC, 'utf8');
  const line = spec.split('\n').find((row) => row.trim().startsWith('> ') && row.includes(contains));
  expect(line, `spec.md no longer carries a canon line containing "${contains}"`).toBeDefined();
  return (line as string).trim().replace(/^>\s*/, '').replace(/\*\*/g, '');
}

describe('the privacy surface is live and says what the machinery does', () => {
  it('privacy carries the canon ads paragraph, word for word', async () => {
    const text = await canon('If you came here from a Facebook ad');
    expect(prose(renderPrivacy())).toContain(text);
  });

  it('straight answers carries the canon Facebook answer, word for word', async () => {
    const full = await canon('Do you tell Facebook about me?');
    const answer = full.replace('Do you tell Facebook about me? ', '');
    const html = renderStraightAnswers();
    expect(html).toContain('<h2>Do you tell Facebook about me?</h2>');
    expect(prose(html)).toContain(answer);
  });

  it('names the do-not-share signal, because a farmer cannot use a signal nobody names', () => {
    // The canon paragraph says "a do-not-share signal" without naming it. The
    // page has to say which one, or the sentence is a fact he cannot act on.
    for (const html of [renderPrivacy(), renderDoNotSell()]) {
      expect(prose(html)).toContain('Global Privacy Control');
    }
  });

  it('links Do Not Sell or Share from every page, in the statute Title Case', () => {
    // design.md §2: the one string exempt from sentence case, copied verbatim
    // rather than tidied. A rights link nobody can find is not a rights path.
    for (const [name, html] of PAGES) {
      expect(html, `${name} has no Do Not Sell or Share link`)
        .toContain('>Do Not Sell or Share My Personal Information<');
      expect(html, `${name} does not point the link at the page`).toContain('href="/do-not-sell"');
    }
  });

  it('offers only mechanisms that exist, and admits the one it does not have', () => {
    const text = prose(renderDoNotSell());
    // GPC is real: gpcHonoured reads sec-gpc on every request and both the
    // sender and the carrier withhold on it.
    expect(text).toContain('Global Privacy Control');
    // The inbox is real and is the one printed on /contact.
    expect(renderDoNotSell()).toContain('mailto:hank@mail.loanhank.com');
    // And the honest limit: no cookie and no account means no remembered
    // opt-out. Claiming otherwise would be the promise problem in a legal hat.
    expect(text).toContain('cannot recognize your browser');
  });

  it('no longer claims the sharing has not started, because it has', () => {
    // The old California paragraph reasoned from the Phase C lead handoff and
    // said "That is not happening today". Sending identifiers to Meta is
    // itself the share, and it fires the day CAPI does.
    const text = prose(renderPrivacy());
    expect(text).not.toContain('That is not happening today');
    expect(text).toContain('California law treats the click tag');
  });

  it('keeps the footer trust line scoped to the numbers, not to everything', () => {
    // design.md §2: a flat "nothing leaves here" would be a lie in the one
    // place this product can least afford one, now that a click tag leaves.
    const text = prose(renderPrivacy());
    expect(text).toContain('Your numbers stay here unless you say go.');
    expect(text).not.toContain('nothing leaves');
  });
});
