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
    // Absent when the token lacks read:sensitive: Coolify then hides `value` and `real_value`.
    value: z.string().optional(),
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
    // Never undefined downstream; `value_hidden` tells a withheld value apart from an empty one.
    value: row.value ?? '',
    value_hidden: row.value === undefined,
    // Canonical, always-present build-time flag. Prefer the older explicit name if a server ever
    // sends both; fall back to the newer name; default false when neither is present.
    is_build_time: row.is_build_time ?? row.is_buildtime ?? false,
}));
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
export const BulkRequestSchema = z.object({ data: z.array(EnvWriteItemSchema) });
export const BulkResponseSchema = z.array(EnvVarSchema);
export const DeployAckApplicationSchema = z
    .object({ message: z.string(), deployment_uuid: z.string().nullish() })
    .passthrough();
export const DeployAckServiceSchema = z.object({ message: z.string() }).passthrough();
// Every optional field below is `.nullish()` (null OR absent), not `.optional()`: Coolify serializes
// unset model columns as JSON `null` (e.g. `git_full_url`, `health_check_port` on most apps), and a
// bare `.optional()` rejects null. That mismatch is what broke `status` from Coolify 4.3.16 on.
export const ApplicationSchema = z
    .object({
    uuid: z.string(),
    name: z.string(),
    status: z.string().nullish(),
    fqdn: z.string().nullish(),
    git_repository: z.string().nullish(),
    git_branch: z.string().nullish(),
    git_commit_sha: z.string().nullish(),
    git_full_url: z.string().nullish(),
    build_pack: z.string().nullish(),
    docker_compose_raw: z.string().nullish(),
    health_check_enabled: z.boolean().nullish(),
    health_check_port: z.union([z.number(), z.string()]).nullish(),
    health_check_path: z.string().nullish(),
    limits_memory: z.string().nullish(),
    limits_cpus: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
})
    .passthrough();
/** Every status Coolify's ApplicationDeploymentStatus enum defines (verified on 4.5.0). */
export const DEPLOYMENT_STATUSES = ['queued', 'in_progress', 'finished', 'failed', 'cancelled-by-user'];
/** Statuses after which a deployment never changes again. */
export const TERMINAL_DEPLOYMENT_STATUSES = ['finished', 'failed', 'cancelled-by-user'];
export function isTerminalDeploymentStatus(status) {
    return TERMINAL_DEPLOYMENT_STATUSES.includes(status);
}
// A deployment row (ApplicationDeploymentQueue). Coolify creates the row as soon as a deploy is
// queued, BEFORE the build has read the commit — so a queued/in-progress row has
// `commit_message`, `finished_at`, `server_name`, ... as null (all nullable columns in 4.5.0).
// Those nulls broke `deploy --wait` (its very first poll sees a queued row) and `deployment <uuid>`
// for any in-flight deploy. `status` is a plain string so an enum value added upstream does not
// turn into a contract failure; compare against DEPLOYMENT_STATUSES / isTerminalDeploymentStatus.
export const DeploymentSchema = z
    .object({
    deployment_uuid: z.string(),
    status: z.string(),
    logs: z.string().nullish(),
    commit: z.string().nullish(),
    commit_message: z.string().nullish(),
    application_id: z.union([z.string(), z.number()]).nullish(),
    application_name: z.string().nullish(),
    server_name: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    finished_at: z.string().nullish(),
    force_rebuild: z.boolean().nullish(),
    restart_only: z.boolean().nullish(),
    is_webhook: z.boolean().nullish(),
    is_api: z.boolean().nullish(),
    pull_request_id: z.number().nullish(),
})
    .passthrough();
/** Generic `{ message }` acknowledgement (env delete, service/proxy restart, ...). */
export const MessageAckSchema = z.object({ message: z.string() }).passthrough();
export const DeploymentCancelSchema = z
    .object({ message: z.string(), deployment_uuid: z.string().nullish(), status: z.string().nullish() })
    .passthrough();
const ServiceSubResourceSchema = z
    .object({
    uuid: z.string(),
    name: z.string(),
    human_name: z.string().nullish(),
    status: z.string().nullish(),
    image: z.string().nullish(),
    fqdn: z.string().nullish(),
    is_public: z.boolean().nullish(),
})
    .passthrough();
export const ServiceSchema = z
    .object({
    uuid: z.string(),
    name: z.string(),
    status: z.string().nullish(),
    service_type: z.string().nullish(),
    docker_compose_raw: z.string().nullish(),
    applications: z.array(ServiceSubResourceSchema).nullish(),
    databases: z.array(ServiceSubResourceSchema).nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
})
    .passthrough();
export const ServiceUpdateResponseSchema = z
    .object({ uuid: z.string().nullish(), domains: z.array(z.string()).nullish() })
    .passthrough();
export const ServerSchema = z
    .object({
    uuid: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    ip: z.string().nullish(),
    is_reachable: z.boolean().nullish(),
    is_usable: z.boolean().nullish(),
    is_coolify_host: z.boolean().nullish(),
    proxy: z.record(z.unknown()).nullish(),
    settings: z.record(z.unknown()).nullish(),
})
    .passthrough();
export const ServerResourceSchema = z
    .object({ uuid: z.string(), name: z.string(), type: z.string().nullish(), status: z.string().nullish() })
    .passthrough();
export const ServerDomainsSchema = z.array(z.object({ ip: z.string().nullish(), domains: z.array(z.string()) }).passthrough());
/**
 * GET/PATCH /servers/{uuid}/proxy and PUT .../proxy/configuration. `configuration` (the raw proxy
 * docker-compose) is only present when the token has read:sensitive AND the user is a team
 * admin/owner AND Coolify has it stored — otherwise it is null or absent.
 */
export const ServerProxySchema = z
    .object({
    proxy_type: z.string().nullish(),
    status: z.string().nullish(),
    redirect_enabled: z.boolean().nullish(),
    redirect_url: z.string().nullish(),
    generate_exact_labels: z.boolean().nullish(),
    traefik_certificate_resolver: z.string().nullish(),
    configuration: z.string().nullish(),
    message: z.string().nullish(),
})
    .passthrough();
/** Fields `PATCH /servers/{uuid}/proxy` accepts; anything else is a 422 "This field is not allowed.". */
export const ServerProxyUpdateSchema = z
    .object({
    redirect_enabled: z.boolean().optional(),
    redirect_url: z.string().nullable().optional(),
    generate_exact_labels: z.boolean().optional(),
    traefik_certificate_resolver: z.string().nullable().optional(),
    proxy_type: z.enum(['traefik', 'caddy', 'nginx', 'none']).optional(),
})
    .strict();
export const DatabaseSchema = z
    .object({
    uuid: z.string(),
    name: z.string(),
    database_type: z.string().nullish(),
    status: z.string().nullish(),
    image: z.string().nullish(),
    is_public: z.boolean().nullish(),
    public_port: z.number().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
})
    .passthrough();
/**
 * The subset of `PATCH /databases/{uuid}` fields the harness exposes. Changing `is_public` (or
 * `instant_deploy`) also needs the `deploy` ability — Coolify starts/stops the public-port proxy.
 * Credentials (postgres_password, ...) are deliberately not settable through the harness.
 */
export const DatabaseUpdateSchema = z
    .object({
    name: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    is_public: z.boolean().optional(),
    public_port: z.number().int().min(1024).max(65535).optional(),
    public_port_timeout: z.number().int().optional(),
    limits_memory: z.string().optional(),
    limits_cpus: z.string().optional(),
    instant_deploy: z.boolean().optional(),
})
    .strict();
export const BackupExecutionSchema = z
    .object({
    uuid: z.string(),
    status: z.string().nullish(),
    filename: z.string().nullish(),
    size: z.union([z.number(), z.string()]).nullish(),
    message: z.string().nullish(),
    created_at: z.string().nullish(),
})
    .passthrough();
export const BackupConfigSchema = z
    .object({
    uuid: z.string(),
    frequency: z.string().nullish(),
    enabled: z.boolean().nullish(),
    save_s3: z.boolean().nullish(),
    executions: z.array(BackupExecutionSchema).nullish(),
})
    .passthrough();
export const BackupExecutionsResponseSchema = z.object({ executions: z.array(BackupExecutionSchema) }).passthrough();
export const RuntimeLogsResponseSchema = z
    .object({
    logs: z.string().optional(),
})
    .passthrough();
// The Input generic is pinned to `unknown` rather than defaulting to T. Zod's
// ZodType<Output, Def, Input = Output> otherwise forces Input === Output, which rejects any
// schema whose parsed output differs from its input — e.g. EnvVarSchema now `.transform()`s the
// is_build_time/is_buildtime rename, so its input shape is not its output shape.
export function parseOrContractError(schema, raw, ctx) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        throw new CoolifyContractError(`Coolify response (${ctx}) failed contract validation`, {
            zodIssues: parsed.error.message,
        });
    }
    return parsed.data;
}
