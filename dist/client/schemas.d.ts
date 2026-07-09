import { z } from 'zod';
export declare const EnvVarSchema: z.ZodObject<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodBoolean;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodBoolean;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodBoolean;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>;
export type EnvVar = z.infer<typeof EnvVarSchema>;
export declare const EnvWriteItemSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodOptional<z.ZodBoolean>;
    is_build_time: z.ZodOptional<z.ZodBoolean>;
    is_literal: z.ZodOptional<z.ZodBoolean>;
    is_multiline: z.ZodOptional<z.ZodBoolean>;
    is_shown_once: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    value: string;
    key: string;
    is_preview?: boolean | undefined;
    is_build_time?: boolean | undefined;
    is_literal?: boolean | undefined;
    is_multiline?: boolean | undefined;
    is_shown_once?: boolean | undefined;
}, {
    value: string;
    key: string;
    is_preview?: boolean | undefined;
    is_build_time?: boolean | undefined;
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
        is_build_time: z.ZodOptional<z.ZodBoolean>;
        is_literal: z.ZodOptional<z.ZodBoolean>;
        is_multiline: z.ZodOptional<z.ZodBoolean>;
        is_shown_once: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_build_time?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }, {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_build_time?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    data: {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_build_time?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }[];
}, {
    data: {
        value: string;
        key: string;
        is_preview?: boolean | undefined;
        is_build_time?: boolean | undefined;
        is_literal?: boolean | undefined;
        is_multiline?: boolean | undefined;
        is_shown_once?: boolean | undefined;
    }[];
}>;
export type BulkRequest = z.infer<typeof BulkRequestSchema>;
export declare const BulkResponseSchema: z.ZodArray<z.ZodObject<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodBoolean;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodBoolean;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    key: z.ZodString;
    value: z.ZodString;
    is_preview: z.ZodBoolean;
    is_build_time: z.ZodBoolean;
    is_literal: z.ZodBoolean;
    is_multiline: z.ZodBoolean;
    is_shown_once: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>, "many">;
export declare const DeployAckApplicationSchema: z.ZodObject<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    message: z.ZodString;
    deployment_uuid: z.ZodOptional<z.ZodString>;
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
    status: z.ZodOptional<z.ZodString>;
    fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_repository: z.ZodOptional<z.ZodString>;
    git_branch: z.ZodOptional<z.ZodString>;
    git_commit_sha: z.ZodOptional<z.ZodString>;
    git_full_url: z.ZodOptional<z.ZodString>;
    build_pack: z.ZodOptional<z.ZodString>;
    health_check_enabled: z.ZodOptional<z.ZodBoolean>;
    health_check_port: z.ZodOptional<z.ZodNumber>;
    health_check_path: z.ZodOptional<z.ZodString>;
    limits_memory: z.ZodOptional<z.ZodString>;
    limits_cpus: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    status: z.ZodOptional<z.ZodString>;
    fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_repository: z.ZodOptional<z.ZodString>;
    git_branch: z.ZodOptional<z.ZodString>;
    git_commit_sha: z.ZodOptional<z.ZodString>;
    git_full_url: z.ZodOptional<z.ZodString>;
    build_pack: z.ZodOptional<z.ZodString>;
    health_check_enabled: z.ZodOptional<z.ZodBoolean>;
    health_check_port: z.ZodOptional<z.ZodNumber>;
    health_check_path: z.ZodOptional<z.ZodString>;
    limits_memory: z.ZodOptional<z.ZodString>;
    limits_cpus: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    uuid: z.ZodString;
    name: z.ZodString;
    status: z.ZodOptional<z.ZodString>;
    fqdn: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    git_repository: z.ZodOptional<z.ZodString>;
    git_branch: z.ZodOptional<z.ZodString>;
    git_commit_sha: z.ZodOptional<z.ZodString>;
    git_full_url: z.ZodOptional<z.ZodString>;
    build_pack: z.ZodOptional<z.ZodString>;
    health_check_enabled: z.ZodOptional<z.ZodBoolean>;
    health_check_port: z.ZodOptional<z.ZodNumber>;
    health_check_path: z.ZodOptional<z.ZodString>;
    limits_memory: z.ZodOptional<z.ZodString>;
    limits_cpus: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export type Application = z.infer<typeof ApplicationSchema>;
export declare const DeploymentSchema: z.ZodObject<{
    deployment_uuid: z.ZodString;
    status: z.ZodEnum<["queued", "in_progress", "finished", "failed", "cancelled-by-user"]>;
    logs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit: z.ZodOptional<z.ZodString>;
    commit_message: z.ZodOptional<z.ZodString>;
    application_name: z.ZodOptional<z.ZodString>;
    server_name: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
    finished_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    force_rebuild: z.ZodOptional<z.ZodBoolean>;
    is_webhook: z.ZodOptional<z.ZodBoolean>;
    is_api: z.ZodOptional<z.ZodBoolean>;
    pull_request_id: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    deployment_uuid: z.ZodString;
    status: z.ZodEnum<["queued", "in_progress", "finished", "failed", "cancelled-by-user"]>;
    logs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit: z.ZodOptional<z.ZodString>;
    commit_message: z.ZodOptional<z.ZodString>;
    application_name: z.ZodOptional<z.ZodString>;
    server_name: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
    finished_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    force_rebuild: z.ZodOptional<z.ZodBoolean>;
    is_webhook: z.ZodOptional<z.ZodBoolean>;
    is_api: z.ZodOptional<z.ZodBoolean>;
    pull_request_id: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    deployment_uuid: z.ZodString;
    status: z.ZodEnum<["queued", "in_progress", "finished", "failed", "cancelled-by-user"]>;
    logs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    commit: z.ZodOptional<z.ZodString>;
    commit_message: z.ZodOptional<z.ZodString>;
    application_name: z.ZodOptional<z.ZodString>;
    server_name: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
    finished_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    force_rebuild: z.ZodOptional<z.ZodBoolean>;
    is_webhook: z.ZodOptional<z.ZodBoolean>;
    is_api: z.ZodOptional<z.ZodBoolean>;
    pull_request_id: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.ZodTypeAny, "passthrough">>;
export type Deployment = z.infer<typeof DeploymentSchema>;
export declare const RuntimeLogsResponseSchema: z.ZodObject<{
    logs: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    logs: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    logs: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export type RuntimeLogsResponse = z.infer<typeof RuntimeLogsResponseSchema>;
export declare function parseOrContractError<T>(schema: z.ZodType<T>, raw: unknown, ctx: string): T;
