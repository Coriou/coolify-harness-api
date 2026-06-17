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
export const EnvWriteItemSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
    is_preview: z.boolean().optional(),
    is_build_time: z.boolean().optional(),
    is_literal: z.boolean().optional(),
    is_multiline: z.boolean().optional(),
    is_shown_once: z.boolean().optional(),
});
export const BulkRequestSchema = z.object({ data: z.array(EnvWriteItemSchema) });
export const BulkResponseSchema = z.array(EnvVarSchema);
export const DeployAckApplicationSchema = z
    .object({ message: z.string(), deployment_uuid: z.string().optional() })
    .passthrough();
export const DeployAckServiceSchema = z.object({ message: z.string() }).passthrough();
export function parseOrContractError(schema, raw, ctx) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        throw new CoolifyContractError(`Coolify response (${ctx}) failed contract validation`, {
            zodIssues: parsed.error.message,
        });
    }
    return parsed.data;
}
