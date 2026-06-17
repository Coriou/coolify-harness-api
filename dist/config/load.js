import { ProjectRegistrySchema } from './schema.js';
import { ConfigError, MissingTokenError } from '../errors/index.js';
export function defineConfig(c) {
    return c;
}
export function loadRegistry(raw) {
    const parsed = ProjectRegistrySchema.safeParse(raw);
    if (!parsed.success) {
        throw new ConfigError(`Invalid coolify-harness config: ${parsed.error.message}`);
    }
    return parsed.data;
}
export function resolveTarget(registry, targetName, env) {
    const target = registry.targets[targetName];
    if (!target) {
        const known = Object.keys(registry.targets).join(', ');
        throw new ConfigError(`Unknown target '${targetName}'. Known targets: ${known}`);
    }
    const instance = registry.instances[target.instance];
    if (!instance) {
        throw new ConfigError(`Target '${targetName}' references unknown instance '${target.instance}'`);
    }
    const token = env[instance.tokenEnv];
    if (token === undefined || token === '') {
        throw new MissingTokenError(`Env var '${instance.tokenEnv}' (token for instance '${target.instance}') is not set`, { tokenEnv: instance.tokenEnv });
    }
    return { instanceUrl: instance.url, kind: target.kind, uuid: target.uuid, token };
}
export async function loadConfig(configPath) {
    const mod = await import(configPath);
    const def = mod.default; // reason: dynamic import() returns unknown; we read the documented default export
    return loadRegistry(def);
}
export async function loadConfigModule(configPath) {
    const mod = await import(configPath);
    const def = mod.default; // reason: dynamic import() returns unknown; we read the documented default export
    const registry = loadRegistry(def);
    const catalog = mod.catalog; // reason: dynamic import() returns unknown; we read the optional named catalog export
    return catalog === undefined ? { registry } : { registry, catalog };
}
