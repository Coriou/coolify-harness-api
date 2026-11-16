import { z } from 'zod';

/** `http(s)://host[:port][/base]` without credentials; trailing slashes are dropped. */
const InstanceUrlSchema = z
  .string()
  .refine((value) => {
    try {
      const u = new URL(value);
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.username === '' && u.password === '';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL without credentials (the token goes in the env var named by tokenEnv)')
  .transform((value) => value.replace(/\/+$/, ''));

export const InstanceSchema = z.object({
  url: InstanceUrlSchema,
  /** NAME of the environment variable holding the API token. Never the token itself. */
  // A Coolify token looks like `12|AbC…`: refuse it here so it never lands in a committed config.
  tokenEnv: z.string().min(1).regex(/^[^|\s]+$/, 'must be the NAME of an environment variable, never the token itself'),
});

export const TargetSchema = z.object({
  instance: z.string().min(1),
  kind: z.enum(['application', 'service', 'database']),
  uuid: z.string().min(1),
});

export const ProjectRegistrySchema = z.object({
  instances: z.record(z.string(), InstanceSchema),
  targets: z.record(z.string(), TargetSchema),
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
