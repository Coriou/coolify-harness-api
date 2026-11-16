import type { ParsedArgs } from '../args.js';
import { loadConfigModule } from '../../config/load.js';
import { configPathFor } from '../config-path.js';
import { generateCatalog } from '../../catalog/generate.js';
import { checkCatalogFresh } from '../../catalog/stale-check.js';
import { EXIT } from '../exit.js';
import { ConfigError } from '../../errors/index.js';

export async function catalogGen(args: ParsedArgs): Promise<number> {
  const path = configPathFor(args);
  const mod = await loadConfigModule(path);
  if (!mod.catalog) throw new ConfigError(`Config '${path}' has no 'catalog' export (see the README "Catalog flow" section)`);
  await generateCatalog({ schemas: mod.catalog.schemas, out: mod.catalog.out });
  process.stdout.write('Catalog regenerated.\n');
  return EXIT.ok;
}

export async function catalogCheck(args: ParsedArgs): Promise<number> {
  const path = configPathFor(args);
  const mod = await loadConfigModule(path);
  if (!mod.catalog) throw new ConfigError(`Config '${path}' has no 'catalog' export (see the README "Catalog flow" section)`);
  const res = await checkCatalogFresh({ schemas: mod.catalog.schemas, files: mod.catalog.out });
  if (!res.fresh) {
    process.stderr.write(`${res.diff}\n`);
    return EXIT.catalogStale;
  }
  process.stdout.write('Catalog is fresh.\n');
  return EXIT.ok;
}
