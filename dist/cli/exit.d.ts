/**
 * Process exit codes. Part of the CLI contract: values are never reused or renumbered.
 * 1 covers everything not listed (Coolify 4xx/5xx answers, network failures, contract errors);
 * the error `code` printed with `--json` tells those apart.
 */
export declare const EXIT: {
    readonly ok: 0;
    readonly internal: 1;
    readonly usage: 2;
    readonly catalogStale: 3;
    readonly drift: 4;
    readonly authScope: 5;
    readonly lockedVar: 6;
    readonly deployFailed: 7;
    readonly waitTimeout: 8;
};
export declare function errorToExitCode(err: unknown): number;
/** Stable machine-readable name of an error: the harness `code`, else the error class name. */
export declare function errorCode(err: unknown): string;
