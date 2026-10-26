import { z } from 'zod';

export const InstanceSchema = z.object({
  url: z.string().url(),
  tokenEnv: z.string().min(1),
});

export const TargetSchema = z.object({
  instance: z.string().min(1),
  kind: z.enum(['application', 'service', 'database']),
  uuid: z.string().min(1),
});

export const ProjectRegistrySchema = z.object({
  instances: z.record(InstanceSchema),
  targets: z.record(TargetSchema),
});

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
