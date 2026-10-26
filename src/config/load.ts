import { ProjectRegistrySchema, type ProjectRegistry, type ResolvedInstance, type ResolvedTarget } from './schema.js';
import { ConfigError, MissingTokenError } from '../errors/index.js';
import type { SchemaInput } from '../catalog/generate.js';

export interface ConfigModule {
  registry: ProjectRegistry;
  catalog?: { schemas: SchemaInput[]; out: { markdown?: string; json?: string; dotenvExample?: string } };
}

export function defineConfig(c: ProjectRegistry): ProjectRegistry {
  return c;
}

export function loadRegistry(raw: unknown): ProjectRegistry {
  const parsed = ProjectRegistrySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`Invalid coolify-harness config: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function resolveInstance(
  registry: ProjectRegistry,
  instanceName: string,
  env: Record<string, string | undefined>,
): ResolvedInstance {
  const instance = registry.instances[instanceName];
  if (!instance) {
    const known = Object.keys(registry.instances).join(', ');
    throw new ConfigError(`Unknown instance '${instanceName}'. Known instances: ${known}`);
  }
  const token = env[instance.tokenEnv];
  if (token === undefined || token === '') {
    throw new MissingTokenError(
      `Env var '${instance.tokenEnv}' (token for instance '${instanceName}') is not set`,
      { tokenEnv: instance.tokenEnv },
    );
  }
  return { instanceUrl: instance.url, token };
}

export function resolveTarget(
  registry: ProjectRegistry,
  targetName: string,
  env: Record<string, string | undefined>,
): ResolvedTarget {
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

export async function loadConfig(configPath: string): Promise<ProjectRegistry> {
  const mod: unknown = await import(configPath);
  const def = (mod as { default?: unknown }).default; // reason: dynamic import() returns unknown; we read the documented default export
  return loadRegistry(def);
}

export async function loadConfigModule(configPath: string): Promise<ConfigModule> {
  const mod: unknown = await import(configPath);
  const def = (mod as { default?: unknown }).default; // reason: dynamic import() returns unknown; we read the documented default export
  const registry = loadRegistry(def);
  const catalog = (mod as { catalog?: ConfigModule['catalog'] }).catalog; // reason: dynamic import() returns unknown; we read the optional named catalog export
  return catalog === undefined ? { registry } : { registry, catalog };
}
