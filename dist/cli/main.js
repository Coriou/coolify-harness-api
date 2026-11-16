import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import { EXIT, errorCode, errorToExitCode } from './exit.js';
import { sanitizeErrorMessage } from './errors-out.js';
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
            for (const k of ['requiredScope', 'serverMessage', 'status', 'fields', 'reason', 'key', 'keys', 'staleFiles', 'deploymentUuid', 'lastStatus', 'issues']) {
                const v = err[k]; // reason: copying the documented, non-secret fields of the typed errors
                if (v !== undefined)
                    extra[k] = v;
            }
        }
        process.stderr.write(`${JSON.stringify({ error: { code: errorCode(err), message, exitCode, ...extra } })}\n`);
    }
    else {
        process.stderr.write(`${prefix}${message}\n`);
        if (process.env['COOLIFY_HARNESS_DEBUG'] && err instanceof Error && err.stack) {
            process.stderr.write(`${err.stack}\n`);
        }
    }
    return exitCode;
}
export async function main(argv) {
    // Decided from the raw argv so a parse error can honour it too.
    const json = argv.includes('--json');
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
// Bin entrypoint: run main and set the process exit code.
if (isMainModule(import.meta.url, process.argv[1])) {
    // `coolify-harness … | head`: the reader closing the pipe is not an error worth a stack trace.
    process.stdout.on('error', (err) => {
        if (err.code === 'EPIPE')
            process.exit(process.exitCode ?? EXIT.ok);
    });
    main(process.argv.slice(2))
        .then((code) => { process.exitCode = code; })
        .catch((err) => { process.exitCode = reportError(err, process.argv.includes('--json')); });
}
