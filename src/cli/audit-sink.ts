import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditRecord } from '../client/safe-write.js';

/**
 * Append-only JSONL audit log (keys and options only, never values), owner-readable. The file is
 * opened without following a symlink: a planted link must not get a line appended or its mode
 * changed. `mode` only applies on creation, so a log an older version created world-readable is
 * tightened on each append.
 */
export function makeAuditSink(path: string): (record: AuditRecord) => Promise<void> {
  return async (record: AuditRecord): Promise<void> => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.chmod(0o600);
      await handle.appendFile(`${JSON.stringify(record)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
  };
}
