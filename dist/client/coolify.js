import { CircuitBreaker, httpRequest } from './http.js';
import { BulkResponseSchema, DeployAckApplicationSchema, DeployAckServiceSchema, EnvVarSchema, ApplicationSchema, DeploymentSchema, RuntimeLogsResponseSchema, parseOrContractError, } from './schemas.js';
import { CoolifyAuthError, CoolifyNotFoundError, CoolifyFeatureNotSupportedError } from '../errors/index.js';
import { waitForDeployment } from './wait.js';
export class CoolifyClient {
    target;
    deps;
    breaker;
    constructor(target, deps) {
        this.target = target;
        this.deps = deps;
        this.breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
    }
    base() {
        const family = this.target.kind === 'application' ? 'applications' : 'services';
        return `${this.target.instanceUrl}/api/v1/${family}/${this.target.uuid}`;
    }
    /** Low-level request against an absolute URL. Reused by resource paths and deployment paths. */
    async performRequest(fullUrl, method, jsonBody) {
        const res = await httpRequest(fullUrl, jsonBody === undefined
            ? { method, token: this.target.token }
            : { method, token: this.target.token, jsonBody }, {
            fetchImpl: this.deps.fetchImpl,
            logger: this.deps.logger,
            breaker: this.breaker,
            ...(this.deps.maxRetries !== undefined ? { maxRetries: this.deps.maxRetries } : {}),
            ...(this.deps.backoffBaseMs !== undefined ? { backoffBaseMs: this.deps.backoffBaseMs } : {}),
            ...(this.deps.sleep !== undefined ? { sleep: this.deps.sleep } : {}),
        });
        this.assertOk(res, fullUrl);
        return res;
    }
    async request(path, method, jsonBody) {
        return this.performRequest(`${this.base()}${path}`, method, jsonBody);
    }
    assertOk(res, ctx) {
        if (res.status === 401 || res.status === 403) {
            throw new CoolifyAuthError(`Coolify auth failed (${res.status}) on ${ctx}`, { status: res.status });
        }
        if (res.status === 404) {
            throw new CoolifyNotFoundError(`Coolify resource not found (404) on ${ctx}`);
        }
        if (res.status >= 400) {
            throw new Error(`Coolify request to ${ctx} failed with status ${res.status}`);
        }
    }
    async listEnvs() {
        const res = await this.request('/envs', 'GET');
        return parseOrContractError(BulkResponseSchema, res.body, 'listEnvs');
    }
    async upsertEnvs(items) {
        const res = await this.request('/envs/bulk', 'PATCH', { data: items });
        return parseOrContractError(BulkResponseSchema, res.body, 'upsertEnvs');
    }
    async deploy() {
        return this.ackFor(await this.request('/start', 'POST'), 'deploy');
    }
    async restart() {
        return this.ackFor(await this.request('/restart', 'POST'), 'restart');
    }
    ackFor(res, ctx) {
        if (this.target.kind === 'application') {
            const parsed = parseOrContractError(DeployAckApplicationSchema, res.body, ctx);
            return parsed.deployment_uuid === undefined
                ? { message: parsed.message }
                : { message: parsed.message, deploymentUuid: parsed.deployment_uuid };
        }
        const parsed = parseOrContractError(DeployAckServiceSchema, res.body, ctx);
        return { message: parsed.message };
    }
    /**
     * Fetch full details for the target resource (application or service).
     * Includes status, git info (commit sha, branch), fqdn, healthcheck config, etc.
     */
    async get() {
        const res = await this.request('', 'GET');
        return parseOrContractError(ApplicationSchema, res.body, 'get');
    }
    /**
     * Fetch runtime / container logs for the target.
     * Only supported for kind === 'application'. Requires read:sensitive scope.
     * @param lines Optional max number of lines (defaults to server ~100).
     */
    async getRuntimeLogs(lines) {
        if (this.target.kind !== 'application') {
            throw new CoolifyFeatureNotSupportedError('Runtime logs (/applications/{uuid}/logs) are only available for application targets. Services do not expose a /logs endpoint in the current API contract.');
        }
        const q = typeof lines === 'number' ? `?lines=${Math.max(1, Math.floor(lines))}` : '';
        const res = await this.request(`/logs${q}`, 'GET');
        const parsed = parseOrContractError(RuntimeLogsResponseSchema, res.body, 'getRuntimeLogs');
        return { logs: parsed.logs ?? '' };
    }
    /**
     * List recent deployments for the target.
     * For applications: uses the dedicated /deployments/applications/{uuid} endpoint (supports skip/take).
     * For services: falls back to the general /deployments list (may be broader).
     * Results are returned in the order received from API; callers can sort client-side.
     */
    async listDeployments(opts = {}) {
        const baseUrl = this.target.instanceUrl;
        let url;
        if (this.target.kind === 'application') {
            url = `${baseUrl}/api/v1/deployments/applications/${encodeURIComponent(this.target.uuid)}`;
        }
        else {
            url = `${baseUrl}/api/v1/deployments`;
        }
        const params = new URLSearchParams();
        if (opts.skip !== undefined)
            params.set('skip', String(opts.skip));
        if (opts.take !== undefined)
            params.set('take', String(opts.take));
        if (params.toString())
            url += `?${params.toString()}`;
        const res = await this.performRequest(url, 'GET');
        const raw = res.body;
        let items = [];
        if (Array.isArray(raw)) {
            items = raw;
        }
        else if (raw && typeof raw === 'object' && 'deployments' in raw) {
            const maybe = raw.deployments;
            if (Array.isArray(maybe))
                items = maybe;
        }
        return items.map((d, i) => parseOrContractError(DeploymentSchema, d, `listDeployments[${i}]`));
    }
    /**
     * Fetch a single deployment by its uuid (includes embedded logs for build/deploy output).
     * Works across instances (uses the client's instance URL + token).
     */
    async getDeployment(deploymentUuid) {
        const url = `${this.target.instanceUrl}/api/v1/deployments/${encodeURIComponent(deploymentUuid)}`;
        const res = await this.performRequest(url, 'GET');
        return parseOrContractError(DeploymentSchema, res.body, 'getDeployment');
    }
    /**
     * Convenience: return the most recent deployment for this target (client-side sort).
     * Sort key: updated_at desc, then created_at desc, then deployment_uuid desc.
     */
    async getLatestDeployment() {
        const list = await this.listDeployments({ take: 20 });
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
