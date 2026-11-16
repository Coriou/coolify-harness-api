import type { AuditRecord } from '../client/safe-write.js';
/**
 * Append-only JSONL audit log (keys and options only, never values), owner-readable. The file is
 * opened without following a symlink: a planted link must not get a line appended or its mode
 * changed. `mode` only applies on creation, so a log an older version created world-readable is
 * tightened on each append.
 */
export declare function makeAuditSink(path: string): (record: AuditRecord) => Promise<void>;
