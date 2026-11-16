import type { ResolvedInstance } from '../config/schema.js';
import { CoolifyApi, ackAfterWrite, documentSecrets, rawMessage, type CoolifyClientDeps } from './base.js';
import type {
  ServerDomains,
  Application,
  BackupConfig,
  BackupExecution,
  Database,
  DatabaseUpdate,
  Deployment,
  DeploymentCancel,
  MessageAck,
  Server,
  ServerProxy,
  ServerProxyUpdate,
  ServerResource,
  Service,
} from './schemas.js';
import { loadSchemas } from './lazy-schemas.js';
import { CoolifyContractError } from '../errors/index.js';
import { toBase64 } from './compose.js';

const asText = (body: unknown): string => (typeof body === 'string' ? body : JSON.stringify(body ?? '')).trim();
const seg = (uuid: string): string => encodeURIComponent(uuid);

/**
 * Instance-scoped Coolify client: everything that is not tied to one configured target —
 * version/health, servers + proxy, standalone databases, and deployments by uuid.
 *
 * Not exposed by the Coolify API (checked on 4.5.0 and 4.7.5) and therefore NOT here: upgrading Coolify itself,
 * checking/installing server OS package updates, and rebooting a server. Those exist only as
 * dashboard (Livewire) actions; see README "What the Coolify API cannot do".
 */
export class CoolifyInstanceClient {
  private readonly api: CoolifyApi;
  constructor(instance: ResolvedInstance | CoolifyApi, deps?: CoolifyClientDeps) {
    if (instance instanceof CoolifyApi) {
      this.api = instance;
    } else {
      if (!deps) throw new Error('CoolifyInstanceClient: deps are required when constructing from a ResolvedInstance');
      this.api = new CoolifyApi(instance.instanceUrl, instance.token, deps);
    }
  }

  get instanceUrl(): string {
    return this.api.instanceUrl;
  }

  // ── instance ─────────────────────────────────────────────────────────────

  /** Coolify version string, e.g. `4.7.5` (`GET /version`, scope `read`; served as text). */
  async getVersion(): Promise<string> {
    const version = asText((await this.api.request('/version', 'GET')).body);
    // A login page or a proxy's HTML answers 200 too: that is not a Coolify instance answering.
    if (!/^v?\d+\.\d+(\.\d+)?[0-9A-Za-z.+-]*$/.test(version)) {
      throw new CoolifyContractError(
        `${this.api.instanceUrl}/api/v1/version did not answer with a Coolify version (got ${version.length} characters of something else). Is the instance url right, and the API enabled?`,
        { zodIssues: 'version: expected a version string' },
      );
    }
    return version;
  }

  /** `OK` when the instance is healthy (`GET /health`, no auth needed). */
  async getHealth(): Promise<string> {
    return asText((await this.api.request('/health', 'GET')).body);
  }

  /** All applications visible to the token's team. Payload holds secrets — redact before printing. */
  async listApplications(): Promise<Application[]> {
    const res = await this.api.request('/applications', 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.ApplicationListSchema, res.body, 'listApplications');
  }

  async listServices(): Promise<Service[]> {
    const res = await this.api.request('/services', 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.ServiceListSchema, res.body, 'listServices');
  }

  // ── deployments ──────────────────────────────────────────────────────────

  /** Queued + in-progress deployments across the team (`GET /deployments`). */
  async listRunningDeployments(): Promise<Deployment[]> {
    const res = await this.api.request('/deployments', 'GET');
    const items = Array.isArray(res.body) ? res.body : Object.values((res.body ?? {}) as Record<string, unknown>);
    const s = await loadSchemas();
    return items.map((d, i) => s.parseOrContractError(s.DeploymentSchema, d, `listRunningDeployments[${i}]`));
  }

  async getDeployment(deploymentUuid: string): Promise<Deployment> {
    const res = await this.api.request(`/deployments/${seg(deploymentUuid)}`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.DeploymentSchema, res.body, 'getDeployment');
  }

  /** `POST /deployments/{uuid}/cancel` (scope `deploy`). 400 if the deployment already ended. */
  async cancelDeployment(deploymentUuid: string): Promise<DeploymentCancel> {
    const res = await this.api.request(`/deployments/${seg(deploymentUuid)}/cancel`, 'POST');
    return ackAfterWrite(this.api.deps, 'cancelDeployment', res.body, async () => {
      const s = await loadSchemas();
      return s.parseOrContractError(s.DeploymentCancelSchema, res.body, 'cancelDeployment');
    }, () => ({ message: rawMessage(res.body) }));
  }

  // ── servers ──────────────────────────────────────────────────────────────

  /** Server payloads include `settings.sentinel_token` and the stored proxy compose — redact before printing. */
  async listServers(): Promise<Server[]> {
    const res = await this.api.request('/servers', 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.ServerListSchema, res.body, 'listServers');
  }

  async getServer(serverUuid: string): Promise<Server> {
    const res = await this.api.request(`/servers/${seg(serverUuid)}`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.ServerSchema, res.body, 'getServer');
  }

  async getServerResources(serverUuid: string): Promise<ServerResource[]> {
    const res = await this.api.request(`/servers/${seg(serverUuid)}/resources`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.ServerResourceListSchema, res.body, 'getServerResources');
  }

  async getServerDomains(serverUuid: string): Promise<ServerDomains> {
    const res = await this.api.request(`/servers/${seg(serverUuid)}/domains`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.ServerDomainsSchema, res.body, 'getServerDomains');
  }

  // ── proxy ────────────────────────────────────────────────────────────────

  /**
   * Proxy settings. `configuration` (the proxy docker-compose, where the Traefik image tag lives)
   * is only returned with `read:sensitive` + a team admin/owner token, and only when Coolify has it
   * stored in its database — otherwise null.
   */
  async getServerProxy(serverUuid: string): Promise<ServerProxy> {
    const res = await this.api.request(`/servers/${seg(serverUuid)}/proxy`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.ServerProxySchema, res.body, 'getServerProxy');
  }

  /** Redirect / exact-labels / cert-resolver / proxy_type settings. Not the image — see saveServerProxyConfiguration. */
  async updateServerProxy(serverUuid: string, patch: ServerProxyUpdate): Promise<ServerProxy> {
    const s = await loadSchemas();
    const body = s.parseInput(s.ServerProxyUpdateSchema, patch, 'proxy update');
    const res = await this.api.request(`/servers/${seg(serverUuid)}/proxy`, 'PATCH', body);
    return ackAfterWrite(this.api.deps, 'updateServerProxy', res.body, () => s.parseOrContractError(s.ServerProxySchema, res.body, 'updateServerProxy'), () => ({}));
  }

  /**
   * Replace the proxy docker-compose (`PUT /servers/{uuid}/proxy/configuration`, scopes
   * `write` + `deploy`). This is how the Traefik version is changed through the API: edit the
   * `image:` line, save, then `restartServerProxy()`. Coolify writes the file to the server and
   * keeps up to 10 timestamped backups of the previous compose next to it, but does not restart.
   */
  async saveServerProxyConfiguration(serverUuid: string, composeYaml: string): Promise<ServerProxy> {
    // Not marked idempotent: Coolify records the new configuration before it writes the file, so
    // a replay after a lost answer finds "nothing changed" and skips the backup of the old file.
    const res = await this.api.request(`/servers/${seg(serverUuid)}/proxy/configuration`, 'PUT', {
      configuration: toBase64(composeYaml),
    }, { secrets: [...documentSecrets(composeYaml), toBase64(composeYaml)] });
    return ackAfterWrite(this.api.deps, 'saveServerProxyConfiguration', res.body, async () => {
      const s = await loadSchemas();
      return s.parseOrContractError(s.ServerProxySchema, res.body, 'saveServerProxyConfiguration');
    }, () => ({}));
  }

  /** Queue a proxy restart (scope `deploy`). Coolify pulls the image from the stored compose first. */
  async restartServerProxy(serverUuid: string): Promise<MessageAck> {
    const res = await this.api.request(`/servers/${seg(serverUuid)}/proxy/restart`, 'POST');
    return ackAfterWrite(this.api.deps, 'restartServerProxy', res.body, async () => {
      const s = await loadSchemas();
      return s.parseOrContractError(s.MessageAckSchema, res.body, 'restartServerProxy');
    }, () => ({ message: rawMessage(res.body) }));
  }

  // ── standalone databases ─────────────────────────────────────────────────

  /** Database payloads include connection URLs with passwords — redact before printing. */
  async listDatabases(): Promise<Database[]> {
    const res = await this.api.request('/databases', 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.DatabaseListSchema, res.body, 'listDatabases');
  }

  async getDatabase(databaseUuid: string): Promise<Database> {
    const res = await this.api.request(`/databases/${seg(databaseUuid)}`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.DatabaseSchema, res.body, 'getDatabase');
  }

  /**
   * `PATCH /databases/{uuid}` (scope `write`; also `deploy` when `is_public` or `instant_deploy`
   * is sent, because Coolify starts/stops the public-port proxy). Coolify answers with a bare
   * acknowledgement, so re-read with getDatabase() to confirm.
   */
  async updateDatabase(databaseUuid: string, patch: DatabaseUpdate): Promise<void> {
    const s = await loadSchemas();
    const body = s.parseInput(s.DatabaseUpdateSchema, patch, 'database update');
    await this.api.request(`/databases/${seg(databaseUuid)}`, 'PATCH', body);
  }

  /** Scheduled backup configurations, each with its executions. */
  async listDatabaseBackups(databaseUuid: string): Promise<BackupConfig[]> {
    const res = await this.api.request(`/databases/${seg(databaseUuid)}/backups`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.BackupConfigListSchema, res.body, 'listDatabaseBackups');
  }

  /** Executions of one backup configuration. `message` is null unless the token has read:sensitive. */
  async listBackupExecutions(databaseUuid: string, backupUuid: string): Promise<BackupExecution[]> {
    const res = await this.api.request(`/databases/${seg(databaseUuid)}/backups/${seg(backupUuid)}/executions`, 'GET');
    const s = await loadSchemas();
    return s.parseOrContractError(s.BackupExecutionsResponseSchema, res.body, 'listBackupExecutions').executions;
  }

  /** Run an existing backup configuration now (`PATCH …/backups/{id}` with `backup_now`; scopes `write` + `deploy`). */
  async runDatabaseBackup(databaseUuid: string, backupUuid: string): Promise<void> {
    await this.api.request(`/databases/${seg(databaseUuid)}/backups/${seg(backupUuid)}`, 'PATCH', { backup_now: true });
  }
}
