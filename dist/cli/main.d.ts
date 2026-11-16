#!/usr/bin/env node
export { EXIT, errorToExitCode } from './exit.js';
export declare function main(argv: string[]): Promise<number>;
/**
 * True when this module is the process entry point (run as the CLI), false when imported.
 *
 * The old check, `import.meta.url === file://${process.argv[1]}`, silently failed whenever
 * argv[1] was a symlink — notably a pnpm-created `node_modules/.bin/coolify-harness` shim, and
 * especially under tsx — because `import.meta.url` is the resolved real path while argv[1] is the
 * link. The mismatch meant every command was a silent no-op that still exited 0. Resolving
 * realpaths on BOTH sides makes a symlinked argv[1] compare equal to the real module path.
 */
export declare function isMainModule(metaUrl: string, argv1: string | undefined): boolean;
/**
 * `coolify-harness … | head`: the reader closed the pipe. That is no reason to crash, and no
 * reason to STOP either: a mutation in flight must finish, be audited and set its real exit code.
 * Further output to that stream is simply dropped.
 */
export declare function ignoreClosedPipe(stream: {
    on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
    write: unknown;
}): void;
/**
 * Run the CLI as a process: what the `coolify-harness` bin does, for a wrapper script of your own
 * (`await run()`). On top of `main()` it survives a closed pipe (`… | head`), sets the exit code,
 * and exits as soon as the output is flushed — a request abandoned at a wait timeout, or a
 * keep-alive socket, must not keep the process (and the agent that started it) waiting.
 */
export declare function run(argv?: string[]): Promise<void>;
