/**
 * The project registry (`coolify-harness.config.*` default export) and its validation.
 *
 * Validated by hand rather than with zod: the shape is two small records, and loading zod here
 * would delay every command by the cost of its import before the first request can even be sent
 * (see client/lazy-schemas.ts).
 */
export type TargetKind = 'application' | 'service' | 'database';
export interface InstanceConfig {
    /** `http(s)://host[:port]` of the Coolify instance, without credentials. */
    url: string;
    /** NAME of the environment variable holding the API token. Never the token itself. */
    tokenEnv: string;
}
export interface TargetConfig {
    instance: string;
    kind: TargetKind;
    uuid: string;
}
export interface ProjectRegistry {
    instances: Record<string, InstanceConfig>;
    targets: Record<string, TargetConfig>;
}
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
/**
 * Validate a raw config object. Returns the registry (instance URLs without trailing slashes, and
 * only the known fields) or the list of problems as `path: message`. Messages name types, never
 * values: a token pasted into the config must not be echoed back.
 */
export declare function parseRegistry(raw: unknown): {
    ok: true;
    registry: ProjectRegistry;
} | {
    ok: false;
    issues: string[];
};
