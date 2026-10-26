import { CircuitBreaker, httpRequest } from './http.js';
import { CoolifyAuthError, CoolifyNotFoundError, CoolifyRequestError } from '../errors/index.js';
export function withQuery(path, query = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined)
            params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
}
function serverMessage(body) {
    if (!body || typeof body !== 'object')
        return { fields: [] };
    const b = body; // reason: narrowed by the object guard above; fields read defensively
    const fields = b.errors && typeof b.errors === 'object' ? Object.keys(b.errors) : [];
    return typeof b.message === 'string' ? { message: b.message, fields } : { fields };
}
/**
 * Shared transport for every Coolify call: bearer auth, retries + circuit breaker (http.ts), and
 * HTTP-status → typed-error mapping. Paths are relative to `${instanceUrl}/api/v1`.
 */
export class CoolifyApi {
    instanceUrl;
    token;
    deps;
    breaker;
    constructor(instanceUrl, token, deps) {
        this.instanceUrl = instanceUrl;
        this.token = token;
        this.deps = deps;
        this.breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
    }
    url(path) {
        return `${this.instanceUrl}/api/v1${path}`;
    }
    async request(path, method, jsonBody) {
        const fullUrl = this.url(path);
        const res = await httpRequest(fullUrl, jsonBody === undefined ? { method, token: this.token } : { method, token: this.token, jsonBody }, {
            fetchImpl: this.deps.fetchImpl,
            logger: this.deps.logger,
            breaker: this.breaker,
            ...(this.deps.maxRetries !== undefined ? { maxRetries: this.deps.maxRetries } : {}),
            ...(this.deps.backoffBaseMs !== undefined ? { backoffBaseMs: this.deps.backoffBaseMs } : {}),
            ...(this.deps.sleep !== undefined ? { sleep: this.deps.sleep } : {}),
        });
        this.assertOk(res, `${method} ${fullUrl}`);
        return res;
    }
    assertOk(res, ctx) {
        if (res.status === 401 || res.status === 403) {
            throw new CoolifyAuthError(`Coolify auth failed (${res.status}) on ${ctx}`, { status: res.status });
        }
        if (res.status === 404) {
            throw new CoolifyNotFoundError(`Coolify resource not found (404) on ${ctx}`);
        }
        if (res.status >= 400) {
            const { message, fields } = serverMessage(res.body);
            const detail = [message, fields.length ? `fields: ${fields.join(', ')}` : ''].filter(Boolean).join('; ');
            throw new CoolifyRequestError(`Coolify request ${ctx} failed with status ${res.status}${detail ? ` — ${detail}` : ''}`, { status: res.status, fields });
        }
    }
}
