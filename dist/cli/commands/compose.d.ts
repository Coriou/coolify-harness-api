import type { ParsedArgs } from '../args.js';
import { type ServiceImage } from '../../client/compose.js';
import { type CmdDeps } from '../deps.js';
/** Re-throw a helper's input error (unknown service, bad ref) as a usage error (exit 2). */
export declare function asUsageError<T>(fn: () => T): T;
/**
 * Said under a diff that hides whole added or changed lines: the reader must not take `[REDACTED]` for "a
 * secret, nothing to review". With `--from-file` the lines are the caller's own.
 */
export declare function hiddenAdditionsNote(count: number, fromFile: boolean, getCommand: string): string;
/** Read `--from-file`; a missing or unreadable file is a usage error (exit 2), not an internal one. */
export declare function readInputFile(path: string, deps: CmdDeps): Promise<string>;
/** Parse repeated `--image name=ref` into pairs (a bare ref is rejected: services have several images). */
export declare function parseImageAssignments(values: string[]): Array<{
    service: string;
    image: string;
}>;
export declare function imageChanges(before: ServiceImage[], after: ServiceImage[]): Array<{
    service: string;
    from: string | null;
    to: string | null;
}>;
/**
 * `compose get`: the stored docker-compose, secrets redacted on stdout. `--out FILE` writes the
 * UNREDACTED document (mode 0600) for editing — keep that file out of git.
 */
export declare function composeGet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/**
 * A replacement document must at least define services. An empty file (a wrong path, a dotenv
 * file) would otherwise be sent as the new compose — for the proxy, of every site on the server.
 */
export declare function requireServices(document: string, flag: string): void;
/**
 * `compose set` (services): replace the stored docker-compose from `--from-file`, or bump images
 * with `--image <service>=<ref>`. Dry-run (redacted diff) unless --apply. Coolify validates and
 * re-parses the compose but does NOT restart; `--restart` restarts with latest=true so new tags
 * are pulled.
 */
export declare function composeSet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
