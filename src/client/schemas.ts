import { z } from 'zod';
import { CoolifyContractError } from '../errors/index.js';

/**
 * Env-var item as returned by Coolify's READ endpoints (list/get envs).
 *
 * Coolify >= 4.0.0-beta.463 renamed the build-time flag `is_build_time` -> `is_buildtime`
 * (and added `is_runtime`); older instances still send `is_build_time`. We accept either
 * spelling and normalize onto the canonical `is_build_time` so the rest of the codebase
 * (safe-write, CLI) only ever reasons about one field name. `.passthrough()` retains whatever
 * raw fields the server actually sent (e.g. `is_buildtime`, `is_runtime`, `comment`).
 */
const EnvVarReadSchema = z
  .object({
    uuid: z.string(),
    key: z.string(),
    value: z.string(),
    is_preview: z.boolean(),
    is_build_time: z.boolean().optional(), // Coolify < beta.463
    is_buildtime: z.boolean().optional(), // Coolify >= beta.463
    is_literal: z.boolean(),
    is_multiline: z.boolean(),
    is_shown_once: z.boolean(),
  })
  .passthrough();

export const EnvVarSchema = EnvVarReadSchema.transform((row) => ({
  ...row,
  // Canonical, always-present build-time flag. Prefer the older explicit name if a server ever
  // sends both; fall back to the newer name; default false when neither is present.
  is_build_time: row.is_build_time ?? row.is_buildtime ?? false,
}));
export type EnvVar = z.infer<typeof EnvVarSchema>;

/**
 * Fields Coolify accepts when WRITING env vars (POST/PATCH .../envs and .../envs/bulk).
 *
 * The write API accepts ONLY these fields and rejects anything else with HTTP 422
 * "This field is not allowed." There is NO build-time field on the write path in current
 * Coolify (neither `is_build_time` nor `is_buildtime`) — build-time is not settable via the
 * API — so it is deliberately absent here, and `upsertEnvs` validates the request against this
 * schema so a stray field can never reach the wire. Verified against the Coolify OpenAPI (main)
 * and coollabsio/coolify#6847. See docs/specs/design.md §3.1.
 */
export const EnvWriteItemSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  is_preview: z.boolean().optional(),
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

// The Input generic is pinned to `unknown` rather than defaulting to T. Zod's
// ZodType<Output, Def, Input = Output> otherwise forces Input === Output, which rejects any
// schema whose parsed output differs from its input — e.g. EnvVarSchema now `.transform()`s the
// is_build_time/is_buildtime rename, so its input shape is not its output shape.
export function parseOrContractError<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown, ctx: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CoolifyContractError(`Coolify response (${ctx}) failed contract validation`, {
      zodIssues: parsed.error.message,
    });
  }
  return parsed.data;
}
