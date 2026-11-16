import type { AuditRecord } from '../client/safe-write.js';
/** Append-only JSONL audit log (keys and options only, never values), owner-readable. */
export declare function makeAuditSink(path: string): (record: AuditRecord) => Promise<void>;
