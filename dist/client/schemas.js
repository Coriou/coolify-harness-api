import { z } from 'zod';
import { CoolifyContractError, InvalidInputError } from '../errors/index.js';
/**
 * Env-var item as returned by Coolify's READ endpoints (list/get envs).
 *
 * Coolify >= 4.0.0-beta.463 renamed the build-time flag `is_build_time` -> `is_buildtime`
 * (and added `is_runtime`); older instances still send `is_build_time`. We accept either
 * spelling and normalize onto the canonical `is_build_time` so the rest of the codebase
 * (safe-write, CLI) only ever reasons about one field name. `z.looseObject` retains whatever
 * raw fields the server actually sent (e.g. `is_buildtime`, `is_runtime`, `comment`).
 */
const EnvVarReadSchema = z.looseObject({
    uuid: z.string(),
    key: z.string(),
    // Three different "no string" cases, kept apart downstream:
    // - ABSENT when the token lacks read:sensitive (Coolify hides `value` and `real_value`);
    // - ABSENT on a locked row (`is_shown_once`): Coolify never returns a locked value, to anyone;
    // - JSON `null` for a row that has no value at all. Coolify 4.7 stores a compose-declared
    //   blank variable (`${VAR:-}`) that way, and `.optional()` rejected it: `env list` failed the
    //   contract on every resource with such a variable.
    value: z.string().nullish(),
    is_preview: z.boolean(),
    is_build_time: z.boolean().optional(), // Coolify < beta.463
    is_buildtime: z.boolean().optional(), // Coolify >= beta.463
    is_literal: z.boolean(),
    is_multiline: z.boolean(),
    is_shown_once: z.boolean(),
});
/**
 * `value_null` is always set by the parser, but optional in the `EnvVar` type so rows built by hand
 * (tests, library callers of `planEnvWrite`) stay valid without it.
 */
const nullFlag = (isNull) => ({ value_null: isNull });
export const EnvVarSchema = EnvVarReadSchema.transform((row) => ({
    ...row,
    // Never null/undefined downstream: a withheld or null value reads as ''.
    value: row.value ?? '',
    // True when Coolify WITHHELD the value (token lacks read:sensitive): the value is unknown.
    value_hidden: row.value === undefined,
    // True when Coolify sent `value: null`: the row exists and is known to be empty, so it compares
    // equal to '' in diffs and is never reported as hidden.
    ...nullFlag(row.value === null),
    // Canonical, always-present build-time flag. Prefer the older explicit name if a server ever
    // sends both; fall back to the newer name; default false when neither is present.
    is_build_time: row.is_build_time ?? row.is_buildtime ?? false,
}));
/**
 * Fields Coolify's bulk env endpoint (`PATCH …/envs/bulk`) reads. Unknown keys are stripped here
 * (Coolify would ignore them); a malformed item (empty key, wrong type) fails before the wire.
 * Applications take all of these. Services and databases have no preview rows and no
 * build-time / runtime flags: 4.7 drops `is_preview`, `is_buildtime` and `is_runtime` there, 4.5
 * wrote whatever fillable field it was given — so the client refuses a preview item for them.
 * The legacy spelling `is_build_time` was never accepted on writes and stays absent.
 * Checked against `create_bulk_envs` of the three API controllers on 4.5.0 and 4.7.5.
 */
export const EnvWriteItemSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
    is_preview: z.boolean().optional(),
    is_literal: z.boolean().optional(),
    is_multiline: z.boolean().optional(),
    is_shown_once: z.boolean().optional(),
    // Read by the applications' bulk endpoint since Coolify 4.5. Never sent unless the caller sets them.
    is_buildtime: z.boolean().optional(),
    is_runtime: z.boolean().optional(),
    comment: z.string().max(256).nullable().optional(),
});
export const BulkRequestSchema = z.object({ data: z.array(EnvWriteItemSchema) });
export const BulkResponseSchema = z.array(EnvVarSchema);
export const DeployAckApplicationSchema = z.looseObject({ message: z.string(), deployment_uuid: z.string().nullish() });
export const DeployAckServiceSchema = z.looseObject({ message: z.string() });
// Every optional field below is `.nullish()` (null OR absent), not `.optional()`: Coolify serializes
// unset model columns as JSON `null` (e.g. `git_full_url`, `health_check_port` on most apps), and a
// bare `.optional()` rejects null. That mismatch is what broke `status` from Coolify 4.3.16 on.
export const ApplicationSchema = z.looseObject({
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
});
export const ApplicationListSchema = z.array(ApplicationSchema);
export { DEPLOYMENT_STATUSES, TERMINAL_DEPLOYMENT_STATUSES, isTerminalDeploymentStatus, } from './deployment-status.js';
// A deployment row (ApplicationDeploymentQueue). Coolify creates the row as soon as a deploy is
// queued, BEFORE the build has read the commit — so a queued/in-progress row has
// `commit_message`, `finished_at`, `server_name`, ... as null (all nullable columns in 4.5.0).
// Those nulls broke `deploy --wait` (its very first poll sees a queued row) and `deployment <uuid>`
// for any in-flight deploy. `status` is a plain string so an enum value added upstream does not
// turn into a contract failure; compare against DEPLOYMENT_STATUSES / isTerminalDeploymentStatus.
export const DeploymentSchema = z.looseObject({
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
});
/** Generic `{ message }` acknowledgement (env delete, service/proxy restart, ...). */
export const MessageAckSchema = z.looseObject({ message: z.string() });
export const DeploymentCancelSchema = z.looseObject({
    message: z.string(),
    deployment_uuid: z.string().nullish(),
    status: z.string().nullish(),
});
const ServiceSubResourceSchema = z.looseObject({
    uuid: z.string(),
    name: z.string(),
    human_name: z.string().nullish(),
    status: z.string().nullish(),
    image: z.string().nullish(),
    fqdn: z.string().nullish(),
    is_public: z.boolean().nullish(),
});
export const ServiceSchema = z.looseObject({
    uuid: z.string(),
    name: z.string(),
    status: z.string().nullish(),
    service_type: z.string().nullish(),
    docker_compose_raw: z.string().nullish(),
    applications: z.array(ServiceSubResourceSchema).nullish(),
    databases: z.array(ServiceSubResourceSchema).nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
});
export const ServiceListSchema = z.array(ServiceSchema);
export const ServiceUpdateResponseSchema = z.looseObject({ uuid: z.string().nullish(), domains: z.array(z.string()).nullish() });
export const ServerSchema = z.looseObject({
    uuid: z.string(),
    name: z.string(),
    description: z.string().nullish(),
    ip: z.string().nullish(),
    is_reachable: z.boolean().nullish(),
    is_usable: z.boolean().nullish(),
    is_coolify_host: z.boolean().nullish(),
    proxy: z.record(z.string(), z.unknown()).nullish(),
    settings: z.record(z.string(), z.unknown()).nullish(),
});
export const ServerListSchema = z.array(ServerSchema);
export const ServerResourceSchema = z.looseObject({
    uuid: z.string(),
    name: z.string(),
    type: z.string().nullish(),
    status: z.string().nullish(),
});
export const ServerResourceListSchema = z.array(ServerResourceSchema);
export const ServerDomainsSchema = z.array(z.looseObject({ ip: z.string().nullish(), domains: z.array(z.string()) }));
/**
 * GET/PATCH /servers/{uuid}/proxy and PUT .../proxy/configuration. `configuration` (the raw proxy
 * docker-compose) is only present when the token has read:sensitive AND the user is a team
 * admin/owner AND Coolify has it stored — otherwise it is null or absent.
 */
export const ServerProxySchema = z.looseObject({
    proxy_type: z.string().nullish(),
    status: z.string().nullish(),
    redirect_enabled: z.boolean().nullish(),
    redirect_url: z.string().nullish(),
    generate_exact_labels: z.boolean().nullish(),
    traefik_certificate_resolver: z.string().nullish(),
    configuration: z.string().nullish(),
    message: z.string().nullish(),
});
/**
 * Fields `PATCH /servers/{uuid}/proxy` accepts; anything else is a 422 "This field is not allowed.".
 * `proxy_error_page` exists from Coolify 4.7.
 */
export const ServerProxyUpdateSchema = z.strictObject({
    redirect_enabled: z.boolean().optional(),
    redirect_url: z.string().nullable().optional(),
    generate_exact_labels: z.boolean().optional(),
    traefik_certificate_resolver: z.string().nullable().optional(),
    proxy_type: z.enum(['traefik', 'caddy', 'nginx', 'none']).optional(),
    proxy_error_page: z.string().nullable().optional(),
});
export const DatabaseSchema = z.looseObject({
    uuid: z.string(),
    name: z.string(),
    database_type: z.string().nullish(),
    status: z.string().nullish(),
    image: z.string().nullish(),
    is_public: z.boolean().nullish(),
    public_port: z.number().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
});
export const DatabaseListSchema = z.array(DatabaseSchema);
/**
 * The subset of `PATCH /databases/{uuid}` fields the harness exposes. Changing `is_public` (or
 * `instant_deploy`) also needs the `deploy` ability — Coolify starts/stops the public-port proxy.
 * Credentials (postgres_password, ...) are deliberately not settable through the harness.
 */
export const DatabaseUpdateSchema = z.strictObject({
    name: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    is_public: z.boolean().optional(),
    public_port: z.number().int().min(1024).max(65535).optional(),
    public_port_timeout: z.number().int().min(1).optional(),
    limits_memory: z.string().optional(),
    limits_cpus: z.string().optional(),
    instant_deploy: z.boolean().optional(),
});
export const BackupExecutionSchema = z.looseObject({
    uuid: z.string(),
    status: z.string().nullish(),
    filename: z.string().nullish(),
    size: z.union([z.number(), z.string()]).nullish(),
    message: z.string().nullish(),
    created_at: z.string().nullish(),
});
export const BackupConfigSchema = z.looseObject({
    uuid: z.string(),
    frequency: z.string().nullish(),
    enabled: z.boolean().nullish(),
    save_s3: z.boolean().nullish(),
    executions: z.array(BackupExecutionSchema).nullish(),
});
export const BackupConfigListSchema = z.array(BackupConfigSchema);
export const BackupExecutionsResponseSchema = z.looseObject({ executions: z.array(BackupExecutionSchema) });
export const RuntimeLogsResponseSchema = z.looseObject({
    logs: z.string().optional(),
});
/** Issues shown inline in a message; the rest are counted. */
const MAX_ISSUES = 4;
/**
 * `path: problem` for each schema issue. Built from the issue's path and Zod's own message, which
 * names expected and received TYPES — never the received value — so it is safe to print for a
 * payload full of secrets.
 */
export function formatIssues(error) {
    return error.issues.map((issue) => {
        const path = issue.path.map((seg) => (typeof seg === 'number' ? `[${seg}]` : `.${String(seg)}`)).join('').replace(/^\./, '');
        return `${path === '' ? '(root)' : path}: ${issue.message}`;
    });
}
export function summarizeIssues(issues) {
    const shown = issues.slice(0, MAX_ISSUES).join('; ');
    return issues.length > MAX_ISSUES ? `${shown}; +${issues.length - MAX_ISSUES} more` : shown;
}
/**
 * Parse a Coolify response or throw `CoolifyContractError`. The message names the failing fields
 * (types only): a contract failure means Coolify changed a payload, and the field path is what a
 * maintainer needs to fix it.
 */
export function parseOrContractError(schema, raw, ctx) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issues = formatIssues(parsed.error);
        throw new CoolifyContractError(`Coolify response (${ctx}) failed contract validation: ${summarizeIssues(issues)}`, { zodIssues: issues.join('\n') });
    }
    return parsed.data;
}
/**
 * Validate a value the caller is about to send. Throws `InvalidInputError` (never a raw ZodError,
 * whose class depends on which zod copy is loaded) listing the rejected fields.
 */
export function parseInput(schema, raw, what) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issues = formatIssues(parsed.error);
        throw new InvalidInputError(`Invalid ${what}: ${summarizeIssues(issues)}`, { issues });
    }
    return parsed.data;
}
