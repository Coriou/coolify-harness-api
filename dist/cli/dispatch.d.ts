import type { ParsedArgs } from './args.js';
import { type ConfigModule } from '../config/load.js';
import { type CmdDeps } from './deps.js';
export declare function buildDepsFrom(mod: ConfigModule): CmdDeps;
/**
 * Route a parsed command. Each command module is imported only when it runs, so `status` does not
 * pay for the catalog walker or the compose differ.
 */
export declare function dispatch(args: ParsedArgs): Promise<number>;
/**
 * `flag set`: `env apply` and, with `--redeploy`, a deploy — but ONLY after a real write.
 * Without `--apply` the env step is a dry-run, and redeploying then would be a mutation behind a
 * dry-run (it used to do exactly that). With `--json` both steps share one document.
 */
export declare function flagSet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
