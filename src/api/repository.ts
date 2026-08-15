import postgres from 'postgres';
import type { AppConfig } from './env.js';
import type { ConfirmedLoan, CountryCode, Extraction, PublicRateRecord } from '../shared/schema.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

export interface AnalysisRecord {
  id: string;
  accessKeyHash: string;
  status: 'CREATED' | 'UPLOADING' | 'UPLOADED' | 'EXTRACTING' | 'NEEDS_CONFIRMATION' | 'CALCULATING' | 'READY' | 'FAILED' | 'DELETED';
  objectPath: string | null;
  contentType: string | null;
  declaredSizeBytes: number | null;
  uploadSessionExpiresAt: string | null;
  documentType: string | null;
  extraction: Extraction | null;
  validationChecks: unknown[];
  confirmedLoan: ConfirmedLoan | null;
  xray: unknown | null;
  createdAt: string;
  expiresAt: string;
  rawDeleteAt: string | null;
  objectDeletedAt: string | null;
  errorCode: string | null;
  countryCode?: CountryCode;
  saveIntentHash?: string | null;
  saveIntentExpiresAt?: string | null;
}

export interface AnalysisRepository {
  create(record: AnalysisRecord): Promise<void>;
  get(id: string, accessKeyHash: string): Promise<AnalysisRecord | null>;
  update(id: string, accessKeyHash: string, patch: Partial<AnalysisRecord>): Promise<AnalysisRecord | null>;
  transition(
    id: string,
    accessKeyHash: string,
    expectedStatuses: AnalysisRecord['status'][],
    patch: Partial<AnalysisRecord> & { status: AnalysisRecord['status'] },
  ): Promise<AnalysisRecord | null>;
  listExpiredRaw(now: string): Promise<AnalysisRecord[]>;
  listExpiredAnalyses(now: string): Promise<AnalysisRecord[]>;
  remove(id: string, accessKeyHash?: string): Promise<void>;
  getRateCache(series: string): Promise<PublicRateRecord | null>;
  putRateCache(record: PublicRateRecord): Promise<void>;
  recordSafeEvent(event: string, sessionHash: string, properties: Record<string, unknown>): Promise<void>;
}

const dateString = (value: string | Date) => new Date(value).toISOString();

export class PostgresRepository implements AnalysisRepository {
  private readonly sql;

  constructor(config: AppConfig) {
    this.sql = postgres(config.DATABASE_URL, { max: 5, prepare: false });
  }

  async create(record: AnalysisRecord): Promise<void> {
    await this.sql`
      insert into app_private.analyses (
        id, access_key_hash, status, object_path, content_type, declared_size_bytes, upload_session_expires_at, document_type, extraction,
        validation_checks, confirmed_loan, xray, created_at, expires_at, raw_delete_at,
        object_deleted_at, error_code
      ) values (
        ${record.id}, ${record.accessKeyHash}, ${record.status}, ${record.objectPath}, ${record.contentType},
        ${record.declaredSizeBytes}, ${record.uploadSessionExpiresAt}, ${record.documentType}, ${this.sql.json(json(record.extraction))}, ${this.sql.json(json(record.validationChecks))},
        ${this.sql.json(json(record.confirmedLoan))}, ${this.sql.json(json(record.xray))}, ${record.createdAt},
        ${record.expiresAt}, ${record.rawDeleteAt}, ${record.objectDeletedAt}, ${record.errorCode}
      )
    `;
  }

  async get(id: string, accessKeyHash: string): Promise<AnalysisRecord | null> {
    const rows = await this.sql`
      select * from app_private.analyses where id = ${id} and access_key_hash = ${accessKeyHash} limit 1
    `;
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async update(id: string, accessKeyHash: string, patch: Partial<AnalysisRecord>): Promise<AnalysisRecord | null> {
    const previous = await this.get(id, accessKeyHash);
    if (!previous) return null;
    const next = { ...previous, ...patch };
    const rows = await this.sql`
      update app_private.analyses set
        status = ${next.status}, object_path = ${next.objectPath}, content_type = ${next.contentType},
        declared_size_bytes = ${next.declaredSizeBytes}, upload_session_expires_at = ${next.uploadSessionExpiresAt},
        document_type = ${next.documentType}, extraction = ${this.sql.json(json(next.extraction))},
        validation_checks = ${this.sql.json(json(next.validationChecks))}, confirmed_loan = ${this.sql.json(json(next.confirmedLoan))},
        xray = ${this.sql.json(json(next.xray))}, expires_at = ${next.expiresAt}, raw_delete_at = ${next.rawDeleteAt},
        object_deleted_at = ${next.objectDeletedAt}, error_code = ${next.errorCode}, updated_at = now()
      where id = ${id} and access_key_hash = ${accessKeyHash}
      returning *
    `;
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async transition(
    id: string,
    accessKeyHash: string,
    expectedStatuses: AnalysisRecord['status'][],
    patch: Partial<AnalysisRecord> & { status: AnalysisRecord['status'] },
  ): Promise<AnalysisRecord | null> {
    const previous = await this.get(id, accessKeyHash);
    if (!previous || !expectedStatuses.includes(previous.status)) return null;
    const next = { ...previous, ...patch };
    const rows = await this.sql`
      update app_private.analyses set
        status = ${next.status}, object_path = ${next.objectPath}, content_type = ${next.contentType},
        declared_size_bytes = ${next.declaredSizeBytes}, upload_session_expires_at = ${next.uploadSessionExpiresAt},
        document_type = ${next.documentType},
        extraction = ${this.sql.json(json(next.extraction))}, validation_checks = ${this.sql.json(json(next.validationChecks))},
        confirmed_loan = ${this.sql.json(json(next.confirmedLoan))}, xray = ${this.sql.json(json(next.xray))},
        expires_at = ${next.expiresAt}, raw_delete_at = ${next.rawDeleteAt}, object_deleted_at = ${next.objectDeletedAt},
        error_code = ${next.errorCode}, updated_at = now()
      where id = ${id} and access_key_hash = ${accessKeyHash} and status in ${this.sql(expectedStatuses)}
      returning *
    `;
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async listExpiredRaw(now: string): Promise<AnalysisRecord[]> {
    const rows = await this.sql`
      select * from app_private.analyses
      where raw_delete_at <= ${now} and object_path is not null and object_deleted_at is null
    `;
    return rows.map(rowToRecord);
  }

  async listExpiredAnalyses(now: string): Promise<AnalysisRecord[]> {
    const rows = await this.sql`select * from app_private.analyses where expires_at <= ${now}`;
    return rows.map(rowToRecord);
  }

  async remove(id: string, accessKeyHash?: string): Promise<void> {
    if (accessKeyHash) await this.sql`delete from app_private.analyses where id = ${id} and access_key_hash = ${accessKeyHash}`;
    else await this.sql`delete from app_private.analyses where id = ${id}`;
  }

  async getRateCache(series: string): Promise<PublicRateRecord | null> {
    const rows = await this.sql`select record from app_private.public_rate_cache where series = ${series} limit 1`;
    return rows[0]?.record ?? null;
  }

  async putRateCache(record: PublicRateRecord): Promise<void> {
    await this.sql`
      insert into app_private.public_rate_cache (series, record, updated_at)
      values (${record.series}, ${this.sql.json(json(record))}, now())
      on conflict (series) do update set record = excluded.record, updated_at = now()
    `;
  }

  async recordSafeEvent(event: string, sessionHash: string, properties: Record<string, unknown>): Promise<void> {
    await this.sql`
      insert into app_private.analytics_events (event_name, session_hash, properties)
      values (${event}, ${sessionHash}, ${this.sql.json(json(properties))})
    `;
  }
}

function rowToRecord(row: Record<string, unknown>): AnalysisRecord {
  return {
    id: String(row.id),
    accessKeyHash: String(row.access_key_hash),
    status: row.status as AnalysisRecord['status'],
    objectPath: row.object_path ? String(row.object_path) : null,
    contentType: row.content_type ? String(row.content_type) : null,
    declaredSizeBytes: row.declared_size_bytes === null || row.declared_size_bytes === undefined
      ? null
      : Number(row.declared_size_bytes),
    uploadSessionExpiresAt: row.upload_session_expires_at
      ? dateString(row.upload_session_expires_at as string | Date)
      : null,
    documentType: row.document_type ? String(row.document_type) : null,
    extraction: row.extraction as Extraction | null,
    validationChecks: (row.validation_checks as unknown[]) ?? [],
    confirmedLoan: row.confirmed_loan as ConfirmedLoan | null,
    xray: row.xray,
    createdAt: dateString(row.created_at as string | Date),
    expiresAt: dateString(row.expires_at as string | Date),
    rawDeleteAt: row.raw_delete_at ? dateString(row.raw_delete_at as string | Date) : null,
    objectDeletedAt: row.object_deleted_at ? dateString(row.object_deleted_at as string | Date) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
  };
}

export class InMemoryRepository implements AnalysisRepository {
  readonly analyses = new Map<string, AnalysisRecord>();
  readonly rates = new Map<string, PublicRateRecord>();
  readonly events: Array<{ event: string; sessionHash: string; properties: Record<string, unknown> }> = [];

  async create(record: AnalysisRecord): Promise<void> { this.analyses.set(record.id, structuredClone(record)); }
  async get(id: string, accessKeyHash: string): Promise<AnalysisRecord | null> {
    const value = this.analyses.get(id);
    return value?.accessKeyHash === accessKeyHash ? structuredClone(value) : null;
  }
  async update(id: string, accessKeyHash: string, patch: Partial<AnalysisRecord>): Promise<AnalysisRecord | null> {
    const current = await this.get(id, accessKeyHash);
    if (!current) return null;
    const next = { ...current, ...structuredClone(patch) };
    this.analyses.set(id, next);
    return structuredClone(next);
  }
  async transition(
    id: string,
    accessKeyHash: string,
    expectedStatuses: AnalysisRecord['status'][],
    patch: Partial<AnalysisRecord> & { status: AnalysisRecord['status'] },
  ): Promise<AnalysisRecord | null> {
    const current = this.analyses.get(id);
    if (!current || current.accessKeyHash !== accessKeyHash || !expectedStatuses.includes(current.status)) return null;
    const next = { ...current, ...structuredClone(patch) };
    this.analyses.set(id, next);
    return structuredClone(next);
  }
  async listExpiredRaw(now: string): Promise<AnalysisRecord[]> {
    return [...this.analyses.values()]
      .filter((record) => record.objectPath && !record.objectDeletedAt && record.rawDeleteAt && record.rawDeleteAt <= now)
      .map((record) => structuredClone(record));
  }
  async listExpiredAnalyses(now: string): Promise<AnalysisRecord[]> {
    return [...this.analyses.values()]
      .filter((record) => record.expiresAt <= now)
      .map((record) => structuredClone(record));
  }
  async remove(id: string, accessKeyHash?: string): Promise<void> {
    const record = this.analyses.get(id);
    if (record && (!accessKeyHash || record.accessKeyHash === accessKeyHash)) this.analyses.delete(id);
  }
  async getRateCache(series: string): Promise<PublicRateRecord | null> { return this.rates.get(series) ?? null; }
  async putRateCache(record: PublicRateRecord): Promise<void> { this.rates.set(record.series, record); }
  async recordSafeEvent(event: string, sessionHash: string, properties: Record<string, unknown>): Promise<void> {
    this.events.push({ event, sessionHash, properties });
  }
}
