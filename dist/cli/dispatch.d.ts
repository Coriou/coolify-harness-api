import type { ParsedArgs } from './args.js';
import { type ConfigModule } from '../config/load.js';
import { type CmdDeps } from './deps.js';
export interface TokenEnv {
    env: Record<string, string | undefined>;
    /** `--token-file` files that do not exist, to mention when a token turns out to be missing. */
    missingFiles: string[];
}
/**
 * Where API tokens are looked up: the real environment, then the `--token-file` files. A variable
 * that is set (and not blank) in the environment wins; the files are never copied into
 * `process.env`.
 */
export declare function tokenEnv(args: Pick<ParsedArgs, 'tokenFiles'>): Promise<TokenEnv>;
export declare function buildDepsFrom(mod: ConfigModule, tokens?: TokenEnv): CmdDeps;
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
