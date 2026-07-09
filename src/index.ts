export * from './errors/index.js';
export { createLogger, type Logger } from './logging/index.js';
export { defineConfig, loadConfig, loadConfigModule, resolveTarget } from './config/load.js';
export type { ProjectRegistry, ResolvedTarget } from './config/schema.js';
export { CoolifyClient } from './client/coolify.js';
export { planEnvWrite, applyEnvWrite, buildAuditRecord } from './client/safe-write.js';
export type { EnvWritePlan, AuditRecord, DesiredEnv } from './client/safe-write.js';
export { generateCatalog, buildArtifacts, type SchemaInput } from './catalog/generate.js';
export { checkCatalogFresh } from './catalog/stale-check.js';
export { walkEnvSchema, mergeCatalogs, type CatalogModel, type CatalogEntry } from './catalog/walk.js';

// New observability surface (read primitives + wait)
export type { Application, Deployment, RuntimeLogsResponse } from './client/schemas.js';
export type { WaitOptions } from './client/wait.js';
export { waitForDeployment } from './client/wait.js';
