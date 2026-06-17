import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
export function makeAuditSink(path) {
    return async (record) => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
    };
}
