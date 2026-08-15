// Retention, belt and suspenders: this sweep deletes quote photos and expired
// rows on the 15-minute cron, and the QUOTES bucket carries a lifecycle rule
// that would delete them anyway.
//
// The logic below is the ancestor's, carried over unchanged and green. Its two
// dependencies are declared here as structural interfaces rather than imported
// from a store, so nothing Supabase-shaped survives (spec.md Decision 1). The
// D1 and R2 implementations that satisfy them land with the decode routes.

export interface ReapableRecord {
  id: string;
  accessKeyHash: string;
  status: string;
  errorCode: string | null;
  objectPath: string | null;
  objectDeletedAt: string | null;
}

export interface ReaperRepository {
  listExpiredRaw(now: string): Promise<ReapableRecord[]>;
  listExpiredAnalyses(now: string): Promise<ReapableRecord[]>;
  transition(
    id: string,
    accessKeyHash: string,
    fromStatuses: string[],
    patch: Record<string, unknown>,
  ): Promise<unknown>;
  remove(id: string): Promise<unknown>;
}

export interface ReaperStorage {
  remove(objectPath: string): Promise<void>;
}

export async function reapExpiredData(
  repository: ReaperRepository,
  storage: ReaperStorage,
  now = new Date(),
): Promise<{ rawDeleted: number; analysesDeleted: number; cleanupFailures: number }> {
  let rawDeleted = 0;
  let analysesDeleted = 0;
  let cleanupFailures = 0;
  const timestamp = now.toISOString();
  for (const record of await repository.listExpiredRaw(timestamp)) {
    if (!record.objectPath) continue;
    try {
      await storage.remove(record.objectPath);
      const terminalUploadState = ['CREATED', 'UPLOADING', 'UPLOADED', 'EXTRACTING'].includes(record.status);
      await repository.transition(record.id, record.accessKeyHash, [record.status], {
        status: terminalUploadState ? 'FAILED' : record.status,
        errorCode: terminalUploadState ? 'UPLOAD_EXPIRED' : record.errorCode,
        objectDeletedAt: timestamp,
        objectPath: null,
        rawDeleteAt: null,
      });
      rawDeleted += 1;
    } catch {
      cleanupFailures += 1;
    }
  }
  for (const record of await repository.listExpiredAnalyses(timestamp)) {
    try {
      if (record.objectPath && !record.objectDeletedAt) {
        await storage.remove(record.objectPath);
        rawDeleted += 1;
      }
      await repository.remove(record.id);
      analysesDeleted += 1;
    } catch {
      cleanupFailures += 1;
    }
  }
  return { rawDeleted, analysesDeleted, cleanupFailures };
}
