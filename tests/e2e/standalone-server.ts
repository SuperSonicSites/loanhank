/**
 * End-to-end harness for the standalone Worker.
 *
 * It runs the real routing, header, session, and analysis code from
 * `standalone/src/worker.ts` on Node, with two substitutions and no others:
 * an in-memory stand-in for Supabase, and a static document extractor so the
 * flow can be driven without contacting a model provider.
 */
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { Readable } from 'node:stream';
import selfsigned from 'selfsigned';
import { StaticExtractor } from '../../src/api/extractor.js';
import { createWorker } from '../../standalone/src/worker.js';
import { createFakeSupabase } from '../standalone/supabase-fake.js';
import { distAssets, fixtureExtraction, testEnv } from '../standalone/fixtures.js';

const PORT = Number(process.env.E2E_PORT ?? 8789);

/**
 * The harness serves TLS with a throwaway certificate. That is not decoration:
 * the production CSP sets `upgrade-insecure-requests` and the session cookies
 * use the `__Host-` prefix, so over plain HTTP a standards-compliant engine
 * would refuse in-page navigations and drop cookies. Testing over HTTPS keeps
 * the harness honest about the policy that actually ships.
 *
 * `E2E_TLS=0` drops to plain HTTP for hand-testing in a browser that refuses a
 * self-signed certificate. Chromium exempts localhost from
 * `upgrade-insecure-requests`, so the flow is clickable — but the `__Host-`
 * cookies will not be set, so never read a cookie or session result from a run
 * in this mode. The test suite always uses TLS.
 */
const useTls = process.env.E2E_TLS !== '0';
const certificate = useTls ? await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  keySize: 2048,
  notAfterDate: new Date(Date.now() + 86_400_000),
  extensions: [{
    name: 'subjectAltName',
    altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }],
  }],
}) : null;

const supabase = createFakeSupabase();
supabase.install();

const env = testEnv(distAssets());
const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtraction) });

const handler = async (incoming: import('node:http').IncomingMessage, outgoing: import('node:http').ServerResponse) => {
  // Harness-only. The rate limiter is real and hourly, so a suite that runs the
  // upload flow many times would otherwise throttle itself. This route lives in
  // the harness, never in the Worker, so no reset path can reach production.
  if (incoming.url === '/__harness/reset' && incoming.method === 'POST') {
    supabase.state.tables.clear();
    supabase.state.objects.clear();
    supabase.state.requests.length = 0;
    outgoing.statusCode = 204;
    outgoing.end();
    return;
  }

  const origin = `${useTls ? 'https' : 'http'}://${incoming.headers.host ?? `127.0.0.1:${PORT}`}`;
  const method = incoming.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const request = new Request(`${origin}${incoming.url ?? '/'}`, {
    method,
    headers,
    ...(hasBody ? { body: await readBody(incoming), duplex: 'half' } : {}),
  } as RequestInit);

  const response = await worker.fetch(request, env, {
    waitUntil(promise: Promise<unknown>) { void promise.catch(() => undefined); },
    passThroughOnException() { /* not applicable on Node */ },
  });

  outgoing.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === 'set-cookie') continue;
    outgoing.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) outgoing.setHeader('set-cookie', cookies);

  if (response.body) Readable.fromWeb(response.body as never).pipe(outgoing);
  else outgoing.end();
};

const server = certificate
  ? createHttpsServer({ key: certificate.private, cert: certificate.cert }, handler)
  : createHttpServer(handler);

async function readBody(incoming: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`LoanHank standalone end-to-end harness listening on ${useTls ? 'https' : 'http'}://127.0.0.1:${PORT}`);
});
