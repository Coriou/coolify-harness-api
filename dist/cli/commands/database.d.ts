import type { ParsedArgs } from '../args.js';
import { type CmdDeps } from '../deps.js';
export declare function databasesCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
export declare function databaseGet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/** `database set`: --public true|false, --public-port N, --image REF. Dry-run unless --apply. */
export declare function databaseSet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
export declare function databaseBackups(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/** `database backup`: run an existing backup configuration now. Dry-run unless --apply. */
export declare function databaseBackup(args: ParsedArgs, deps: CmdDeps): Promise<number>;
