import { z } from 'zod';
export declare const EnvVarSchema: z.ZodPipe<z.ZodObject<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.core.$loose>, z.ZodTransform<{
    is_build_time: boolean;
    value_null?: boolean;
    value: string;
    value_hidden: boolean;
    uuid: string;
    key: string;
    is_preview: boolean;
    is_literal: boolean;
    is_multiline: boolean;
    is_shown_once: boolean;
    is_buildtime?: boolean | undefined;
}, {
    [x: string]: unknown;
    uuid: string;
    key: string;
    is_preview: boolean;
    is_literal: boolean;
    is_multiline: boolean;
    is_shown_once: boolean;
    value?: string | null | undefined;
    is_build_time?: boolean | undefined;
    is_buildtime?: boolean | undefined;
}>>;
export type EnvVar = z.infer<typeof EnvVarSchema>;
/**
 * Fields Coolify's bulk env endpoint (`PATCH …/envs/bulk`) accepts. The handler keeps only these
 * and silently drops anything else, so the request is validated here: a typo must fail loudly
 * instead of being ignored. Applications take all of them; services and databases have no preview
 * rows and no build-time/runtime flags (`is_preview`, `is_buildtime`, `is_runtime` are dropped
 * server-side). The legacy spelling `is_build_time` was never accepted on writes and stays absent.
 * Verified against Coolify 4.5.0 and 4.7.5 (`create_bulk_envs` in the three API controllers).
 */
export declare const EnvWriteItemSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodOptional<z.ZodBoolean>;
    is_multiline: z.ZodOptional<z.ZodBoolean>;
    is_shown_once: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_runtime: z.ZodOptional<z.ZodBoolean>;
    comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type EnvWriteItem = z.infer<typeof EnvWriteItemSchema>;
export declare const BulkRequestSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodString;
        is_preview: z.ZodOptional<z.ZodBoolean>;
        is_literal: z.ZodOptional<z.ZodBoolean>;
        is_multiline: z.ZodOptional<z.ZodBoolean>;
        is_shown_once: z.ZodOptional<z.ZodBoolean>;
        is_buildtime: z.ZodOptional<z.ZodBoolean>;
        is_runtime: z.ZodOptional<z.ZodBoolean>;
        comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BulkRequest = z.infer<typeof BulkRequestSchema>;
export declare const BulkResponseSchema: z.ZodArray<z.ZodPipe<z.ZodObject<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.core.$loose>, z.ZodTransform<{
    is_build_time: boolean;
    value_null?: boolean;
    value: string;
    value_hidden: boolean;
    uuid: string;
    key: string;
    is_preview: boolean;
    is_literal: boolean;
    is_multiline: boolean;
    is_shown_once: boolean;
    is_buildtime?: boolean | undefined;
}, {
    [x: string]: unknown;
    uuid: string;
    key: string;
    is_preview: boolean;
    is_literal: boolean;
    is_multiline: boolean;
    is_shown_once: boolean;
    value?: string | null | undefined;
    is_build_time?: boolean | undefined;
    is_buildtime?: boolean | undefined;
}>>>;
export declare const DeployAckApplicationSchema: z.ZodObject<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export declare const DeployAckServiceSchema: z.ZodObject<{
    message: z.ZodString;
}, z.core.$loose>;
export interface DeployAck {
    message: string;
    deploymentUuid?: string;
}
export declare const ApplicationSchema: z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_repository: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_branch: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_commit_sha: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_full_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    build_pack: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    docker_compose_raw: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    health_check_enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    health_check_port: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    health_check_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_cpus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type Application = z.infer<typeof ApplicationSchema>;
export declare const ApplicationListSchema: z.ZodArray<z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_repository: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_branch: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_commit_sha: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_full_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    build_pack: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    docker_compose_raw: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    health_check_enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    health_check_port: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    health_check_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_cpus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>>;
export { DEPLOYMENT_STATUSES, TERMINAL_DEPLOYMENT_STATUSES, isTerminalDeploymentStatus, type KnownDeploymentStatus, } from './deployment-status.js';
export declare const DeploymentSchema: z.ZodObject<{
    deployment_uuid: z.ZodString;
    status: z.ZodString;
    logs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    application_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>>;
    application_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    server_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    finished_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    force_rebuild: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    restart_only: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_webhook: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_api: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    pull_request_id: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$loose>;
export type Deployment = z.infer<typeof DeploymentSchema>;
/** Generic `{ message }` acknowledgement (env delete, service/proxy restart, ...). */
export declare const MessageAckSchema: z.ZodObject<{
    message: z.ZodString;
}, z.core.$loose>;
export type MessageAck = z.infer<typeof MessageAckSchema>;
export declare const DeploymentCancelSchema: z.ZodObject<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type DeploymentCancel = z.infer<typeof DeploymentCancelSchema>;
export declare const ServiceSchema: z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    service_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    docker_compose_raw: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    applications: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.core.$loose>>>>;
    databases: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.core.$loose>>>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type Service = z.infer<typeof ServiceSchema>;
export declare const ServiceListSchema: z.ZodArray<z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    service_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    docker_compose_raw: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    applications: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.core.$loose>>>>;
    databases: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.core.$loose>>>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>>;
export declare const ServiceUpdateResponseSchema: z.ZodObject<{
    uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
}, z.core.$loose>;
export type ServiceUpdateResponse = z.infer<typeof ServiceUpdateResponseSchema>;
export declare const ServerSchema: z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_reachable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_usable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_coolify_host: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    proxy: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    settings: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$loose>;
export type Server = z.infer<typeof ServerSchema>;
export declare const ServerListSchema: z.ZodArray<z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_reachable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_usable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_coolify_host: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    proxy: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    settings: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$loose>>;
export declare const ServerResourceSchema: z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type ServerResource = z.infer<typeof ServerResourceSchema>;
export declare const ServerResourceListSchema: z.ZodArray<z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>>;
export declare const ServerDomainsSchema: z.ZodArray<z.ZodObject<{
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodArray<z.ZodString>;
}, z.core.$loose>>;
export type ServerDomains = z.infer<typeof ServerDomainsSchema>;
/**
 * GET/PATCH /servers/{uuid}/proxy and PUT .../proxy/configuration. `configuration` (the raw proxy
 * docker-compose) is only present when the token has read:sensitive AND the user is a team
 * admin/owner AND Coolify has it stored — otherwise it is null or absent.
 */
export declare const ServerProxySchema: z.ZodObject<{
    proxy_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    redirect_enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    redirect_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    generate_exact_labels: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    traefik_certificate_resolver: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    configuration: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type ServerProxy = z.infer<typeof ServerProxySchema>;
/**
 * Fields `PATCH /servers/{uuid}/proxy` accepts; anything else is a 422 "This field is not allowed.".
 * `proxy_error_page` exists from Coolify 4.7.
 */
export declare const ServerProxyUpdateSchema: z.ZodObject<{
    redirect_enabled: z.ZodOptional<z.ZodBoolean>;
    redirect_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    generate_exact_labels: z.ZodOptional<z.ZodBoolean>;
    traefik_certificate_resolver: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    proxy_type: z.ZodOptional<z.ZodEnum<{
        traefik: "traefik";
        caddy: "caddy";
        nginx: "nginx";
        none: "none";
    }>>;
    proxy_error_page: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type ServerProxyUpdate = z.infer<typeof ServerProxyUpdateSchema>;
export declare const DatabaseSchema: z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    database_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    public_port: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type Database = z.infer<typeof DatabaseSchema>;
export declare const DatabaseListSchema: z.ZodArray<z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    database_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    public_port: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>>;
/**
 * The subset of `PATCH /databases/{uuid}` fields the harness exposes. Changing `is_public` (or
 * `instant_deploy`) also needs the `deploy` ability — Coolify starts/stops the public-port proxy.
 * Credentials (postgres_password, ...) are deliberately not settable through the harness.
 */
export declare const DatabaseUpdateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodString>;
    is_public: z.ZodOptional<z.ZodBoolean>;
    public_port: z.ZodOptional<z.ZodNumber>;
    public_port_timeout: z.ZodOptional<z.ZodNumber>;
    limits_memory: z.ZodOptional<z.ZodString>;
    limits_cpus: z.ZodOptional<z.ZodString>;
    instant_deploy: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type DatabaseUpdate = z.infer<typeof DatabaseUpdateSchema>;
export declare const BackupExecutionSchema: z.ZodObject<{
    uuid: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    size: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type BackupExecution = z.infer<typeof BackupExecutionSchema>;
export declare const BackupConfigSchema: z.ZodObject<{
    uuid: z.ZodString;
    frequency: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    save_s3: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    executions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$loose>>>>;
}, z.core.$loose>;
export type BackupConfig = z.infer<typeof BackupConfigSchema>;
export declare const BackupConfigListSchema: z.ZodArray<z.ZodObject<{
    uuid: z.ZodString;
    frequency: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    save_s3: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    executions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$loose>>>>;
}, z.core.$loose>>;
export declare const BackupExecutionsResponseSchema: z.ZodObject<{
    executions: z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const RuntimeLogsResponseSchema: z.ZodObject<{
    logs: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export type RuntimeLogsResponse = z.infer<typeof RuntimeLogsResponseSchema>;
/**
 * `path: problem` for each schema issue. Built from the issue's path and Zod's own message, which
 * names expected and received TYPES — never the received value — so it is safe to print for a
 * payload full of secrets.
 */
export declare function formatIssues(error: z.ZodError): string[];
export declare function summarizeIssues(issues: string[]): string;
/**
 * Parse a Coolify response or throw `CoolifyContractError`. The message names the failing fields
 * (types only): a contract failure means Coolify changed a payload, and the field path is what a
 * maintainer needs to fix it.
 */
export declare function parseOrContractError<T>(schema: z.ZodType<T>, raw: unknown, ctx: string): T;
/**
 * Validate a value the caller is about to send. Throws `InvalidInputError` (never a raw ZodError,
 * whose class depends on which zod copy is loaded) listing the rejected fields.
 */
export declare function parseInput<T>(schema: z.ZodType<T>, raw: unknown, what: string): T;
