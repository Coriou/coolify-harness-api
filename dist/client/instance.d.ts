import { z } from 'zod';
import type { ResolvedInstance } from '../config/schema.js';
import { CoolifyApi, type CoolifyClientDeps } from './base.js';
import { ServerDomainsSchema, type Application, type BackupConfig, type BackupExecution, type Database, type DatabaseUpdate, type Deployment, type DeploymentCancel, type MessageAck, type Server, type ServerProxy, type ServerProxyUpdate, type ServerResource, type Service } from './schemas.js';
/**
 * Instance-scoped Coolify client: everything that is not tied to one configured target —
 * version/health, servers + proxy, standalone databases, and deployments by uuid.
 *
 * Not exposed by the Coolify API (as of 4.5.0) and therefore NOT here: upgrading Coolify itself,
 * checking/installing server OS package updates, and rebooting a server. Those exist only as
 * dashboard (Livewire) actions; see README "What the Coolify API does not expose".
 */
export declare class CoolifyInstanceClient {
    private readonly api;
    constructor(instance: ResolvedInstance | CoolifyApi, deps?: CoolifyClientDeps);
    get instanceUrl(): string;
    /** Coolify version string, e.g. `4.5.0` (`GET /version`, scope `read`; served as text). */
    getVersion(): Promise<string>;
    /** `OK` when the instance is healthy (`GET /health`, no auth needed). */
    getHealth(): Promise<string>;
    /** All applications visible to the token's team. Payload holds secrets — redact before printing. */
    listApplications(): Promise<Application[]>;
    listServices(): Promise<Service[]>;
    /** Queued + in-progress deployments across the team (`GET /deployments`). */
    listRunningDeployments(): Promise<Deployment[]>;
    getDeployment(deploymentUuid: string): Promise<Deployment>;
    /** `POST /deployments/{uuid}/cancel` (scope `deploy`). 400 if the deployment already ended. */
    cancelDeployment(deploymentUuid: string): Promise<DeploymentCancel>;
    /** Server payloads include `settings.sentinel_token` and the stored proxy compose — redact before printing. */
    listServers(): Promise<Server[]>;
    getServer(serverUuid: string): Promise<Server>;
    getServerResources(serverUuid: string): Promise<ServerResource[]>;
    getServerDomains(serverUuid: string): Promise<z.infer<typeof ServerDomainsSchema>>;
    /**
     * Proxy settings. `configuration` (the proxy docker-compose, where the Traefik image tag lives)
     * is only returned with `read:sensitive` + a team admin/owner token, and only when Coolify has it
     * stored in its database — otherwise null.
     */
    getServerProxy(serverUuid: string): Promise<ServerProxy>;
    /** Redirect / exact-labels / cert-resolver / proxy_type settings. Not the image — see saveServerProxyConfiguration. */
    updateServerProxy(serverUuid: string, patch: ServerProxyUpdate): Promise<ServerProxy>;
    /**
     * Replace the proxy docker-compose (`PUT /servers/{uuid}/proxy/configuration`, scopes
     * `write` + `deploy`). This is how the Traefik version is changed through the API: edit the
     * `image:` line, save, then `restartServerProxy()`. Coolify writes the file to the server and
     * keeps up to 10 timestamped backups of the previous compose next to it, but does not restart.
     */
    saveServerProxyConfiguration(serverUuid: string, composeYaml: string): Promise<ServerProxy>;
    /** Queue a proxy restart (scope `deploy`). Coolify pulls the image from the stored compose first. */
    restartServerProxy(serverUuid: string): Promise<MessageAck>;
    /** Database payloads include connection URLs with passwords — redact before printing. */
    listDatabases(): Promise<Database[]>;
    getDatabase(databaseUuid: string): Promise<Database>;
    /**
     * `PATCH /databases/{uuid}` (scope `write`; also `deploy` when `is_public` or `instant_deploy`
     * is sent, because Coolify starts/stops the public-port proxy). Coolify answers with a bare
     * acknowledgement, so re-read with getDatabase() to confirm.
     */
    updateDatabase(databaseUuid: string, patch: DatabaseUpdate): Promise<void>;
    /** Scheduled backup configurations, each with its executions. */
    listDatabaseBackups(databaseUuid: string): Promise<BackupConfig[]>;
    /** Executions of one backup configuration. `message` is null unless the token has read:sensitive. */
    listBackupExecutions(databaseUuid: string, backupUuid: string): Promise<BackupExecution[]>;
    /** Run an existing backup configuration now (`PATCH …/backups/{id}` with `backup_now`; scopes `write` + `deploy`). */
    runDatabaseBackup(databaseUuid: string, backupUuid: string): Promise<void>;
}
