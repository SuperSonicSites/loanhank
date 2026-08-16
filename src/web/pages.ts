// The boring pages that keep the cave safe (spec.md §10).
//
// House style, from spec: a plain-words box on top, the careful text under it.
// A forty-page SaaS template smells like a robot and a scam at once, so these
// are short. Hank voice throughout: sentence case, no em dashes, no
// exclamation marks, second person, and no claim without a source.
//
// EVERY VERSION IS A RECORD. The terms and the privacy notice carry a version
// and an effective date because the text a farmer actually saw is the text
// that binds, and because the pre-counsel and post-counsel wordings have to be
// distinguishable later rather than blurred into one living document.

import { PEER_POLICY_VERSION, VERDICT_BUFFER_VERSION, COHORT_MIN_N } from '../finance/index.js';
import { escapeHtml, shell } from './page.js';

export const TERMS_VERSION = 'v1 (2026-08-15, pre-counsel)';
export const PRIVACY_VERSION = 'v1 (2026-08-15)';

/** The text version stored beside any consent, once consent exists. */
export const CONSENT_TEXT_VERSION = TERMS_VERSION;

const plain = (body: string) => `  <div class="assumption"><strong>The short version.</strong> ${body}</div>\n`;

export function renderPrivacy(): string {
  return shell('Privacy · LoanHank', `  <h1>Privacy</h1>
${plain('We keep the numbers off your quote, and your email if you hand it over. Your photo is never saved. Nothing about you moves to anybody else, because there is nowhere for it to move to yet.')}
  <p class="note">Version ${PRIVACY_VERSION}</p>

  <h2>Your photo</h2>
  <p>Your photo is never saved. It goes straight to the reader and is gone when the answer comes back. It is not written to a disk, not put in a bucket, and not kept for training or review.</p>
  <p>There is a second lock behind that one. The storage bucket the photo would land in, if a future version of this tool ever wrote one there, carries a rule that deletes everything in it after a day. Today nothing writes to it at all. We keep the rule anyway, because a promise with only one lock on it is a promise you are trusting us to remember.</p>

  <h2>What we keep</h2>
  <p>The numbers off the quote: the price, the discount, the payment, the term, the fees, the trade, and the equipment they describe. The state or province the deal is written in. What our engine computed from all that.</p>
  <p>Your email, only if you ask for the teardown, and only to send you the teardown and anything you later opt into.</p>

  <h2>What we never keep</h2>
  <p>The dealership name. The salesperson. Your name, address or phone number. Serial numbers, stock numbers, account numbers. Our extraction has nowhere to put any of them, so they cannot be stored even by mistake.</p>
  <p>We rank quotes. We never rank dealers.</p>

  <h2>The aggregate</h2>
  <p>We keep anonymised, aggregated market statistics from the quote numbers, and we keep them indefinitely. That is how a median for used tractors on a five year term comes to exist at all. We publish a statistic only when at least ${COHORT_MIN_N} quotes stand behind it, and we always print how many. Nothing published is ever traceable to one quote or one farmer.</p>

  <h2>Nothing moves</h2>
  <p>We do not sell, share or hand your personal information to anybody. There is no lender on the other end of this today. If we are ever asked whether you would want to hear from an independent lender, that question moves nothing on its own, and we say so where we ask it.</p>
  <p>If that ever changes, it changes with a button you press, with the exact wording recorded beside your answer, and after a lawyer has been through it.</p>

  <h2>California</h2>
  <p>If we ever begin passing a farmer's details to a lender for money, California law treats that as selling or sharing personal information, and you get a right to say no to it. That is not happening today, and this page will say so plainly on the day it does, with a <span class="ui">Do Not Sell or Share My Personal Information</span> link beside it.</p>

  <h2>Measurement</h2>
  <p>No tracking cookies. No third-party pixel. No advertising script. There is no cookie banner on this site because there is nothing to ask you about. We count how many people reached each step, on our own server, without identifying anybody.</p>

  <h2>Asking us</h2>
  <p>Write to us at the address on the <a href="/contact">contact page</a> and ask what we hold about you, or ask us to delete it. If you gave us an email we can find it. If you only ran numbers, there is nothing attached to you to find.</p>
`);
}

export function renderTerms(): string {
  return shell('Terms · LoanHank', `  <h1>Terms</h1>
${plain('Free tool. It does arithmetic on numbers you give it. It is not advice, it is not a rate offer, and we are not a lender.')}
  <p class="note">Version ${TERMS_VERSION}</p>

  <h2>What this is</h2>
  <p>A calculator with an opinion about its own limits. You give it the numbers off a dealer quote. It works out what the financing costs against paying cash, and it compares that to a published rate card when one honestly matches. That is the whole product.</p>

  <h2>What we are not</h2>
  <p>We are not a lender. We do not lend money, and we never will.</p>
  <p>We do not arrange, broker or place financing. We do not introduce you to anybody. Nothing about you moves to any lender, dealer or broker, because no such handoff exists in this product today.</p>
  <p>That is a description of what this tool does right now, not a promise about every future version. If we ever build a way for lenders to compete for your deal, it will be something you switch on deliberately, the wording will be recorded, and these terms will be replaced by a version that describes it. The version number at the top is how you tell which text you agreed to.</p>

  <h2>Not advice</h2>
  <p>Nothing here is financial, tax, accounting or legal advice. We do not know your operation, your balance sheet or your tax position. A number that looks good on this page can still be the wrong decision for you, and a number that looks poor can still be the right one.</p>

  <h2>The math, and your part in it</h2>
  <p>Every figure comes from what you typed or confirmed. If a number going in is wrong, the number coming out is wrong, and the screen where you check the fields exists for exactly that reason. We show our working on <a href="/how-we-figure-it">how we figure it</a> so you can check us.</p>
  <p>The rate we show is not a legal APR. Most farm equipment credit is not federally required to disclose one. Ours is the annual cost of the deal against its cash alternative, using the costs we can verify, and we say so beside it every time.</p>

  <h2>No guarantee</h2>
  <p>We do not guarantee any saving, any rate, or any outcome. A published rate card is a posted rate subject to credit approval, not a rate you have been offered. Sometimes this tool will tell you the dealer's deal is good and you should take it. That is not advice either, it is arithmetic.</p>

  <h2>The aggregate data</h2>
  <p>By running a quote you let us keep the numbers from it, without anything identifying you, and use them in anonymised aggregate market statistics. That is what makes the comparisons possible. See <a href="/privacy">privacy</a> for exactly what that covers.</p>

  <h2>Availability</h2>
  <p>Free, and no promise that it stays running, stays free of faults, or stays available. If it is down, use a pen.</p>
`);
}

export function renderHowWeMakeMoney(): string {
  return shell('How we make money · LoanHank', `  <h1>How we make money</h1>
${plain('We do not, yet. The plan is that lenders pay us to be introduced to farmers who ask for it. You would have to ask.')}

  <h2>Today</h2>
  <p>This tool earns nothing. Nobody pays us, there is no advertising on it, and no farmer's details go anywhere.</p>

  <h2>The plan, stated plainly</h2>
  <p>Some farmers, after seeing what their financing actually costs, will want an independent lender to quote the same deal. If we build that, the lender pays us for the introduction, and that is the whole business. Now you know our angle.</p>
  <p>We ask a question on the ticket about whether you would want that. Answering it moves nothing and tells nobody anything about you. We are counting how many farmers would want it before building it.</p>

  <h2>Why we would tell you this</h2>
  <p>Because you were going to wonder, and a free tool from strangers with no visible income is the sort of thing a careful person is right to squint at. The alternative to telling you is you guessing, and the guess is usually worse than the truth.</p>

  <h2>What it does not buy</h2>
  <p>It does not buy a nudge. The verdict is arithmetic against a published rate card, and it says the dealer's deal checks out whenever the dealer's deal checks out. A tool that never said that would be worth nothing to you and, in the end, nothing to a lender either.</p>
`);
}

export function renderHowWeFigureIt(): string {
  return shell('How we figure it · LoanHank', `  <h1>How we figure it</h1>
${plain('Here is the arithmetic, the sources, and the rules we hold ourselves to. Check any of it.')}

  <h2>The rate</h2>
  <p>Take the two ways of buying the same machine. Pay cash today, at the cash price after any discount you would forfeit by financing. Or finance it, and pay the scheduled payments instead.</p>
  <p>Your real rate is the annual rate that makes those two equal. It is the rate you are effectively paying to keep the cash in your pocket, and it includes every mandatory cost you only face because you financed.</p>
  <p>This is not the legal APR. Most farm equipment credit is exempt from federal Truth in Lending disclosure, so most quotes are not required to show one. We compute a comparable number from the deal you were actually offered, and we call it what it is.</p>

  <h2>Why a nought per cent deal is not free</h2>
  <p>If a dealer will take six thousand dollars off for cash and you give that up to get the financing, the six thousand is the price of the financing. It is interest wearing a different hat. Nought per cent on the sticker and nought per cent on the money are different claims.</p>

  <h2>Fees</h2>
  <p>A fee you pay either way, like tax or delivery, is not the cost of financing, so it stays out of the rate and sits on the receipt as its own line. A fee you pay only because you financed goes into the rate. An optional add-on stays out unless you say otherwise. An amount nobody can explain stops us rating the deal at all, and we say so rather than guessing what it is.</p>

  <h2>The verdict, and the buffer</h2>
  <p>We compare your rate to a published equipment rate card matched on the same country, the same amount band and the nearest supported term, and we print which band we used so you can see the match. If your rate is at or under that published rate plus one hundred basis points, the deal checks out. Above it, look closer.</p>
  <p>The hundred basis points is our policy, not a discovered truth. It is a deliberate margin so that ordinary variation between lenders does not get read as a bad deal. Buffer policy <strong>${VERDICT_BUFFER_VERSION}</strong>. We will revisit it when we have enough real quotes to say something better, and the version will change when we do.</p>

  <h2>When we will not give a verdict</h2>
  <p>When the ledger and the payments do not reconcile, because something is missing from the deal. When an amount is unexplained. When no published card matches your size and term, including every Canadian deal, because no published Canadian equipment rate card exists to compare against. In all of those you still get the arithmetic. You do not get a stamp, and the missing stamp is the message.</p>

  <h2>Comparing you to other farmers</h2>
  <p>We show what quotes like yours carry only when at least ${COHORT_MIN_N} of them stand behind the figure, and we always print how many. Under that, there is no honest statistic and we show the published card instead and say so.</p>
  <p>A cohort is the same country, the same currency, the same equipment category and condition, the same term band, the same price band, the same quarter. If that is too thin we widen it in a fixed order, dropping the price band first, then the term band, then reaching back to earlier quarters. We never widen across country, currency, category or condition. Canadian dollars and American dollars are never pooled, converted or compared.</p>
  <p>Medians and quartiles use linear interpolation between the closest ranks, the same definition Excel's PERCENTILE.INC and numpy use by default. Put our numbers in a spreadsheet and you will get our answer back, not one near it. Peer policy <strong>${PEER_POLICY_VERSION}</strong>.</p>
  <p>Every statistic we ever showed you is frozen onto your decode: the exact median, the quartiles, the count, which cohort it was, and when it was computed. A ticket from two years ago still says what it said, and we can prove why.</p>

  <h2>Where the published rates come from</h2>
  <p>AgDirect published equipment rates, as of 2026-08-01, at <a href="https://www.agdirect.com/rates">agdirect.com/rates</a>. We keep an archived copy of the page each time we read it, so a verdict from any past day can be checked against what the card said that day. AgDirect republishes monthly and we re-check monthly.</p>
  <p>Published rates are posted rates subject to credit approval. They are not an offer to you and we never present them as one.</p>

  <h2>What would make us wrong</h2>
  <p>A number you typed that is not what the paper says. A fee on the quote that nobody mentioned to us. A schedule that skips payments seasonally, which we do not price yet and refuse to approximate. Our own arithmetic, which is why it is all written down here.</p>
`);
}

export function renderStraightAnswers(): string {
  return shell('Straight answers · LoanHank', `  <h1>Straight answers</h1>

  <h2>Is it really free?</h2>
  <p>Yes. No account, no card, no trial.</p>

  <h2>Then what is the catch?</h2>
  <p>There is a business plan, and it is on <a href="/how-we-make-money">one page</a>. Short version: some farmers will later want an independent lender to quote the same deal, and lenders would pay us to be introduced. Nothing like that happens unless you ask for it.</p>

  <h2>Are you a lender?</h2>
  <p>No. We do not lend and we do not arrange financing.</p>

  <h2>Who sees my numbers?</h2>
  <p>We do. Nobody else. They go into anonymised aggregate statistics with nothing attached that could identify you or your dealer.</p>

  <h2>What happens to the photo?</h2>
  <p>It is read and gone. It is never saved anywhere. See <a href="/privacy">privacy</a>.</p>

  <h2>Will you tell my dealer?</h2>
  <p>We do not know who your dealer is. We do not extract or store the dealership name, and there is nowhere in our records to put it.</p>

  <h2>What if my deal is good?</h2>
  <p>We say so and you should go sign it. That happens often with subsidised nought per cent offers, and a tool that could not say it would not be worth trusting.</p>

  <h2>Why do you sometimes refuse to give a verdict?</h2>
  <p>Because the numbers did not reconcile, or an amount was unexplained, or no published rate honestly matches your deal. We would rather hand you the arithmetic and admit the gap than invent a comparison.</p>
`);
}

export function renderContact(postalAddress: string): string {
  return shell('Contact · LoanHank', `  <h1>Contact</h1>
${plain('Email us. A person reads it.')}

  <h2>Email</h2>
  <p><a href="mailto:hank@mail.loanhank.com">hank@mail.loanhank.com</a></p>

  <h2>Post</h2>
  <address>${escapeHtml(postalAddress)}</address>
  <p class="note">The same address is in the footer of every email we send.</p>

  <h2>Data requests</h2>
  <p>Ask us what we hold about you, or ask us to delete it, at the address above. If you only ran numbers and never gave us an email, there is nothing attached to you to find.</p>
`);
}

export function renderWhosBehindThis(): string {
  return shell("Who's behind this · LoanHank", `  <h1>Who's behind this</h1>

  <h2>This page is not finished, and that is worth admitting</h2>
  <p>An anonymous website about money is a fair thing to distrust. This page is where a real name and a real photograph of the person who built this belong, and they are being added. It is the most important page on the site and it is the one that is not done.</p>
  <p>Until it is, here is what can be said honestly. This tool was built by one person who got tired of watching nought per cent offers described as free money. There is no company behind it yet, no investors, and no lender paying for placement. The arithmetic is written out on <a href="/how-we-figure-it">how we figure it</a> so that trusting the person is not the only way to check the work.</p>
  <p>If you want to ask who we are before you use it, that is reasonable. <a href="/contact">Write to us</a>.</p>
`);
}

export function renderNotFound(): string {
  return shell('Not found · LoanHank', `  <h1>That page is not here.</h1>
  <p><a href="/">Go back to the tool</a>.</p>
`);
}

/**
 * A manifest, and deliberately nothing else.
 *
 * This makes the tool installable on a phone home screen, which is worth
 * something to a farmer standing on a dealer lot. It does NOT come with a
 * service worker and it does NOT come with push.
 *
 * No service worker: every figure on this page depends on a live benchmark
 * table and a versioned policy, and a cache that served yesterday's HTML would
 * show yesterday's rate card with today's confidence. On a tool whose entire
 * brand is that the number is right, an offline copy is a liability, not a
 * feature. There is also nothing useful to do offline, since the engine runs
 * on the server.
 *
 * No push: design.md §9 bans the push permission prompt outright, and §10 bans
 * anything that interrupts. The expiry reminder is an email the farmer opts
 * into, which is a thing he asked for rather than a thing that interrupts him.
 *
 * display is standalone, not browser. Chrome dropped the service-worker
 * requirement for installability, so standalone costs nothing and buys the
 * metric that matters: decodes launched from the icon rather than from an ad
 * every time. The invitation to install is one line on the confirmation screen
 * and one line in the delivery email. There is no install banner, no prompt,
 * and nothing that interrupts a farmer mid-decode.
 */
export function renderManifest(): string {
  return JSON.stringify({
    name: 'LoanHank',
    short_name: 'LoanHank',
    description: 'See what dealer financing really costs.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F5EF',
    theme_color: '#F7F5EF',
  });
}


/**
 * The screen after the teardown is sent, carrying the second opt-in.
 *
 * The only deadline this product will ever use is the one printed on the
 * dealer's own paper. No countdown, no invented urgency, and no offer at all
 * when the quote did not carry a date.
 */
export function renderSent(emailId: string, expiry: string | null): string {
  const offer = expiry === null ? '' : `
  <div class="gate">
    <h2>Your quote expires ${expiry}.</h2>
    <p>Want one note before then, so it does not go stale while you think about it?</p>
    <form method="post" action="/remind">
      <input type="hidden" name="emailId" value="${emailId}">
      <input type="hidden" name="remindOn" value="${expiry}">
      <button type="submit">Remind me before it expires</button>
    </form>
    <p class="note">One note, and every email we send has a one-click unsubscribe in it.</p>
  </div>
`;
  return shell('On its way · LoanHank', `  <h1>On its way</h1>
  <p>Check your inbox in a minute. That is all we use your email for.</p>
${offer}  <p class="note">You can add LoanHank to your phone home screen from your browser menu, if you would rather not go looking for it next time.</p>
  <p class="no-print"><button type="button" id="install" class="secondary" hidden>Add it to my home screen</button></p>
  <p class="no-print"><a href="/">Run another quote</a></p>
`);
}
