import { z } from 'zod';
export declare const InstanceSchema: z.ZodObject<{
    url: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    tokenEnv: z.ZodString;
}, z.core.$strip>;
export declare const TargetSchema: z.ZodObject<{
    instance: z.ZodString;
    kind: z.ZodEnum<{
        application: "application";
        service: "service";
        database: "database";
    }>;
    uuid: z.ZodString;
}, z.core.$strip>;
export declare const ProjectRegistrySchema: z.ZodObject<{
    instances: z.ZodRecord<z.ZodString, z.ZodObject<{
        url: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        tokenEnv: z.ZodString;
    }, z.core.$strip>>;
    targets: z.ZodRecord<z.ZodString, z.ZodObject<{
        instance: z.ZodString;
        kind: z.ZodEnum<{
            application: "application";
            service: "service";
            database: "database";
        }>;
        uuid: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
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
