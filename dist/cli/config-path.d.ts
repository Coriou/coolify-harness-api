import type { ParsedArgs } from './args.js';
/**
 * The config file for this invocation: `--config`, else the first default name found in the cwd.
 * A `config` that differs from the default name counts as explicit too, so ParsedArgs built by
 * hand (tests, embedders) keep working without `configExplicit`.
 */
export declare function configPathFor(args: Pick<ParsedArgs, 'config' | 'configExplicit'>): string;
