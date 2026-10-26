export * from './errors/index.js';
export { createLogger, type Logger } from './logging/index.js';
export { defineConfig, loadConfig, loadConfigModule, resolveTarget, resolveInstance } from './config/load.js';
export type { ProjectRegistry, ResolvedTarget, ResolvedInstance, TargetKind } from './config/schema.js';
export { CoolifyClient, type DeployOptions, type RestartOptions, type LogsOptions } from './client/coolify.js';
export { CoolifyInstanceClient } from './client/instance.js';
export { planEnvWrite, applyEnvWrite, buildAuditRecord } from './client/safe-write.js';
export type { EnvWritePlan, AuditRecord, AuditAction, AuditResourceKind, DesiredEnv } from './client/safe-write.js';
export { redactDeep, redactDocument } from './client/redact.js';
export { listServiceImages, setServiceImage, splitImageRef, isValidImageRef, formatRedactedDiff } from './client/compose.js';
export { generateCatalog, buildArtifacts, type SchemaInput } from './catalog/generate.js';
export { checkCatalogFresh } from './catalog/stale-check.js';
export { walkEnvSchema, mergeCatalogs, type CatalogModel, type CatalogEntry } from './catalog/walk.js';

// New observability surface (read primitives + wait)
export type {
  Application, Deployment, RuntimeLogsResponse, Service, Server, ServerProxy, ServerProxyUpdate,
  ServerResource, Database, DatabaseUpdate, BackupConfig, BackupExecution, DeploymentCancel, MessageAck,
} from './client/schemas.js';
export { DEPLOYMENT_STATUSES, TERMINAL_DEPLOYMENT_STATUSES, isTerminalDeploymentStatus } from './client/schemas.js';
export type { WaitOptions } from './client/wait.js';
export { waitForDeployment } from './client/wait.js';
