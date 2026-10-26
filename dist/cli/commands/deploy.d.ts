import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
/**
 * `deploy`: explicit redeploy (applications) / start (services, databases), or `--restart`.
 * `--force` rebuilds an application without the Docker cache (needed to pick up a patched base
 * image — a plain redeploy of an unchanged commit reuses the old image). `--restart --latest`
 * pulls fresh images for a service. `--wait` polls an application deployment to its terminal
 * status and exits 7 if it failed or was cancelled.
 */
export declare function deployCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
