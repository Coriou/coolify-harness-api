import type { ParsedArgs } from '../args.js';
import { type CmdDeps } from '../deps.js';
/**
 * `instance info` / `version`: Coolify version + health for an instance, and whether that version
 * is inside the range this harness release is tested against. Outside the range is a WARNING
 * (stderr, and `compatibility` / `warning` in the JSON), never a failure: most commands keep
 * working, but a contract error becomes a likely cause to check first.
 */
export declare function instanceInfo(args: ParsedArgs, deps: CmdDeps): Promise<number>;
export declare function serversCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/** `server get`: server + its resources + proxy summary (type, status, image). */
export declare function serverGet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/**
 * Commands an operator reasonably expects but the Coolify API does not offer. They fail loudly
 * (exit 2) with where to do it instead — the harness never SSHes into servers or writes Coolify's
 * database to emulate a missing endpoint.
 */
export declare function notInApi(args: ParsedArgs): Promise<number>;
