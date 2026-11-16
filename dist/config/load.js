import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectRegistrySchema } from './schema.js';
import { ConfigError, MissingTokenError } from '../errors/index.js';
/** File names looked up, in order, when no `--config` is given. */
export const DEFAULT_CONFIG_NAMES = [
    'coolify-harness.config.ts',
    'coolify-harness.config.mts',
    'coolify-harness.config.mjs',
    'coolify-harness.config.js',
];
export function defineConfig(c) {
    return c;
}
export function loadRegistry(raw) {
    if (raw === undefined) {
        throw new ConfigError('Invalid coolify-harness config: the file has no default export (use `export default defineConfig({ instances, targets })`)');
    }
    const parsed = ProjectRegistrySchema.safeParse(raw);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
        throw new ConfigError(`Invalid coolify-harness config: ${issues.join('; ')}`);
    }
    return parsed.data;
}
export function resolveInstance(registry, instanceName, env) {
    const instance = registry.instances[instanceName];
    if (!instance) {
        const known = Object.keys(registry.instances).join(', ');
        throw new ConfigError(`Unknown instance '${instanceName}'. Known instances: ${known}`);
    }
    const token = env[instance.tokenEnv];
    if (token === undefined || token === '') {
        throw new MissingTokenError(`Env var '${instance.tokenEnv}' (token for instance '${instanceName}') is not set`, { tokenEnv: instance.tokenEnv });
    }
    return { instanceUrl: instance.url, token };
}
export function resolveTarget(registry, targetName, env) {
    const target = registry.targets[targetName];
    if (!target) {
        const known = Object.keys(registry.targets).join(', ');
        throw new ConfigError(`Unknown target '${targetName}'. Known targets: ${known}`);
    }
    if (!registry.instances[target.instance]) {
        throw new ConfigError(`Target '${targetName}' references unknown instance '${target.instance}'`);
    }
    const { instanceUrl, token } = resolveInstance(registry, target.instance, env);
    return { instanceUrl, kind: target.kind, uuid: target.uuid, token };
}
/**
 * Resolve the config file to load: an explicit path (made absolute; loading it reports a missing
 * file), else the first of DEFAULT_CONFIG_NAMES found in `cwd`.
 */
export function findConfigFile(explicit, cwd = process.cwd()) {
    if (explicit !== undefined)
        return isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    for (const name of DEFAULT_CONFIG_NAMES) {
        const path = resolve(cwd, name);
        if (existsSync(path))
            return path;
    }
    throw new ConfigError(`No coolify-harness config found in ${cwd} (looked for ${DEFAULT_CONFIG_NAMES.join(', ')}). Create one (see the README "Config file" section) or pass --config <path>.`);
}
async function importConfig(configPath) {
    const path = isAbsolute(configPath) ? configPath : resolve(configPath);
    if (!existsSync(path)) {
        throw new ConfigError(`Config file not found: ${path}. Create it (see the README "Config file" section) or pass --config <path>.`);
    }
    try {
        // A file URL, not a bare path: an absolute Windows path is not a valid import specifier.
        return (await import(pathToFileURL(path).href)); // reason: dynamic import() is untyped; only the documented exports are read
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const hint = /\.[cm]?ts$/.test(path)
            ? ' A TypeScript config is loaded by the runtime itself: Node >= 24 strips types natively (imports must then use real file extensions); otherwise run the CLI through bun or tsx.'
            : '';
        throw new ConfigError(`Could not load config ${path}: ${detail}.${hint}`);
    }
}
export async function loadConfig(configPath) {
    return loadRegistry((await importConfig(configPath)).default);
}
export async function loadConfigModule(configPath) {
    const mod = await importConfig(configPath);
    const registry = loadRegistry(mod.default);
    const catalog = mod.catalog; // reason: dynamic import() is untyped; the optional named `catalog` export is validated by its consumers
    return catalog === undefined ? { registry } : { registry, catalog };
}
