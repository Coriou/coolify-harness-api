import type { ParsedArgs } from '../args.js';
import { type CmdDeps } from '../deps.js';
export declare function deploymentsCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/** `deployment cancel <uuid>`: dry-run unless --apply; a finished deployment is reported, not an error. */
export declare function deploymentCancelCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
