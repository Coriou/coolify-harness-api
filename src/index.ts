export * from './errors/index.js';
export { createLogger, type Logger } from './logging/index.js';
export {
  defineConfig, loadConfig, loadConfigModule, resolveTarget, resolveInstance, findConfigFile, DEFAULT_CONFIG_NAMES,
} from './config/load.js';
export type { ProjectRegistry, ResolvedTarget, ResolvedInstance, TargetKind } from './config/schema.js';
export { CoolifyClient, type DeployOptions, type RestartOptions, type LogsOptions } from './client/coolify.js';
export type { CoolifyClientDeps } from './client/base.js';
export { CoolifyInstanceClient } from './client/instance.js';
export { planEnvWrite, applyEnvWrite, buildAuditRecord, isLockedRow } from './client/safe-write.js';
export type {
  EnvWritePlan, EnvWriteResult, EnvScope, PlanWarning, AuditRecord, AuditAction, AuditResourceKind, DesiredEnv,
} from './client/safe-write.js';
export { redactDeep, redactDocument, redactCommandLine, redactUrlCredentials } from './client/redact.js';
export { listServiceImages, setServiceImage, splitImageRef, isValidImageRef, formatRedactedDiff } from './client/compose.js';
export { generateCatalog, buildArtifacts, type SchemaInput } from './catalog/generate.js';
export { checkCatalogFresh } from './catalog/stale-check.js';
export { walkEnvSchema, mergeCatalogs, type AnyZodSchema, type CatalogModel, type CatalogEntry } from './catalog/walk.js';

// Observability surface (read primitives + wait)
export type {
  Application, Deployment, RuntimeLogsResponse, Service, Server, ServerProxy, ServerProxyUpdate,
  ServerResource, Database, DatabaseUpdate, BackupConfig, BackupExecution, DeploymentCancel, MessageAck,
  EnvVar, EnvWriteItem,
} from './client/schemas.js';
export { DEPLOYMENT_STATUSES, TERMINAL_DEPLOYMENT_STATUSES, isTerminalDeploymentStatus } from './client/deployment-status.js';
export type { WaitOptions } from './client/wait.js';
export { waitForDeployment } from './client/wait.js';

// Which Coolify versions this release is verified against, and how a live version compares.
export {
  HARNESS_VERSION, TESTED_COOLIFY, compareVersions, coolifyCompatibility, compatibilityWarning,
  type CoolifyCompatibility,
} from './version.js';
