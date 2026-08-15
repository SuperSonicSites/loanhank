/**
 * An in-memory stand-in for the slice of PostgREST and Supabase Storage that
 * the Worker actually calls.
 *
 * It exists so the guest analysis flow, the route-class headers, retention, and
 * the mobile end-to-end run can be exercised hermetically. Ownership and row
 * level security are deliberately NOT emulated here — those are proved against
 * the real project by `scripts/verify-rls-isolation.ts`, because a fake that
 * grants access cannot prove a database denies it.
 */
export interface FakeState {
  tables: Map<string, Array<Record<string, unknown>>>;
  objects: Map<string, { body: Uint8Array<ArrayBuffer>; contentType: string }>;
  requests: string[];
  /** When set, the named RPC responds 500 — simulates a limiter/store outage. */
  failRpc?: string;
}

export function createFakeSupabase(baseUrl = 'https://fake.supabase.co') {
  const state: FakeState = { tables: new Map(), objects: new Map(), requests: [] };
  const table = (name: string) => {
    if (!state.tables.has(name)) state.tables.set(name, []);
    return state.tables.get(name)!;
  };

  function matches(row: Record<string, unknown>, params: URLSearchParams): boolean {
    for (const [key, raw] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
      const value = row[key];
      if (raw === 'is.null') {
        if (value !== null && value !== undefined) return false;
      } else if (raw === 'not.is.null') {
        if (value === null || value === undefined) return false;
      } else if (raw.startsWith('eq.')) {
        if (String(value ?? '') !== raw.slice(3)) return false;
      } else if (raw.startsWith('lt.')) {
        if (!(compare(value, raw.slice(3)) < 0)) return false;
      } else if (raw.startsWith('lte.')) {
        if (!(compare(value, raw.slice(4)) <= 0)) return false;
      } else if (raw.startsWith('gt.')) {
        if (!(compare(value, raw.slice(3)) > 0)) return false;
      } else if (raw.startsWith('in.')) {
        const options = raw.slice(3).replace(/^\(|\)$/g, '').split(',').map((item) => decodeURIComponent(item));
        if (!options.includes(String(value ?? ''))) return false;
      } else {
        return false;
      }
    }
    return true;
  }

  function compare(value: unknown, other: string): number {
    if (value === null || value === undefined) return NaN;
    const left = Date.parse(String(value));
    const right = Date.parse(other);
    if (!Number.isNaN(left) && !Number.isNaN(right)) return left - right;
    return String(value).localeCompare(other);
  }

  function apply(rows: Array<Record<string, unknown>>, params: URLSearchParams) {
    let result = rows.filter((row) => matches(row, params));
    const order = params.get('order');
    if (order) {
      const [column, direction] = order.split('.');
      result = [...result].sort((a, b) => {
        const left = String(a[column!] ?? '');
        const right = String(b[column!] ?? '');
        return direction === 'desc' ? right.localeCompare(left) : left.localeCompare(right);
      });
    }
    const limit = Number(params.get('limit') ?? 0);
    return limit > 0 ? result.slice(0, limit) : result;
  }

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    state.requests.push(`${request.method} ${url.pathname}`);

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.slice('/rest/v1/rpc/'.length);
      if (state.failRpc === fn) return json({ message: 'simulated outage' }, 500);
      const body = await request.json() as Record<string, unknown>;
      if (fn === 'consume_rate_limit') {
        const rows = table('rate_limits');
        const key = `${body.p_bucket}:${body.p_subject_hash}:${body.p_window_start}`;
        const existing = rows.find((row) => row.key === key);
        const count = Number(existing?.request_count ?? 0) + 1;
        if (existing) existing.request_count = count;
        else rows.push({ key, request_count: count });
        return json(count <= Number(body.p_limit));
      }
      if (fn === 'reap_expired') {
        const now = String(body.now_at ?? new Date().toISOString());
        const before = table('analyses').length;
        state.tables.set('analyses', table('analyses').filter((row) => compare(row.expires_at, now) > 0));
        return json([{
          analyses_deleted: before - table('analyses').length,
          pkce_states_deleted: 0,
          sessions_deleted: 0,
          rate_limits_deleted: 0,
          analytics_deleted: 0,
        }]);
      }
      if (fn === 'ops_summary') {
        const now = String(body.now_at ?? new Date().toISOString());
        const analyses = table('analyses');
        const byStatus: Record<string, number> = {};
        for (const row of analyses) byStatus[String(row.status)] = (byStatus[String(row.status)] ?? 0) + 1;
        return json({
          analyses_by_status: byStatus,
          past_raw_deadline: analyses.filter((row) =>
            row.raw_delete_at && compare(String(row.raw_delete_at), now) <= 0
            && row.object_path && !row.object_deleted_at).length,
          extraction_failures_24h: analyses.filter((row) => row.error_code).length,
          deliveries_failed_permanently: table('alert_deliveries')
            .filter((row) => row.status === 'failed' && Number(row.attempt_count ?? 0) >= 3).length,
          deliveries_pending_retry: table('alert_deliveries').filter((row) => row.status === 'pending').length,
          global_extraction_used_today: table('rate_limits')
            .filter((row) => String(row.key ?? '').startsWith('global_extraction_daily:'))
            .reduce((total, row) => total + Number(row.request_count ?? 0), 0),
        });
      }
      return json([], 404);
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const name = url.pathname.slice('/rest/v1/'.length);
      const rows = table(name);
      const params = url.searchParams;

      if (request.method === 'GET') return json(apply(rows, params));

      if (request.method === 'POST') {
        const payload = await request.json() as Record<string, unknown> | Array<Record<string, unknown>>;
        const incoming = Array.isArray(payload) ? payload : [payload];
        const conflict = params.get('on_conflict');
        const inserted: Array<Record<string, unknown>> = [];
        for (const item of incoming) {
          const row: Record<string, unknown> = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...item };
          if (conflict) {
            const index = rows.findIndex((candidate) => candidate[conflict] === row[conflict]);
            if (index >= 0) {
              rows[index] = { ...rows[index], ...item };
              inserted.push(rows[index]!);
              continue;
            }
          }
          const duplicate = rows.some((candidate) => candidate.id === row.id && row.id !== undefined);
          if (duplicate) return json({ code: '23505' }, 409);
          rows.push(row);
          inserted.push(row);
        }
        return json(inserted, 201);
      }

      if (request.method === 'PATCH') {
        const patch = await request.json() as Record<string, unknown>;
        const targets = apply(rows, params);
        for (const row of targets) Object.assign(row, patch);
        return json(targets);
      }

      if (request.method === 'DELETE') {
        const targets = apply(rows, params);
        state.tables.set(name, rows.filter((row) => !targets.includes(row)));
        return json(targets);
      }
    }

    if (url.pathname.startsWith('/storage/v1/object/list/')) {
      const body = await request.json() as { prefix?: string; search?: string };
      const entries = [...state.objects.keys()]
        .filter((key) => key.startsWith(body.prefix ?? ''))
        .map((key) => ({ name: key.slice((body.prefix ?? '').length).replace(/^\//, '') }))
        .filter((entry) => !body.search || entry.name === body.search);
      return json(entries);
    }

    if (url.pathname.startsWith('/storage/v1/object/')) {
      const path = decodeURIComponent(url.pathname.split('/').slice(5).join('/'));
      if (request.method === 'POST') {
        if (state.objects.has(path)) return json({ error: 'exists' }, 409);
        state.objects.set(path, {
          body: new Uint8Array(await request.arrayBuffer()) as Uint8Array<ArrayBuffer>,
          contentType: request.headers.get('content-type') ?? 'application/octet-stream',
        });
        return json({ Key: path });
      }
      if (request.method === 'GET') {
        const object = state.objects.get(path);
        if (!object) return json({ error: 'not found' }, 404);
        return new Response(object.body, { headers: { 'content-type': object.contentType } });
      }
      if (request.method === 'DELETE') {
        const existed = state.objects.delete(path);
        return json({ deleted: existed }, existed ? 200 : 404);
      }
    }

    if (url.pathname.startsWith('/auth/v1/')) {
      return json({ error: 'auth not emulated' }, 501);
    }

    return json({ error: 'unhandled' }, 500);
  }

  /** Installs the fake as `globalThis.fetch` for the given base URL only. */
  function install(): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.startsWith(baseUrl)) return handle(request);
      return original(input as RequestInfo, init);
    }) as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  return { state, handle, install, baseUrl, table };
}
