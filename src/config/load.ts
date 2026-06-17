import { ProjectRegistrySchema, type ProjectRegistry, type ResolvedTarget } from './schema.js';
import { ConfigError, MissingTokenError } from '../errors/index.js';

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
  const instance = registry.instances[target.instance];
  if (!instance) {
    throw new ConfigError(`Target '${targetName}' references unknown instance '${target.instance}'`);
  }
  const token = env[instance.tokenEnv];
  if (token === undefined || token === '') {
    throw new MissingTokenError(
      `Env var '${instance.tokenEnv}' (token for instance '${target.instance}') is not set`,
      { tokenEnv: instance.tokenEnv },
    );
  }
  return { instanceUrl: instance.url, kind: target.kind, uuid: target.uuid, token };
}

export async function loadConfig(configPath: string): Promise<ProjectRegistry> {
  const mod: unknown = await import(configPath);
  const def = (mod as { default?: unknown }).default; // reason: dynamic import() returns unknown; we read the documented default export
  return loadRegistry(def);
}
