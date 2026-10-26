import { writeFile as nodeWriteFile } from 'node:fs/promises';
import { buildAuditRecord } from '../client/safe-write.js';
import { redactDeep } from '../client/redact.js';
export const defaultWriteFile = (path, content) => nodeWriteFile(path, content, { encoding: 'utf8', mode: 0o600 });
export function requireInstance(args, deps) {
    if (!deps.instanceFor)
        throw new Error('instance-scoped commands are not wired in this context');
    return deps.instanceFor(args);
}
export const print = (line = '') => { process.stdout.write(`${line}\n`); };
export const warn = (line) => { process.stderr.write(`${line}\n`); };
/** JSON output for agents: always redacted, never prose. */
export function printJson(value) {
    process.stdout.write(`${JSON.stringify(redactDeep(value), null, 2)}\n`);
}
export async function audit(deps, record) {
    const now = (deps.now ?? (() => new Date()))();
    await deps.auditSink(buildAuditRecord({
        now,
        actor: deps.actor,
        target: { instanceUrl: record.instanceUrl, kind: record.kind, uuid: record.uuid },
        action: record.action,
        keysAffected: record.keysAffected ?? [],
        ...(record.options !== undefined ? { options: record.options } : {}),
        outcome: record.outcome ?? 'success',
        ...(record.error !== undefined ? { error: record.error } : {}),
    }));
}
/**
 * Run a mutation and audit it whatever happens (keys/options only). A failed mutation is recorded
 * with outcome=failure and the error message, then rethrown.
 */
export async function audited(deps, record, op) {
    try {
        const result = await op();
        await audit(deps, record);
        return result;
    }
    catch (err) {
        await audit(deps, { ...record, outcome: 'failure', error: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}
