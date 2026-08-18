// Meta Conversions API, server-side, direct from the worker (spec.md Decision
// 8a, shape and gates in §10). Plain fetch to graph.facebook.com; the Business
// SDK is Node-bound and will not run on Workers, and one vendor in the path
// is us.
//
// The firewall (spec.md §3.1) runs through this file: the payload carries an
// event name and a click tag, and no `custom_data` key exists. The bytes on
// the wire are identical whatever the stamp said, and tests/firewall.test.ts
// asserts that on the serialized payload itself.

const GRAPH_VERSION = 'v26.0';

// One event, not three (spec.md §10). The canon copy says Meta is told that a
// decode happened and nothing else, and that sentence is the specification.
// The email gate and the interest question are measured in the events table by
// ops/funnel.sql, never sent out.
export type CapiEventName = 'Decode';

export type SkipReason = 'disabled' | 'synthetic' | 'gpc' | 'not_from_ad';

export type CapiOutcome =
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'sent'; http: number; fbtrace?: string }
  | { status: 'failed'; http?: number; error: string };

export interface CapiInput {
  eventName: CapiEventName;
  /** The events.id row this send is measured against. */
  eventId: string;
  /** The request URL. fbclid is stripped before it ships (spec.md §9.5). */
  sourceUrl: string;
  fbc: string | null;
  /** Verification traffic, marked at request time. Never fires (§7.2, §10). */
  synthetic: boolean;
  /** Sec-GPC: 1 on the request. An honoured opt-out, not a preference. */
  gpc: boolean;
  clientIp?: string;
  userAgent?: string;
}

/**
 * The click parameter Meta attached to its own ad, folded into the fbc shape
 * Meta matches on.
 *
 * The subdomain index is the `1`, and it stays `1`. The rule people reach for
 * counts labels on the cookie's domain (com = 0, loanhank.com = 1,
 * www.loanhank.com = 2), and since the cutover on 2026-08-18 this site IS
 * served from www. Do not change it to `2` on that basis. That rule describes
 * an fbc read out of a `_fbc` cookie, and there is no cookie here: Meta's own
 * guidance for generating fbc server-side without saving one says to use 1.
 *
 * A wrong index breaks matching SILENTLY, as fewer attributed conversions
 * rather than any error, which is why the reasoning is written down instead of
 * the value alone.
 */
export function fbcFromUrl(url: URL, nowMs: number): string | null {
  const fbclid = url.searchParams.get('fbclid');
  if (fbclid === null || fbclid === '') return null;
  return `fb.1.${nowMs}.${fbclid}`;
}

/**
 * The tag as a form carried it back. Untrusted input on a public route, so it
 * is shape-checked rather than echoed: anything that is not exactly an fbc we
 * could have rendered is dropped, which fails closed into "not from an ad".
 */
export function fbcFromBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return /^fb\.1\.\d{1,17}\.[\w.-]{1,500}$/.test(raw) ? raw : null;
}

/**
 * Why this request sends nothing, or null when it sends.
 *
 * The order is deliberate. Synthetic first: verification traffic never reaches
 * Meta whatever else is true of the request. Then GPC before ad-origin, so an
 * honoured opt-out is always logged as an opt-out rather than hidden behind
 * "not from an ad". The reason recorded is the reason that governed.
 */
export function skipReason(
  input: Pick<CapiInput, 'synthetic' | 'gpc' | 'fbc'>,
): SkipReason | null {
  if (input.synthetic) return 'synthetic';
  if (input.gpc) return 'gpc';
  if (input.fbc === null) return 'not_from_ad';
  return null;
}

/**
 * The payload, exactly these keys and no others. Pure, so the firewall test
 * can assert on exact bytes: no verdict, no rate, no delta, no ledger figure,
 * and no `custom_data` key in existence (spec.md §3.1, §10).
 */
export function buildEvent(
  input: Pick<CapiInput, 'eventName' | 'eventId' | 'sourceUrl' | 'clientIp' | 'userAgent'> & { fbc: string },
  nowMs: number,
): Record<string, unknown> {
  // fbclid identifies a browser and never lands anywhere it could be kept,
  // a shipped URL included (spec.md §9.5).
  let sourceUrl = input.sourceUrl;
  try {
    const url = new URL(input.sourceUrl);
    url.searchParams.delete('fbclid');
    sourceUrl = url.toString();
  } catch {
    // Not parseable as a URL; ship it as given rather than guessing at one.
  }

  return {
    event_name: input.eventName,
    event_time: Math.floor(nowMs / 1000),
    event_id: input.eventId,
    action_source: 'website',
    event_source_url: sourceUrl,
    user_data: {
      fbc: input.fbc,
      ...(input.clientIp === undefined ? {} : { client_ip_address: input.clientIp }),
      ...(input.userAgent === undefined ? {} : { client_user_agent: input.userAgent }),
    },
    // Limited Data Use on, country and state both 0: Meta applies LDU where US
    // state law requires and nowhere else. Loosening this later is a lawyer
    // conversation, not a scramble (spec.md §10).
    data_processing_options: ['LDU'],
    data_processing_options_country: 0,
    data_processing_options_state: 0,
  };
}

/**
 * One event per request, never a batch: Meta rejects a whole batch when any
 * event in it is invalid, and the volume here does not justify one.
 *
 * Never throws. This runs behind waitUntil and nothing about measurement may
 * ever stand between a farmer and his answer.
 */
export async function sendCapi(
  env: Record<string, unknown>,
  input: CapiInput,
  nowMs: number = Date.now(),
): Promise<CapiOutcome> {
  const datasetId = typeof env.META_DATASET_ID === 'string' ? env.META_DATASET_ID : '';
  const token = typeof env.META_CAPI_TOKEN === 'string' ? env.META_CAPI_TOKEN : '';
  // Unset dataset id is the kill switch, and a sender with no token cannot
  // send; both read as the feature being off rather than as an error.
  if (datasetId === '' || token === '') return { status: 'skipped', reason: 'disabled' };

  const reason = skipReason(input);
  if (reason !== null) return { status: 'skipped', reason };
  if (input.fbc === null) return { status: 'skipped', reason: 'not_from_ad' };

  const body: Record<string, unknown> = {
    data: [buildEvent({ ...input, fbc: input.fbc }, nowMs)],
    // In the body, never the query string. Query strings land in logs.
    access_token: token,
  };
  const testCode = typeof env.META_TEST_EVENT_CODE === 'string' ? env.META_TEST_EVENT_CODE : '';
  if (testCode !== '') body.test_event_code = testCode;

  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${datasetId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { status: 'failed', http: response.status, error: metaErrorLabel(text) };
    }
    let fbtrace: string | undefined;
    try {
      const parsed = await response.json() as { fbtrace_id?: unknown };
      if (typeof parsed.fbtrace_id === 'string') fbtrace = parsed.fbtrace_id;
    } catch {
      // A 200 with an unreadable body is still a 200.
    }
    return { status: 'sent', http: response.status, ...(fbtrace === undefined ? {} : { fbtrace }) };
  } catch (error) {
    return { status: 'failed', error: String(error).slice(0, 300) };
  }
}

/**
 * Meta's error body, reduced to its type and code before anything is stored.
 *
 * The raw message is a third-party string produced from a request that carried
 * the click tag, and Graph API validation errors echo offending values back
 * into their message text. Persisting that verbatim would be §9.5's "never
 * written to any table" broken by way of a debugging convenience, so only the
 * enum-shaped fields survive, and they are enough to say what went wrong.
 */
function metaErrorLabel(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown; code?: unknown } };
    const type = typeof parsed.error?.type === 'string' ? parsed.error.type : 'unknown';
    const code = typeof parsed.error?.code === 'number' ? String(parsed.error.code) : 'unknown';
    return `${type} code ${code}`.slice(0, 120);
  } catch {
    return 'unreadable error body';
  }
}

/** The one shape of D1 this file needs, so tests can hand it real SQLite. */
interface EventsDb {
  prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } };
}

/**
 * Every send is logged, success, failure or skip (spec.md §10): a send that
 * silently fails and leaves no row is the same defect species as a teardown
 * promised and never queued. Patched onto the existing events row rather than
 * written as a second one, so ops/funnel.sql stays countable.
 */
export async function recordCapiOutcome(
  db: EventsDb,
  eventId: string,
  outcome: CapiOutcome,
): Promise<void> {
  await db.prepare(
    "UPDATE events SET meta_json = json_set(coalesce(meta_json, '{}'), '$.capi', json(?)) WHERE id = ?",
  ).bind(JSON.stringify(outcome), eventId).run();
}
