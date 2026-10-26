import type { ResolvedTarget } from '../config/schema.js';
import { type CoolifyClientDeps } from './base.js';
import { CoolifyInstanceClient } from './instance.js';
import { type DeployAck, type EnvVar, type EnvWriteItem, type Application, type Deployment, type DeploymentCancel, type MessageAck, type Service, type Database, type ServiceUpdateResponse } from './schemas.js';
import { type WaitOptions } from './wait.js';
export type { CoolifyClientDeps } from './base.js';
/** Default page size used for fetching recent deployments when determining "latest". */
export declare const DEFAULT_LATEST_TAKE = 20;
export interface DeployOptions {
    /** Rebuild without the Docker cache (applications only) — needed to pick up a patched base image. */
    force?: boolean;
}
export interface RestartOptions {
    /** Pull the latest images before restarting (services only). */
    latest?: boolean;
}
export interface LogsOptions {
    /**
     * Which container to read. Services: the sub-service `name` from `GET /services/{uuid}`
     * (required). Docker Compose applications: the compose service name (optional filter).
     */
    service?: string;
    timestamps?: boolean;
}
/**
 * Typed client bound to ONE configured target (an application, service or standalone database).
 * Instance-wide operations (servers, proxy, version, any deployment by uuid) live on
 * `CoolifyInstanceClient`; `client.instance()` returns one sharing this client's transport.
 */
export declare class CoolifyClient {
    private readonly target;
    private readonly deps;
    private readonly api;
    constructor(target: ResolvedTarget, deps: CoolifyClientDeps);
    /** Instance-scoped client on the same instance, token, breaker and retry settings. */
    instance(): CoolifyInstanceClient;
    private base;
    private requireKind;
    listEnvs(): Promise<EnvVar[]>;
    upsertEnvs(items: EnvWriteItem[]): Promise<EnvVar[]>;
    /** Delete one env row by its uuid (from `listEnvs()`). Applications, services and databases. */
    deleteEnv(envUuid: string): Promise<MessageAck>;
    /**
     * Deploy (applications: queue a build; services/databases: start). `force` rebuilds without the
     * Docker cache — a plain redeploy of an unchanged commit reuses the existing image.
     */
    deploy(opts?: DeployOptions): Promise<DeployAck>;
    restart(opts?: RestartOptions): Promise<DeployAck>;
    private ackFor;
    /**
     * Fetch full details for the target resource (application, service or database).
     * Includes status, git info (commit sha, branch), fqdn, healthcheck config, etc.
     * The raw payload contains secrets (webhook secrets, compose documents) — pass it through
     * `redactDeep()` before printing.
     */
    get(): Promise<Application>;
    /** Service details incl. `docker_compose_raw` and its sub-applications / sub-databases. */
    getService(): Promise<Service>;
    getDatabase(): Promise<Database>;
    /**
     * Replace a service's docker-compose (`PATCH /services/{uuid}`, base64-encoded as Coolify
     * requires). Coolify validates and re-parses it, but does NOT restart the service — call
     * `restart({ latest: true })` afterwards to pull and run the new images.
     */
    updateServiceCompose(composeRaw: string): Promise<ServiceUpdateResponse>;
    /**
     * Fetch runtime / container logs for the target. Requires read:sensitive.
     * Services need `opts.service` (a sub-service name); compose applications accept it as a filter.
     * @param lines Optional max number of lines (defaults to server ~100).
     */
    getRuntimeLogs(lines?: number, opts?: LogsOptions): Promise<{
        logs: string;
    }>;
    /**
     * List recent deployments for the target (newest first, as Coolify returns them).
     * Only applications have deployment records: services and databases are started/restarted
     * directly and never create one, so they return [] (no request is made).
     * (getLatestDeployment always does client-side sort regardless.)
     */
    listDeployments(opts?: {
        skip?: number;
        take?: number;
    }): Promise<Deployment[]>;
    /** Fetch a single deployment by its uuid (includes embedded build logs with read:sensitive). */
    getDeployment(deploymentUuid: string): Promise<Deployment>;
    /** Cancel a queued / in-progress deployment. Coolify answers 400 if it already finished. */
    cancelDeployment(deploymentUuid: string): Promise<DeploymentCancel>;
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
