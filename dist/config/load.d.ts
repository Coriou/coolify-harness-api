import { type ProjectRegistry, type ResolvedInstance, type ResolvedTarget } from './schema.js';
import type { SchemaInput } from '../catalog/generate.js';
export interface ConfigModule {
    registry: ProjectRegistry;
    catalog?: {
        schemas: SchemaInput[];
        out: {
            markdown?: string;
            json?: string;
            dotenvExample?: string;
        };
    };
}
/** File names looked up, in order, when no `--config` is given. */
export declare const DEFAULT_CONFIG_NAMES: readonly ["coolify-harness.config.ts", "coolify-harness.config.mts", "coolify-harness.config.mjs", "coolify-harness.config.js"];
export declare function defineConfig(c: ProjectRegistry): ProjectRegistry;
export declare function loadRegistry(raw: unknown): ProjectRegistry;
export declare function resolveInstance(registry: ProjectRegistry, instanceName: string, env: Record<string, string | undefined>): ResolvedInstance;
export declare function resolveTarget(registry: ProjectRegistry, targetName: string, env: Record<string, string | undefined>): ResolvedTarget;
/**
 * Resolve the config file to load: an explicit path (made absolute; loading it reports a missing
 * file), else the first of DEFAULT_CONFIG_NAMES found in `cwd`.
 */
export declare function findConfigFile(explicit: string | undefined, cwd?: string): string;
export declare function loadConfig(configPath: string): Promise<ProjectRegistry>;
export declare function loadConfigModule(configPath: string): Promise<ConfigModule>;
