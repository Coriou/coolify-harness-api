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
export declare function parseOrContractError<T>(schema: z.ZodType<T>, raw: unknown, ctx: string): T;
