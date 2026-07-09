import { z } from 'zod';
import { CoolifyContractError } from '../errors/index.js';

export const EnvVarSchema = z
  .object({
    uuid: z.string(),
    key: z.string(),
    value: z.string(),
    is_preview: z.boolean(),
    is_build_time: z.boolean(),
    is_literal: z.boolean(),
    is_multiline: z.boolean(),
    is_shown_once: z.boolean(),
  })
  .passthrough();
export type EnvVar = z.infer<typeof EnvVarSchema>;

export const EnvWriteItemSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  is_preview: z.boolean().optional(),
  is_build_time: z.boolean().optional(),
  is_literal: z.boolean().optional(),
  is_multiline: z.boolean().optional(),
  is_shown_once: z.boolean().optional(),
});
export type EnvWriteItem = z.infer<typeof EnvWriteItemSchema>;

export const BulkRequestSchema = z.object({ data: z.array(EnvWriteItemSchema) });
export type BulkRequest = z.infer<typeof BulkRequestSchema>;

export const BulkResponseSchema = z.array(EnvVarSchema);

export const DeployAckApplicationSchema = z
  .object({ message: z.string(), deployment_uuid: z.string().optional() })
  .passthrough();
export const DeployAckServiceSchema = z.object({ message: z.string() }).passthrough();

export interface DeployAck {
  message: string;
  deploymentUuid?: string;
}

export const ApplicationSchema = z
  .object({
    uuid: z.string(),
    name: z.string(),
    status: z.string().optional(),
    fqdn: z.string().nullable().optional(),
    git_repository: z.string().optional(),
    git_branch: z.string().optional(),
    git_commit_sha: z.string().optional(),
    git_full_url: z.string().optional(),
    build_pack: z.string().optional(),
    health_check_enabled: z.boolean().optional(),
    health_check_port: z.number().optional(),
    health_check_path: z.string().optional(),
    limits_memory: z.string().optional(),
    limits_cpus: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();
export type Application = z.infer<typeof ApplicationSchema>;

export const DeploymentSchema = z
  .object({
    deployment_uuid: z.string(),
    status: z.enum(['queued', 'in_progress', 'finished', 'failed', 'cancelled-by-user']),
    logs: z.string().nullable().optional(),
    commit: z.string().optional(),
    commit_message: z.string().optional(),
    application_name: z.string().optional(),
    server_name: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    finished_at: z.string().nullable().optional(),
    force_rebuild: z.boolean().optional(),
    is_webhook: z.boolean().optional(),
    is_api: z.boolean().optional(),
    pull_request_id: z.number().nullable().optional(),
  })
  .passthrough();
export type Deployment = z.infer<typeof DeploymentSchema>;

export const RuntimeLogsResponseSchema = z
  .object({
    logs: z.string().optional(),
  })
  .passthrough();
export type RuntimeLogsResponse = z.infer<typeof RuntimeLogsResponseSchema>;

export function parseOrContractError<T>(schema: z.ZodType<T>, raw: unknown, ctx: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CoolifyContractError(`Coolify response (${ctx}) failed contract validation`, {
      zodIssues: parsed.error.message,
    });
  }
  return parsed.data;
}
