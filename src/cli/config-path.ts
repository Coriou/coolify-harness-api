import type { ParsedArgs } from './args.js';
import { DEFAULT_CONFIG_NAMES, findConfigFile } from '../config/load.js';

/**
 * The config file for this invocation: `--config`, else the first default name found in the cwd.
 * A `config` that differs from the default name counts as explicit too, so ParsedArgs built by
 * hand (tests, embedders) keep working without `configExplicit`.
 */
export function configPathFor(args: Pick<ParsedArgs, 'config' | 'configExplicit'>): string {
  const explicit = args.configExplicit === true || args.config !== DEFAULT_CONFIG_NAMES[0];
  return findConfigFile(explicit ? args.config : undefined);
}
