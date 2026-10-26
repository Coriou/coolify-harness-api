import type { ParsedArgs } from '../args.js';
import { type CmdDeps } from '../deps.js';
export declare function proxyGet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/**
 * `proxy set`: change the proxy (Traefik/Caddy) version with `--image <ref>`, or replace the
 * whole proxy compose with `--from-file`. Dry-run unless --apply. Coolify writes the file and
 * keeps a backup of the old one, but only a restart (`--restart`) pulls and runs the new image —
 * which briefly interrupts every site on that server.
 */
export declare function proxySet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
export declare function proxyRestart(args: ParsedArgs, deps: CmdDeps): Promise<number>;
