import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseArgs } from './args.js';
import {
  CatalogStaleError, DuplicateKeyDriftError, CoolifyAuthError, CoolifyAuthScopeError, LockedVarError,
  CoolifyFeatureNotSupportedError, CoolifyWaitTimeoutError, ConfigError, MissingTokenError,
} from '../errors/index.js';

export const EXIT = {
  ok: 0, internal: 1, usage: 2, catalogStale: 3, drift: 4, authScope: 5, lockedVar: 6,
  deployFailed: 7, waitTimeout: 8,
} as const;

export function errorToExitCode(err: unknown): number {
  if (err instanceof CatalogStaleError) return EXIT.catalogStale;
  if (err instanceof DuplicateKeyDriftError) return EXIT.drift;
  if (err instanceof CoolifyAuthScopeError || err instanceof CoolifyAuthError || err instanceof MissingTokenError) return EXIT.authScope;
  if (err instanceof ConfigError) return EXIT.usage;
  if (err instanceof LockedVarError) return EXIT.lockedVar;
  if (err instanceof CoolifyFeatureNotSupportedError) return EXIT.usage;
  if (err instanceof CoolifyWaitTimeoutError) return EXIT.waitTimeout;
  if (err instanceof z.ZodError) return EXIT.usage;
  return EXIT.internal;
}

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`usage error: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.usage;
  }
  try {
    const { dispatch } = await import('./dispatch.js');
    return await dispatch(args);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return errorToExitCode(err);
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
export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    // metaUrl is not a file:// URL, or argv1 does not exist on disk → not a direct CLI run.
    return false;
  }
}

// Bin entrypoint: run main and set the process exit code.
if (isMainModule(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch(() => { process.exitCode = EXIT.internal; });
}
