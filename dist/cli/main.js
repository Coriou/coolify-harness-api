import { z } from 'zod';
import { parseArgs } from './args.js';
import { CatalogStaleError, DuplicateKeyDriftError, CoolifyAuthError, CoolifyAuthScopeError, LockedVarError, } from '../errors/index.js';
export const EXIT = {
    ok: 0, internal: 1, usage: 2, catalogStale: 3, drift: 4, authScope: 5, lockedVar: 6,
};
export function errorToExitCode(err) {
    if (err instanceof CatalogStaleError)
        return EXIT.catalogStale;
    if (err instanceof DuplicateKeyDriftError)
        return EXIT.drift;
    if (err instanceof CoolifyAuthScopeError || err instanceof CoolifyAuthError)
        return EXIT.authScope;
    if (err instanceof LockedVarError)
        return EXIT.lockedVar;
    if (err instanceof z.ZodError)
        return EXIT.usage;
    return EXIT.internal;
}
export async function main(argv) {
    let args;
    try {
        args = parseArgs(argv);
    }
    catch (err) {
        process.stderr.write(`usage error: ${err instanceof Error ? err.message : String(err)}\n`);
        return EXIT.usage;
    }
    try {
        const { dispatch } = await import('./dispatch.js');
        return await dispatch(args);
    }
    catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        return errorToExitCode(err);
    }
}
// Bin entrypoint: run main and set the process exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
    main(process.argv.slice(2))
        .then((code) => { process.exitCode = code; })
        .catch(() => { process.exitCode = EXIT.internal; });
}
