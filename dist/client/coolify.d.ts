import type { ResolvedTarget } from '../config/schema.js';
import { CircuitBreaker, type FetchLike } from './http.js';
import type { Logger } from '../logging/index.js';
import { type DeployAck, type EnvVar, type EnvWriteItem, type Application, type Deployment } from './schemas.js';
import { type WaitOptions } from './wait.js';
export interface CoolifyClientDeps {
    fetchImpl: FetchLike;
    logger: Logger;
    breaker?: CircuitBreaker;
    maxRetries?: number;
    backoffBaseMs?: number;
    sleep?: (ms: number) => Promise<void>;
}
export declare class CoolifyClient {
    private readonly target;
    private readonly deps;
    private readonly breaker;
    constructor(target: ResolvedTarget, deps: CoolifyClientDeps);
    private base;
    /** Low-level request against an absolute URL. Reused by resource paths and deployment paths. */
    private performRequest;
    private request;
    private assertOk;
    listEnvs(): Promise<EnvVar[]>;
    upsertEnvs(items: EnvWriteItem[]): Promise<EnvVar[]>;
    deploy(): Promise<DeployAck>;
    restart(): Promise<DeployAck>;
    private ackFor;
    /**
     * Fetch full details for the target resource (application or service).
     * Includes status, git info (commit sha, branch), fqdn, healthcheck config, etc.
     */
    get(): Promise<Application>;
    /**
     * Fetch runtime / container logs for the target.
     * Only supported for kind === 'application'. Requires read:sensitive scope.
     * @param lines Optional max number of lines (defaults to server ~100).
     */
    getRuntimeLogs(lines?: number): Promise<{
        logs: string;
    }>;
    /**
     * List recent deployments for the target.
     * For applications: uses the dedicated /deployments/applications/{uuid} endpoint (supports skip/take).
     * For services: falls back to the general /deployments list (may be broader).
     * Results are returned in the order received from API; callers can sort client-side.
     */
    listDeployments(opts?: {
        skip?: number;
        take?: number;
    }): Promise<Deployment[]>;
    /**
     * Fetch a single deployment by its uuid (includes embedded logs for build/deploy output).
     * Works across instances (uses the client's instance URL + token).
     */
    getDeployment(deploymentUuid: string): Promise<Deployment>;
    /**
     * Convenience: return the most recent deployment for this target (client-side sort).
     * Sort key: updated_at desc, then created_at desc, then deployment_uuid desc.
     */
    getLatestDeployment(): Promise<Deployment | undefined>;
    /**
     * Convenience: return the logs from the latest deployment (build/deploy logs).
     * Fetches the full deployment record when the list entry lacks detailed logs.
     */
    getLatestBuildLogs(): Promise<string | undefined>;
    /**
     * Poll until the given deployment reaches a terminal status (finished/failed/cancelled-by-user).
     * Uses the client's getDeployment under the hood.
     * Throws on timeout. Uses injected sleep when provided in deps.
     */
    waitForDeployment(deploymentUuid: string, opts?: WaitOptions): Promise<Deployment>;
}
