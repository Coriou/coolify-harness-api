import { resolve } from 'node:path';
import type { ParsedArgs } from '../args.js';
import { loadConfigModule } from '../../config/load.js';
import { generateCatalog } from '../../catalog/generate.js';
import { checkCatalogFresh } from '../../catalog/stale-check.js';
import { EXIT } from '../main.js';
import { ConfigError } from '../../errors/index.js';

export async function catalogGen(args: ParsedArgs): Promise<number> {
  const mod = await loadConfigModule(resolve(args.config));
  if (!mod.catalog) throw new ConfigError(`Config '${args.config}' has no 'catalog' export`);
  await generateCatalog({ schemas: mod.catalog.schemas, out: mod.catalog.out });
  process.stdout.write('Catalog regenerated.\n');
  return EXIT.ok;
}

export async function catalogCheck(args: ParsedArgs): Promise<number> {
  const mod = await loadConfigModule(resolve(args.config));
  if (!mod.catalog) throw new ConfigError(`Config '${args.config}' has no 'catalog' export`);
  const res = await checkCatalogFresh({ schemas: mod.catalog.schemas, files: mod.catalog.out });
  if (!res.fresh) {
    process.stderr.write(`${res.diff}\n`);
    return EXIT.catalogStale;
  }
  process.stdout.write('Catalog is fresh.\n');
  return EXIT.ok;
}
