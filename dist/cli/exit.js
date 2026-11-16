import { CatalogStaleError, DuplicateKeyDriftError, CoolifyAuthError, CoolifyAuthScopeError, LockedVarError, CoolifyFeatureNotSupportedError, CoolifyWaitTimeoutError, ConfigError, MissingTokenError, UsageError, InvalidInputError, CoolifyHarnessError, } from '../errors/index.js';
/**
 * Process exit codes. Part of the CLI contract: values are never reused or renumbered.
 * 1 covers everything not listed (Coolify 4xx/5xx answers, network failures, contract errors);
 * the error `code` printed with `--json` tells those apart.
 */
export const EXIT = {
    ok: 0, internal: 1, usage: 2, catalogStale: 3, drift: 4, authScope: 5, lockedVar: 6,
    deployFailed: 7, waitTimeout: 8,
};
export function errorToExitCode(err) {
    if (err instanceof CatalogStaleError)
        return EXIT.catalogStale;
    if (err instanceof DuplicateKeyDriftError)
        return EXIT.drift;
    if (err instanceof CoolifyAuthScopeError || err instanceof CoolifyAuthError || err instanceof MissingTokenError)
        return EXIT.authScope;
    if (err instanceof ConfigError || err instanceof UsageError || err instanceof InvalidInputError)
        return EXIT.usage;
    if (err instanceof LockedVarError)
        return EXIT.lockedVar;
    if (err instanceof CoolifyFeatureNotSupportedError)
        return EXIT.usage;
    if (err instanceof CoolifyWaitTimeoutError)
        return EXIT.waitTimeout;
    // A ZodError from any zod copy (the class identity differs between zod 3, zod 4 and duplicates).
    if (err instanceof Error && err.name === 'ZodError')
        return EXIT.usage;
    return EXIT.internal;
}
/** Stable machine-readable name of an error: the harness `code`, else the error class name. */
export function errorCode(err) {
    if (err instanceof CoolifyHarnessError)
        return err.code;
    if (err instanceof Error && err.name === 'ZodError')
        return 'USAGE';
    return 'INTERNAL';
}
