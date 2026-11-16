import type { ParsedArgs } from '../args.js';
import type { Deployment } from '../../client/schemas.js';
import { type CmdDeps } from '../deps.js';
/**
 * A deployment without its build log, for `--no-logs`: the log is hundreds of kB per deployment
 * and a list of ten drowns an agent's context. `logs_length` says how much was left out.
 */
export declare function withoutLogs(d: Deployment): Record<string, unknown>;
export declare function deploymentsCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/** `deployment cancel <uuid>`: dry-run unless --apply; a finished deployment is reported, not an error. */
export declare function deploymentCancelCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
