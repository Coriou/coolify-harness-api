import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { buildAuditRecord } from '../client/safe-write.js';
import { redactDeep } from '../client/redact.js';
import { sanitizeErrorMessage } from './errors-out.js';
import { EXIT } from './exit.js';
/**
 * Write an unredacted document for `--out`, readable by the owner only. The file is opened
 * without following a symlink and its mode is forced to 0600 BEFORE the content is written, so an
 * existing world-readable file (or a planted link) never receives the secrets.
 */
export const defaultWriteFile = async (path, content) => {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try {
        await handle.chmod(0o600);
        await handle.writeFile(content, 'utf8');
    }
    finally {
        await handle.close();
    }
};
export function requireInstance(args, deps) {
    if (!deps.instanceFor)
        throw new Error('instance-scoped commands are not wired in this context');
    return deps.instanceFor(args);
}
export const print = (line = '') => { process.stdout.write(`${line}\n`); };
export const warn = (line) => { process.stderr.write(`${line}\n`); };
/**
 * Report a failure that is returned as an exit code rather than thrown, the way thrown errors are
 * reported: prose on stderr, or with `--json` the `{ "error": { code, message, exitCode, … } }`
 * document. Returns the exit code.
 */
export function emitError(args, code, message, exitCode, extra = {}) {
    if (args.json)
        process.stderr.write(`${JSON.stringify({ error: { code, message, exitCode, ...extra } })}\n`);
    else
        warn(message);
    return exitCode;
}
/** A usage problem (exit 2). */
export function usageFail(args, message) {
    return emitError(args, 'USAGE', message, EXIT.usage);
}
/** JSON output for agents: always redacted, never prose. */
export function printJson(value) {
    process.stdout.write(`${JSON.stringify(redactDeep(value), null, 2)}\n`);
}
export async function audit(deps, record) {
    const now = (deps.now ?? (() => new Date()))();
    await writeAuditSafely(deps, buildAuditRecord({
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
 * Append an audit record without ever letting the audit log decide the command's outcome: by the
 * time it is written the mutation has happened (or failed) in Coolify. A read-only checkout or a
 * full disk is reported loudly on stderr instead of turning a successful deploy into exit 1 —
 * which an agent would answer by deploying again.
 */
export async function writeAuditSafely(deps, record) {
    try {
        await deps.auditSink(record);
    }
    catch (err) {
        warn(`WARNING: audit record for ${record.action} (${record.outcome}) could not be written: ${sanitizeErrorMessage(err)}`);
    }
}
/**
 * Run a mutation and audit it whatever happens (keys/options only). A failed mutation is recorded
 * with outcome=failure and the error message, then rethrown.
 */
export async function audited(deps, record, op) {
    let result;
    try {
        result = await op();
    }
    catch (err) {
        await audit(deps, { ...record, outcome: 'failure', error: sanitizeErrorMessage(err) });
        throw err;
    }
    await audit(deps, record);
    return result;
}
