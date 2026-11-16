import { loadConfigModule } from '../../config/load.js';
import { configPathFor } from '../config-path.js';
import { generateCatalog } from '../../catalog/generate.js';
import { checkCatalogFresh } from '../../catalog/stale-check.js';
import { EXIT } from '../exit.js';
import { CatalogStaleError, ConfigError } from '../../errors/index.js';
import { print, printJson } from '../deps.js';
async function catalogConfig(args) {
    const path = configPathFor(args);
    const mod = await loadConfigModule(path);
    if (!mod.catalog)
        throw new ConfigError(`Config '${path}' has no 'catalog' export (README, "Env catalog from Zod schemas")`);
    return mod.catalog;
}
export async function catalogGen(args) {
    const catalog = await catalogConfig(args);
    const artifacts = await generateCatalog({ schemas: catalog.schemas, out: catalog.out });
    const written = [catalog.out.markdown, catalog.out.json, catalog.out.dotenvExample].filter((p) => typeof p === 'string');
    if (args.json)
        printJson({ written, keys: artifacts.model.length });
    else
        print('Catalog regenerated.');
    return EXIT.ok;
}
/** Exit 3 (CatalogStaleError) when a committed artifact differs from what the schemas generate. */
export async function catalogCheck(args) {
    const catalog = await catalogConfig(args);
    const res = await checkCatalogFresh({ schemas: catalog.schemas, files: catalog.out });
    if (!res.fresh)
        throw new CatalogStaleError(res.diff, { staleFiles: res.staleFiles });
    if (args.json)
        printJson({ fresh: true, staleFiles: [] });
    else
        print('Catalog is fresh.');
    return EXIT.ok;
}
