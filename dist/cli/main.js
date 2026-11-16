#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import { errorCode, errorToExitCode } from './exit.js';
import { sanitizeErrorMessage } from './errors-out.js';
import { beginRun, takeAuditFailures } from './output-state.js';
export { EXIT, errorToExitCode } from './exit.js';
/**
 * Report a failure. Human mode: one line on stderr. `--json`: one JSON document on stderr
 * (`{ "error": { code, message, exitCode, … } }`) so an agent can branch on `code` instead of
 * parsing prose; stdout stays empty or holds the command's own document.
 */
function reportError(err, json, prefix = '') {
    const exitCode = errorToExitCode(err);
    const message = sanitizeErrorMessage(err);
    if (json) {
        const extra = {};
        if (err && typeof err === 'object') {
            for (const k of ['requiredScope', 'serverMessage', 'status', 'fields', 'reason', 'key', 'keys', 'staleFiles', 'deploymentUuid', 'lastStatus', 'issues', 'stored', 'outcomeUnknown']) {
                const v = err[k]; // reason: copying the documented, non-secret fields of the typed errors
                if (v !== undefined)
                    extra[k] = v;
            }
        }
        // An audit record that could not be written, when no document on stdout reported it.
        const auditFailures = takeAuditFailures();
        if (auditFailures.length > 0)
            extra['auditError'] = auditFailures.join('; ');
        process.stderr.write(`${JSON.stringify({ error: { code: errorCode(err), message, exitCode, ...extra } })}\n`);
    }
    else {
        process.stderr.write(`${prefix}${message}\n`);
        // Text mode only (with --json the error document is the whole of stderr). `0` / `false` are off.
        if (!/^(|0|false|no|off)$/i.test(process.env['COOLIFY_HARNESS_DEBUG'] ?? '') && err instanceof Error && err.stack) {
            // Frames only: the first line of a stack repeats the raw, unsanitised message.
            process.stderr.write(`${err.stack.split('\n').filter((l) => /^\s+at /.test(l)).join('\n')}\n`);
        }
    }
    return exitCode;
}
export async function main(argv) {
    // Decided from the raw argv so a parse error can honour it too.
    const json = argv.includes('--json');
    beginRun(json);
    let args;
    try {
        args = parseArgs(argv);
    }
    catch (err) {
        return reportError(err, json, 'usage error: ');
    }
    try {
        if (args.command === 'help') {
            // No config, no client, no zod: `help` and `--version` answer in a few milliseconds.
            const { helpCmd } = await import('./commands/help.js');
            return await helpCmd(args);
        }
        const { dispatch } = await import('./dispatch.js');
        return await dispatch(args);
    }
    catch (err) {
        return reportError(err, args.json);
    }
}
/**
 * True when this module is the process entry point (run as the CLI), false when imported.
 *
 * The old check, `import.meta.url === file://${process.argv[1]}`, silently failed whenever
 * argv[1] was a symlink — notably a pnpm-created `node_modules/.bin/coolify-harness` shim, and
 * especially under tsx — because `import.meta.url` is the resolved real path while argv[1] is the
 * link. The mismatch meant every command was a silent no-op that still exited 0. Resolving
 * realpaths on BOTH sides makes a symlinked argv[1] compare equal to the real module path.
 */
export function isMainModule(metaUrl, argv1) {
    if (!argv1)
        return false;
    try {
        return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
    }
    catch {
        // metaUrl is not a file:// URL, or argv1 does not exist on disk → not a direct CLI run.
        return false;
    }
}
/**
 * `coolify-harness … | head`: the reader closed the pipe. That is no reason to crash, and no
 * reason to STOP either: a mutation in flight must finish, be audited and set its real exit code.
 * Further output to that stream is simply dropped.
 */
export function ignoreClosedPipe(stream) {
    stream.on('error', (err) => {
        if (err.code !== 'EPIPE')
            throw err;
        stream.write = () => true;
    });
}
/**
 * Run the CLI as a process: what the `coolify-harness` bin does, for a wrapper script of your own
 * (`await run()`). On top of `main()` it survives a closed pipe (`… | head`), sets the exit code,
 * and exits as soon as the output is flushed — a request abandoned at a wait timeout, or a
 * keep-alive socket, must not keep the process (and the agent that started it) waiting.
 */
export async function run(argv = process.argv.slice(2)) {
    ignoreClosedPipe(process.stdout);
    ignoreClosedPipe(process.stderr);
    let code;
    try {
        code = await main(argv);
    }
    catch (err) {
        code = reportError(err, argv.includes('--json'));
    }
    process.exitCode = code;
    // Bun calls a write "done" before it is flushed: a forced exit there cuts piped output short
    // (131 kB of a 6 MB document). Under Bun the process ends by itself once everything is written.
    if ('bun' in process.versions)
        return;
    await new Promise((resolve) => { process.stdout.write('', () => { process.stderr.write('', () => { resolve(); }); }); });
    process.exit(code);
}
// Bin entrypoint.
if (isMainModule(import.meta.url, process.argv[1]))
    void run();
