import type { ParsedArgs } from './args.js';
import { type ConfigModule } from '../config/load.js';
import { type CmdDeps } from './deps.js';
/**
 * Where API tokens are looked up: the real environment, then the `--env-file` files. A file never
 * overrides the environment and is never copied into `process.env`.
 */
export declare function tokenEnv(args: Pick<ParsedArgs, 'envFiles'>): Promise<Record<string, string | undefined>>;
export declare function buildDepsFrom(mod: ConfigModule, env?: Record<string, string | undefined>): CmdDeps;
/**
 * Route a parsed command. Each command module is imported only when it runs, so `status` does not
 * pay for the catalog walker or the compose differ.
 */
export declare function dispatch(args: ParsedArgs): Promise<number>;
/**
 * `flag set`: `env apply` and, with `--redeploy`, a deploy — but ONLY with `--apply`.
 * Without `--apply` the env step is a dry-run, and redeploying then would be a mutation behind a
 * dry-run (it used to do exactly that). With `--apply --redeploy` the deploy runs even when the
 * value was already set: the caller asked for a redeploy. With `--json` both steps share one
 * document.
 */
export declare function flagSet(args: ParsedArgs, deps: CmdDeps): Promise<number>;
