import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Append-only JSONL audit log (keys and options only, never values), owner-readable. */
export function makeAuditSink(path) {
    return async (record) => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
        // `mode` only applies on creation: tighten a log an older version created world-readable.
        await chmod(path, 0o600).catch(() => { });
    };
}
