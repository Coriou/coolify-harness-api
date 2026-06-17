import { z } from 'zod';
export declare const InstanceSchema: z.ZodObject<{
    url: z.ZodString;
    tokenEnv: z.ZodString;
}, "strip", z.ZodTypeAny, {
    url: string;
    tokenEnv: string;
}, {
    url: string;
    tokenEnv: string;
}>;
export declare const TargetSchema: z.ZodObject<{
    instance: z.ZodString;
    kind: z.ZodEnum<["application", "service"]>;
    uuid: z.ZodString;
}, "strip", z.ZodTypeAny, {
    instance: string;
    kind: "application" | "service";
    uuid: string;
}, {
    instance: string;
    kind: "application" | "service";
    uuid: string;
}>;
export declare const ProjectRegistrySchema: z.ZodObject<{
    instances: z.ZodRecord<z.ZodString, z.ZodObject<{
        url: z.ZodString;
        tokenEnv: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
        tokenEnv: string;
    }, {
        url: string;
        tokenEnv: string;
    }>>;
    targets: z.ZodRecord<z.ZodString, z.ZodObject<{
        instance: z.ZodString;
        kind: z.ZodEnum<["application", "service"]>;
        uuid: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        instance: string;
        kind: "application" | "service";
        uuid: string;
    }, {
        instance: string;
        kind: "application" | "service";
        uuid: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    instances: Record<string, {
        url: string;
        tokenEnv: string;
    }>;
    targets: Record<string, {
        instance: string;
        kind: "application" | "service";
        uuid: string;
    }>;
}, {
    instances: Record<string, {
        url: string;
        tokenEnv: string;
    }>;
    targets: Record<string, {
        instance: string;
        kind: "application" | "service";
        uuid: string;
    }>;
}>;
export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;
export interface ResolvedTarget {
    instanceUrl: string;
    kind: 'application' | 'service';
    uuid: string;
    token: string;
}
