import type { AuditRecord } from '../client/safe-write.js';
export declare function makeAuditSink(path: string): (record: AuditRecord) => Promise<void>;
