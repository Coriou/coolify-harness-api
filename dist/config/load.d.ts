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
export declare function defineConfig(c: ProjectRegistry): ProjectRegistry;
export declare function loadRegistry(raw: unknown): ProjectRegistry;
export declare function resolveInstance(registry: ProjectRegistry, instanceName: string, env: Record<string, string | undefined>): ResolvedInstance;
export declare function resolveTarget(registry: ProjectRegistry, targetName: string, env: Record<string, string | undefined>): ResolvedTarget;
export declare function loadConfig(configPath: string): Promise<ProjectRegistry>;
export declare function loadConfigModule(configPath: string): Promise<ConfigModule>;
