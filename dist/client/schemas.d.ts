import { z } from 'zod';
export declare const EnvVarSchema: z.ZodEffects<z.ZodObject<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>, {
    value: string;
    value_hidden: boolean;
    is_build_time: boolean;
    uuid: string;
    key: string;
    is_preview: boolean;
    is_literal: boolean;
    is_multiline: boolean;
    is_shown_once: boolean;
    is_buildtime?: boolean | undefined;
}, z.objectInputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>;
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
export declare const EnvWriteItemSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodOptional<z.ZodBoolean>;
    is_multiline: z.ZodOptional<z.ZodBoolean>;
    is_shown_once: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    value: string;
    key: string;
    is_preview?: boolean | undefined;
    is_literal?: boolean | undefined;
    is_multiline?: boolean | undefined;
    is_shown_once?: boolean | undefined;
}, {
    value: string;
    key: string;
    is_preview?: boolean | undefined;
    is_literal?: boolean | undefined;
    is_multiline?: boolean | undefined;
    is_shown_once?: boolean | undefined;
}>;
export type EnvWriteItem = z.infer<typeof EnvWriteItemSchema>;
export declare const BulkRequestSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodString;
        is_preview: z.ZodOptional<z.ZodBoolean>;
        is_literal: z.ZodOptional<z.ZodBoolean>;
        is_multiline: z.ZodOptional<z.ZodBoolean>;
        is_shown_once: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }, {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    data: {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }[];
}, {
    data: {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }[];
}>;
export type BulkRequest = z.infer<typeof BulkRequestSchema>;
export declare const BulkResponseSchema: z.ZodArray<z.ZodEffects<z.ZodObject<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>, {
    value: string;
    value_hidden: boolean;
    is_build_time: boolean;
    uuid: string;
    key: string;
    is_preview: boolean;
    is_literal: boolean;
    is_multiline: boolean;
    is_shown_once: boolean;
    is_buildtime?: boolean | undefined;
}, z.objectInputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_buildtime: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>, "many">;
export declare const DeployAckApplicationSchema: z.ZodObject<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const DeployAckServiceSchema: z.ZodObject<{
    message: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
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
    health_check_port: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    health_check_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_cpus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
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
    health_check_port: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    health_check_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_cpus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
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
    health_check_port: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    health_check_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_memory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    limits_cpus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type Application = z.infer<typeof ApplicationSchema>;
/** Every status Coolify's ApplicationDeploymentStatus enum defines (verified on 4.5.0). */
export declare const DEPLOYMENT_STATUSES: readonly ["queued", "in_progress", "finished", "failed", "cancelled-by-user"];
export type KnownDeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
/** Statuses after which a deployment never changes again. */
export declare const TERMINAL_DEPLOYMENT_STATUSES: readonly string[];
export declare function isTerminalDeploymentStatus(status: string): boolean;
export declare const DeploymentSchema: z.ZodObject<{
    deployment_uuid: z.ZodString;
    status: z.ZodString;
    logs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    application_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
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
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    deployment_uuid: z.ZodString;
    status: z.ZodString;
    logs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    application_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
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
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    deployment_uuid: z.ZodString;
    status: z.ZodString;
    logs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit_message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    application_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
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
}, z.ZodTypeAny, "passthrough">>;
export type Deployment = z.infer<typeof DeploymentSchema>;
/** Generic `{ message }` acknowledgement (env delete, service/proxy restart, ...). */
export declare const MessageAckSchema: z.ZodObject<{
    message: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    message: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export type MessageAck = z.infer<typeof MessageAckSchema>;
export declare const DeploymentCancelSchema: z.ZodObject<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
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
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    databases: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
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
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    databases: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
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
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    databases: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        name: z.ZodString;
        human_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type Service = z.infer<typeof ServiceSchema>;
export declare const ServiceUpdateResponseSchema: z.ZodObject<{
    uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
}, z.ZodTypeAny, "passthrough">>;
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
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_reachable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_usable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_coolify_host: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    proxy: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    settings: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_reachable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_usable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    is_coolify_host: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    proxy: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    settings: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.ZodTypeAny, "passthrough">>;
export type Server = z.infer<typeof ServerSchema>;
export declare const ServerResourceSchema: z.ZodObject<{
    uuid: z.ZodString;
    name: z.ZodString;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type ServerResource = z.infer<typeof ServerResourceSchema>;
export declare const ServerDomainsSchema: z.ZodArray<z.ZodObject<{
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodArray<z.ZodString, "many">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodArray<z.ZodString, "many">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    ip: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    domains: z.ZodArray<z.ZodString, "many">;
}, z.ZodTypeAny, "passthrough">>, "many">;
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
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    proxy_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    redirect_enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    redirect_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    generate_exact_labels: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    traefik_certificate_resolver: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    configuration: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    proxy_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    redirect_enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    redirect_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    generate_exact_labels: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    traefik_certificate_resolver: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    configuration: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type ServerProxy = z.infer<typeof ServerProxySchema>;
/** Fields `PATCH /servers/{uuid}/proxy` accepts; anything else is a 422 "This field is not allowed.". */
export declare const ServerProxyUpdateSchema: z.ZodObject<{
    redirect_enabled: z.ZodOptional<z.ZodBoolean>;
    redirect_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    generate_exact_labels: z.ZodOptional<z.ZodBoolean>;
    traefik_certificate_resolver: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    proxy_type: z.ZodOptional<z.ZodEnum<["traefik", "caddy", "nginx", "none"]>>;
}, "strict", z.ZodTypeAny, {
    proxy_type?: "traefik" | "caddy" | "nginx" | "none" | undefined;
    redirect_enabled?: boolean | undefined;
    redirect_url?: string | null | undefined;
    generate_exact_labels?: boolean | undefined;
    traefik_certificate_resolver?: string | null | undefined;
}, {
    proxy_type?: "traefik" | "caddy" | "nginx" | "none" | undefined;
    redirect_enabled?: boolean | undefined;
    redirect_url?: string | null | undefined;
    generate_exact_labels?: boolean | undefined;
    traefik_certificate_resolver?: string | null | undefined;
}>;
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
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    database_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    public_port: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    database_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_public: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    public_port: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type Database = z.infer<typeof DatabaseSchema>;
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
}, "strict", z.ZodTypeAny, {
    description?: string | undefined;
    name?: string | undefined;
    limits_memory?: string | undefined;
    limits_cpus?: string | undefined;
    image?: string | undefined;
    is_public?: boolean | undefined;
    public_port?: number | undefined;
    public_port_timeout?: number | undefined;
    instant_deploy?: boolean | undefined;
}, {
    description?: string | undefined;
    name?: string | undefined;
    limits_memory?: string | undefined;
    limits_cpus?: string | undefined;
    image?: string | undefined;
    is_public?: boolean | undefined;
    public_port?: number | undefined;
    public_port_timeout?: number | undefined;
    instant_deploy?: boolean | undefined;
}>;
export type DatabaseUpdate = z.infer<typeof DatabaseUpdateSchema>;
export declare const BackupExecutionSchema: z.ZodObject<{
    uuid: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
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
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    frequency: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    save_s3: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    executions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    frequency: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    save_s3: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    executions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
}, z.ZodTypeAny, "passthrough">>;
export type BackupConfig = z.infer<typeof BackupConfigSchema>;
export declare const BackupExecutionsResponseSchema: z.ZodObject<{
    executions: z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    executions: z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    executions: z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        uuid: z.ZodString;
        status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        filename: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        size: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">>;
export declare const RuntimeLogsResponseSchema: z.ZodObject<{
    logs: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    logs: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    logs: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export type RuntimeLogsResponse = z.infer<typeof RuntimeLogsResponseSchema>;
export declare function parseOrContractError<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown, ctx: string): T;
