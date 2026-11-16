import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
export interface DeployOutcome {
    code: number;
    /** The run's single JSON document. */
    doc: Record<string, unknown>;
}
/**
 * Deploy switches that do not fit the target, as a message — or undefined when they do. Checked
 * before anything is sent (and by `flag set --redeploy` before it writes the env).
 */
export declare function deployFlagProblem(args: Pick<ParsedArgs, 'force' | 'latest' | 'restart' | 'app'>, kind: string): string | undefined;
/**
 * `deploy`: explicit redeploy (applications) / start (services, databases), or `--restart`.
 * `--force` rebuilds an application without the Docker cache (needed to pick up a patched base
 * image — a plain redeploy of an unchanged commit reuses the old image). `--restart --latest`
 * pulls fresh images for a service. `--wait` polls an application deployment to its terminal
 * status and exits 7 if it failed or was cancelled. `--dry-run` sends nothing.
 */
export declare function runDeploy(args: ParsedArgs, deps: CmdDeps): Promise<DeployOutcome>;
/** What a failed step had already achieved (attached to the error it threw), if anything. */
export declare function partialDocOf(err: unknown): Record<string, unknown> | undefined;
export declare function deployCmd(args: ParsedArgs, deps: CmdDeps): Promise<number>;
