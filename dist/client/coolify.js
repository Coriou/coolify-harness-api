import { CoolifyApi, ackAfterWrite, documentSecrets, rawMessage, withQuery } from './base.js';
import { CoolifyInstanceClient } from './instance.js';
import { loadSchemas } from './lazy-schemas.js';
import { CoolifyFeatureNotSupportedError } from '../errors/index.js';
import { waitForDeployment } from './wait.js';
import { toBase64 } from './compose.js';
/**
 * Page size used to find the latest deployment. Coolify returns an application's deployments
 * newest first and embeds the full build log in every row (hundreds of kB each), so asking for
 * more than the first row made `status` download megabytes it then threw away. Was 20 until 0.4.x.
 */
export const DEFAULT_LATEST_TAKE = 1;
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
        const s = await loadSchemas();
        return s.parseOrContractError(s.BulkResponseSchema, res.body, 'listEnvs');
    }
    /**
     * Bulk upsert by key (`PATCH …/envs/bulk`). An item without `is_preview` touches the production
     * row only. Services and databases have no preview rows: Coolify drops `is_preview` there and
     * would write the production row, so a preview item is refused for them before anything is sent.
     */
    async upsertEnvs(items) {
        // Validate + normalize the request at the boundary: unknown fields are stripped (Coolify would
        // silently ignore them) and a malformed item fails here, before the wire.
        const s = await loadSchemas();
        const body = s.parseInput(s.BulkRequestSchema, { data: items }, 'env write');
        if (this.target.kind !== 'application' && body.data.some((i) => i.is_preview === true)) {
            throw new CoolifyFeatureNotSupportedError(`Preview env rows only exist for applications (this target is a ${this.target.kind}).`);
        }
        // Upsert-by-key is idempotent, so it may be retried; the values must never be echoed in an error.
        const res = await this.api.request(`${this.base()}/envs/bulk`, 'PATCH', body, {
            idempotent: true,
            // Coolify trims a value before it validates it: an error may quote the trimmed form.
            secrets: body.data.flatMap((i) => [i.value, i.value.trim()]),
        });
        // Services and databases answer a CREATED row without its flag columns, which is not an env
        // row by our schema: the write landed all the same, and callers confirm by re-reading.
        return ackAfterWrite(this.deps, 'upsertEnvs', res, () => s.parseOrContractError(s.BulkResponseSchema, res.body, 'upsertEnvs'), () => []);
    }
    /**
     * Delete one env row by its uuid (from `listEnvs()`). Applications, services and databases.
     * Needs the `delete` token ability from Coolify 4.7 (`write` before).
     */
    async deleteEnv(envUuid) {
        const res = await this.api.request(`${this.base()}/envs/${encodeURIComponent(envUuid)}`, 'DELETE');
        return ackAfterWrite(this.deps, 'deleteEnv', res, async () => {
            const s = await loadSchemas();
            return s.parseOrContractError(s.MessageAckSchema, res.body, 'deleteEnv');
        }, () => ({ message: rawMessage(res.body) }));
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
        // Coolify accepted the request: an acknowledgement we cannot read must not look like a failed
        // deploy (the agent would queue another one).
        return ackAfterWrite(this.deps, ctx, res, async () => {
            const s = await loadSchemas();
            if (this.target.kind === 'application') {
                const parsed = s.parseOrContractError(s.DeployAckApplicationSchema, res.body, ctx);
                return parsed.deployment_uuid == null
                    ? { message: parsed.message }
                    : { message: parsed.message, deploymentUuid: parsed.deployment_uuid };
            }
            const parsed = s.parseOrContractError(s.DeployAckServiceSchema, res.body, ctx);
            return { message: parsed.message };
        }, () => {
            const uuid = res.body && typeof res.body === 'object' ? res.body.deployment_uuid : undefined; // reason: narrowed by the object guard; read defensively
            const message = rawMessage(res.body) || 'accepted';
            return typeof uuid === 'string' && uuid !== '' ? { message, deploymentUuid: uuid } : { message };
        });
    }
    /**
     * Fetch full details for the target resource (application, service or database).
     * Includes status, git info (commit sha, branch), fqdn, healthcheck config, etc.
     * The raw payload contains secrets (webhook secrets, compose documents) — pass it through
     * `redactDeep()` before printing.
     */
    async get() {
        const res = await this.api.request(this.base(), 'GET');
        const s = await loadSchemas();
        return s.parseOrContractError(s.ApplicationSchema, res.body, 'get');
    }
    /** Service details incl. `docker_compose_raw` and its sub-applications / sub-databases. */
    async getService() {
        this.requireKind('service', 'getService');
        const res = await this.api.request(this.base(), 'GET');
        const s = await loadSchemas();
        return s.parseOrContractError(s.ServiceSchema, res.body, 'getService');
    }
    async getDatabase() {
        this.requireKind('database', 'getDatabase');
        const res = await this.api.request(this.base(), 'GET');
        const s = await loadSchemas();
        return s.parseOrContractError(s.DatabaseSchema, res.body, 'getDatabase');
    }
    /**
     * Replace a service's docker-compose (`PATCH /services/{uuid}`, base64-encoded as Coolify
     * requires). Coolify validates and re-parses it, but does NOT restart the service — call
     * `restart({ latest: true })` afterwards to pull and run the new images.
     */
    async updateServiceCompose(composeRaw) {
        this.requireKind('service', 'updateServiceCompose');
        // Replacing the document with the same document is idempotent. A parse error from Coolify
        // quotes the offending line, so every line of the document is scrubbed from its message.
        const res = await this.api.request(this.base(), 'PATCH', { docker_compose_raw: toBase64(composeRaw) }, {
            idempotent: true,
            secrets: [...documentSecrets(composeRaw), toBase64(composeRaw)],
        });
        return ackAfterWrite(this.deps, 'updateServiceCompose', res, async () => {
            const s = await loadSchemas();
            return s.parseOrContractError(s.ServiceUpdateResponseSchema, res.body, 'updateServiceCompose');
        }, () => ({}));
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
        const s = await loadSchemas();
        const parsed = s.parseOrContractError(s.RuntimeLogsResponseSchema, res.body, 'getRuntimeLogs');
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
        const s = await loadSchemas();
        return items.map((d, i) => s.parseOrContractError(s.DeploymentSchema, d, `listDeployments[${i}]`));
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
     * Convenience: the most recent deployment of this target — the first row of Coolify's
     * newest-first list (one request, one row). Its `logs` are present when the token has
     * read:sensitive. `take` widens the window; the newest by created_at (then updated_at) wins.
     *
     * The list also holds pull-request PREVIEW deployments (`pull_request_id` ≠ 0). A preview build
     * is not the state of the application: when the newest row is one, the newest production row is
     * returned instead (one more request, ten rows, unless `take` was given). Only an application
     * that has nothing but preview deployments gets a preview row back.
     */
    async getLatestDeployment(opts = {}) {
        const newestFirst = (list) => (list.length <= 1 ? list : [...list].sort((a, b) => {
            const ac = a.created_at || a.updated_at || '';
            const bc = b.created_at || b.updated_at || '';
            if (ac !== bc)
                return bc.localeCompare(ac);
            const au = a.updated_at || '';
            const bu = b.updated_at || '';
            if (au !== bu)
                return bu.localeCompare(au);
            return (b.deployment_uuid || '').localeCompare(a.deployment_uuid || '');
        }));
        const production = (list) => list.find((d) => (d.pull_request_id ?? 0) === 0);
        let list = newestFirst(await this.listDeployments({ take: opts.take ?? DEFAULT_LATEST_TAKE }));
        if (list.length > 0 && !production(list) && opts.take === undefined) {
            list = newestFirst(await this.listDeployments({ take: 10 }));
        }
        return production(list) ?? list[0];
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
