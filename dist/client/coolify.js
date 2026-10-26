import { CoolifyApi, withQuery } from './base.js';
import { CoolifyInstanceClient } from './instance.js';
import { BulkRequestSchema, BulkResponseSchema, DeployAckApplicationSchema, DeployAckServiceSchema, ApplicationSchema, DeploymentSchema, DeploymentCancelSchema, MessageAckSchema, RuntimeLogsResponseSchema, ServiceSchema, ServiceUpdateResponseSchema, DatabaseSchema, parseOrContractError, } from './schemas.js';
import { CoolifyFeatureNotSupportedError } from '../errors/index.js';
import { waitForDeployment } from './wait.js';
import { toBase64 } from './compose.js';
/** Default page size used for fetching recent deployments when determining "latest". */
export const DEFAULT_LATEST_TAKE = 20;
/**
 * Typed client bound to ONE configured target (an application, service or standalone database).
 * Instance-wide operations (servers, proxy, version, any deployment by uuid) live on
 * `CoolifyInstanceClient`; `client.instance()` returns one sharing this client's transport.
 */
export class CoolifyClient {
    target;
    deps;
    api;
    constructor(target, deps) {
        this.target = target;
        this.deps = deps;
        this.api = new CoolifyApi(target.instanceUrl, target.token, deps);
    }
    /** Instance-scoped client on the same instance, token, breaker and retry settings. */
    instance() {
        return new CoolifyInstanceClient(this.api);
    }
    base() {
        const family = { application: 'applications', service: 'services', database: 'databases' }[this.target.kind];
        return `/${family}/${encodeURIComponent(this.target.uuid)}`;
    }
    requireKind(kind, what) {
        if (this.target.kind !== kind) {
            throw new CoolifyFeatureNotSupportedError(`${what} is only available for ${kind} targets (this target is a ${this.target.kind}).`);
        }
    }
    async listEnvs() {
        const res = await this.api.request(`${this.base()}/envs`, 'GET');
        return parseOrContractError(BulkResponseSchema, res.body, 'listEnvs');
    }
    async upsertEnvs(items) {
        // Validate + normalize the request at the boundary (design §3.2). This strips any field the
        // Coolify write API does not accept — e.g. a build-time flag injected by an untyped caller —
        // which would otherwise 422 ("This field is not allowed.") the entire bulk write.
        const body = BulkRequestSchema.parse({ data: items });
        const res = await this.api.request(`${this.base()}/envs/bulk`, 'PATCH', body);
        return parseOrContractError(BulkResponseSchema, res.body, 'upsertEnvs');
    }
    /** Delete one env row by its uuid (from `listEnvs()`). Applications, services and databases. */
    async deleteEnv(envUuid) {
        const res = await this.api.request(`${this.base()}/envs/${encodeURIComponent(envUuid)}`, 'DELETE');
        return parseOrContractError(MessageAckSchema, res.body, 'deleteEnv');
    }
    /**
     * Deploy (applications: queue a build; services/databases: start). `force` rebuilds without the
     * Docker cache — a plain redeploy of an unchanged commit reuses the existing image.
     */
    async deploy(opts = {}) {
        if (opts.force && this.target.kind !== 'application') {
            throw new CoolifyFeatureNotSupportedError(`force rebuild only exists for applications. For a ${this.target.kind}, use restart({ latest: true }) to pull fresh images.`);
        }
        const path = withQuery(`${this.base()}/start`, { force: opts.force ? true : undefined });
        return this.ackFor(await this.api.request(path, 'POST'), 'deploy');
    }
    async restart(opts = {}) {
        if (opts.latest && this.target.kind !== 'service') {
            throw new CoolifyFeatureNotSupportedError(`restart --latest (pull images) only exists for services. For an application, use deploy({ force: true }).`);
        }
        const path = withQuery(`${this.base()}/restart`, { latest: opts.latest ? true : undefined });
        return this.ackFor(await this.api.request(path, 'POST'), 'restart');
    }
    ackFor(res, ctx) {
        if (this.target.kind === 'application') {
            const parsed = parseOrContractError(DeployAckApplicationSchema, res.body, ctx);
            return parsed.deployment_uuid == null
                ? { message: parsed.message }
                : { message: parsed.message, deploymentUuid: parsed.deployment_uuid };
        }
        const parsed = parseOrContractError(DeployAckServiceSchema, res.body, ctx);
        return { message: parsed.message };
    }
    /**
     * Fetch full details for the target resource (application, service or database).
     * Includes status, git info (commit sha, branch), fqdn, healthcheck config, etc.
     * The raw payload contains secrets (webhook secrets, compose documents) — pass it through
     * `redactDeep()` before printing.
     */
    async get() {
        const res = await this.api.request(this.base(), 'GET');
        return parseOrContractError(ApplicationSchema, res.body, 'get');
    }
    /** Service details incl. `docker_compose_raw` and its sub-applications / sub-databases. */
    async getService() {
        this.requireKind('service', 'getService');
        const res = await this.api.request(this.base(), 'GET');
        return parseOrContractError(ServiceSchema, res.body, 'getService');
    }
    async getDatabase() {
        this.requireKind('database', 'getDatabase');
        const res = await this.api.request(this.base(), 'GET');
        return parseOrContractError(DatabaseSchema, res.body, 'getDatabase');
    }
    /**
     * Replace a service's docker-compose (`PATCH /services/{uuid}`, base64-encoded as Coolify
     * requires). Coolify validates and re-parses it, but does NOT restart the service — call
     * `restart({ latest: true })` afterwards to pull and run the new images.
     */
    async updateServiceCompose(composeRaw) {
        this.requireKind('service', 'updateServiceCompose');
        const res = await this.api.request(this.base(), 'PATCH', { docker_compose_raw: toBase64(composeRaw) });
        return parseOrContractError(ServiceUpdateResponseSchema, res.body, 'updateServiceCompose');
    }
    /**
     * Fetch runtime / container logs for the target. Requires read:sensitive.
     * Services need `opts.service` (a sub-service name); compose applications accept it as a filter.
     * @param lines Optional max number of lines (defaults to server ~100).
     */
    async getRuntimeLogs(lines, opts = {}) {
        const n = typeof lines === 'number' ? Math.max(1, Math.floor(lines)) : undefined;
        let query;
        if (this.target.kind === 'service') {
            if (!opts.service) {
                const svc = await this.getService();
                const names = [...(svc.applications ?? []), ...(svc.databases ?? [])].map((s) => s.name);
                throw new CoolifyFeatureNotSupportedError(`Service logs need a sub-service name (--service <name>). This service has: ${names.join(', ') || '(none)'}`);
            }
            query = { sub_service_name: opts.service, lines: n, show_timestamps: opts.timestamps };
        }
        else {
            query = {
                lines: n,
                show_timestamps: opts.timestamps,
                service_name: this.target.kind === 'application' ? opts.service : undefined,
            };
        }
        const res = await this.api.request(withQuery(`${this.base()}/logs`, query), 'GET');
        const parsed = parseOrContractError(RuntimeLogsResponseSchema, res.body, 'getRuntimeLogs');
        return { logs: parsed.logs ?? '' };
    }
    /**
     * List recent deployments for the target (newest first, as Coolify returns them).
     * Only applications have deployment records: services and databases are started/restarted
     * directly and never create one, so they return [] (no request is made).
     * (getLatestDeployment always does client-side sort regardless.)
     */
    async listDeployments(opts = {}) {
        if (this.target.kind !== 'application')
            return [];
        const path = withQuery(`/deployments/applications/${encodeURIComponent(this.target.uuid)}`, {
            skip: opts.skip,
            take: opts.take,
        });
        const res = await this.api.request(path, 'GET');
        const raw = res.body;
        let items = [];
        if (Array.isArray(raw)) {
            items = raw;
        }
        else if (raw && typeof raw === 'object' && 'deployments' in raw) {
            const maybe = raw.deployments; // reason: narrowed by the 'deployments' in raw guard above
            if (Array.isArray(maybe))
                items = maybe;
        }
        return items.map((d, i) => parseOrContractError(DeploymentSchema, d, `listDeployments[${i}]`));
    }
    /** Fetch a single deployment by its uuid (includes embedded build logs with read:sensitive). */
    async getDeployment(deploymentUuid) {
        return this.instance().getDeployment(deploymentUuid);
    }
    /** Cancel a queued / in-progress deployment. Coolify answers 400 if it already finished. */
    async cancelDeployment(deploymentUuid) {
        return this.instance().cancelDeployment(deploymentUuid);
    }
    /**
     * Convenience: return the most recent deployment for this target (client-side sort).
     * Sort key: updated_at desc, then created_at desc, then deployment_uuid desc.
     */
    async getLatestDeployment() {
        const list = await this.listDeployments({ take: DEFAULT_LATEST_TAKE });
        if (list.length === 0)
            return undefined;
        const sorted = [...list].sort((a, b) => {
            const au = a.updated_at || a.created_at || '';
            const bu = b.updated_at || b.created_at || '';
            if (au !== bu)
                return bu.localeCompare(au);
            const ac = a.created_at || '';
            const bc = b.created_at || '';
            if (ac !== bc)
                return bc.localeCompare(ac);
            return (b.deployment_uuid || '').localeCompare(a.deployment_uuid || '');
        });
        return sorted[0];
    }
    /**
     * Convenience: return the logs from the latest deployment (build/deploy logs).
     * Fetches the full deployment record when the list entry lacks detailed logs.
     */
    async getLatestBuildLogs() {
        const latest = await this.getLatestDeployment();
        if (!latest)
            return undefined;
        if (latest.logs != null)
            return latest.logs;
        const full = await this.getDeployment(latest.deployment_uuid);
        return full.logs ?? undefined;
    }
    /**
     * Poll until the given deployment reaches a terminal status (finished/failed/cancelled-by-user).
     * Uses the client's getDeployment under the hood.
     * Throws on timeout. Uses injected sleep when provided in deps.
     */
    async waitForDeployment(deploymentUuid, opts) {
        return waitForDeployment((uuid) => this.getDeployment(uuid), deploymentUuid, {
            ...opts,
            ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
        });
    }
}
