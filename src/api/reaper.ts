import type { AnalysisRepository } from './repository.js';
import type { PrivateStorage } from './storage.js';

export async function reapExpiredData(
  repository: AnalysisRepository,
  storage: PrivateStorage,
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
