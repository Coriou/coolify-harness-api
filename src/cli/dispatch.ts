import type { ParsedArgs } from './args.js';
import { catalogGen, catalogCheck } from './commands/catalog.js';
import { configDoctor } from './commands/config-doctor.js';

export async function dispatch(args: ParsedArgs): Promise<number> {
  switch (args.command) {
    case 'catalog-gen': return catalogGen(args);
    case 'catalog-check': return catalogCheck(args);
    case 'config-doctor': return configDoctor(args);
    default:
      // env/flag/deploy commands wired in Task 20.
      throw new Error(`Command '${args.command}' not yet wired`);
  }
}
