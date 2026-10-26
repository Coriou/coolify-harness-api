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
    kind: z.ZodEnum<["application", "service", "database"]>;
    uuid: z.ZodString;
}, "strip", z.ZodTypeAny, {
    instance: string;
    kind: "application" | "service" | "database";
    uuid: string;
}, {
    instance: string;
    kind: "application" | "service" | "database";
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
        kind: z.ZodEnum<["application", "service", "database"]>;
        uuid: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        instance: string;
        kind: "application" | "service" | "database";
        uuid: string;
    }, {
        instance: string;
        kind: "application" | "service" | "database";
        uuid: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    instances: Record<string, {
        url: string;
        tokenEnv: string;
    }>;
    targets: Record<string, {
        instance: string;
        kind: "application" | "service" | "database";
        uuid: string;
    }>;
}, {
    instances: Record<string, {
        url: string;
        tokenEnv: string;
    }>;
    targets: Record<string, {
        instance: string;
        kind: "application" | "service" | "database";
        uuid: string;
    }>;
}>;
export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;
export type TargetKind = 'application' | 'service' | 'database';
export interface ResolvedTarget {
    instanceUrl: string;
    kind: TargetKind;
    uuid: string;
    token: string;
}
/** An instance with its token resolved — for instance-scoped calls (servers, version, ...). */
export interface ResolvedInstance {
    instanceUrl: string;
    token: string;
}
