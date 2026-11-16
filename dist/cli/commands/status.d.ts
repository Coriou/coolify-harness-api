import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
/**
 * `status`: the resource and, for an application, its latest deployment — fetched together.
 * The JSON `latestDeployment` embeds the build log when the token can read it (hundreds of kB);
 * `--no-logs` replaces it with `logs_length`, which is what a polling agent wants.
 */
export declare function statusCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
