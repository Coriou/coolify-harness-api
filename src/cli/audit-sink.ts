import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditRecord } from '../client/safe-write.js';

export function makeAuditSink(path: string): (record: AuditRecord) => Promise<void> {
  return async (record: AuditRecord): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
  };
}
