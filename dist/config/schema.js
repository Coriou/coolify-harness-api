import { z } from 'zod';
export const InstanceSchema = z.object({
    url: z.string().url(),
    tokenEnv: z.string().min(1),
});
export const TargetSchema = z.object({
    instance: z.string().min(1),
    kind: z.enum(['application', 'service']),
    uuid: z.string().min(1),
});
export const ProjectRegistrySchema = z.object({
    instances: z.record(InstanceSchema),
    targets: z.record(TargetSchema),
});
