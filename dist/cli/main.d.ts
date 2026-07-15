export declare const EXIT: {
    readonly ok: 0;
    readonly internal: 1;
    readonly usage: 2;
    readonly catalogStale: 3;
    readonly drift: 4;
    readonly authScope: 5;
    readonly lockedVar: 6;
};
export declare function errorToExitCode(err: unknown): number;
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
