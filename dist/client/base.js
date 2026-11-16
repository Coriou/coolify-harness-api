import { CircuitBreaker, httpRequest } from './http.js';
import { CoolifyAuthError, CoolifyNotFoundError, CoolifyRequestError } from '../errors/index.js';
import { REDACTED, redactUrlCredentials } from './redact.js';
export function withQuery(path, query = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined)
            params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
}
const MAX_SERVER_MESSAGE = 400;
/**
 * Make a server-supplied message safe to print and audit: drop anything that repeats a secret we
 * sent, strip credentials inside URLs, collapse whitespace and bound the length.
 */
export function sanitizeServerMessage(message, secrets = []) {
    let out = message;
    // Longest first so a secret that contains another is removed whole.
    for (const secret of [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)) {
        out = out.split(secret).join(REDACTED);
    }
    out = redactUrlCredentials(out).replace(/\s+/g, ' ').trim();
    return out.length > MAX_SERVER_MESSAGE ? `${out.slice(0, MAX_SERVER_MESSAGE)}…` : out;
}
function serverMessage(body, secrets) {
    if (!body || typeof body !== 'object')
        return { fields: [] };
    const b = body; // reason: narrowed by the object guard above; fields read defensively
    const fields = b.errors && typeof b.errors === 'object' ? Object.keys(b.errors) : [];
    return typeof b.message === 'string' ? { message: sanitizeServerMessage(b.message, secrets), fields } : { fields };
}
/**
 * Shared transport for every Coolify call: bearer auth, retries + circuit breaker (http.ts), and
 * HTTP-status → typed-error mapping. Paths are relative to `${instanceUrl}/api/v1`.
 */
export class CoolifyApi {
    token;
    deps;
    breaker;
    instanceUrl;
    constructor(instanceUrl, token, deps) {
        this.token = token;
        this.deps = deps;
        // `https://host/` + `/api/v1` would otherwise produce `//api/v1`.
        this.instanceUrl = instanceUrl.replace(/\/+$/, '');
        this.breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
    }
    url(path) {
        return `${this.instanceUrl}/api/v1${path}`;
    }
    async request(path, method, jsonBody, opts = {}) {
        const fullUrl = this.url(path);
        const d = this.deps;
        const res = await httpRequest(fullUrl, {
            method,
            token: this.token,
            ...(jsonBody !== undefined ? { jsonBody } : {}),
            ...(opts.idempotent !== undefined ? { idempotent: opts.idempotent } : {}),
        }, {
            fetchImpl: d.fetchImpl,
            logger: d.logger,
            breaker: this.breaker,
            ...(d.maxRetries !== undefined ? { maxRetries: d.maxRetries } : {}),
            ...(d.backoffBaseMs !== undefined ? { backoffBaseMs: d.backoffBaseMs } : {}),
            ...(d.sleep !== undefined ? { sleep: d.sleep } : {}),
            ...(d.timeoutMs !== undefined ? { timeoutMs: d.timeoutMs } : {}),
            ...(d.maxRetryDelayMs !== undefined ? { maxRetryDelayMs: d.maxRetryDelayMs } : {}),
        });
        this.assertOk(res, `${method} ${fullUrl}`, opts.secrets ?? []);
        return res;
    }
    assertOk(res, ctx, secrets) {
        if (res.status < 400)
            return;
        const { message, fields } = serverMessage(res.body, secrets);
        if (res.status === 401 || res.status === 403) {
            // Coolify says WHY: `Unauthenticated.`, `Missing required permissions: delete`, or that the
            // token is limited to some projects. That sentence is the actionable part.
            throw new CoolifyAuthError(`Coolify auth failed (${res.status}) on ${ctx}${message ? ` — ${message}` : ''}`, { status: res.status, ...(message !== undefined ? { serverMessage: message } : {}) });
        }
        if (res.status === 404) {
            throw new CoolifyNotFoundError(`Coolify resource not found (404) on ${ctx}${message ? ` — ${message}` : ''}`);
        }
        const detail = [message, fields.length ? `fields: ${fields.join(', ')}` : ''].filter(Boolean).join('; ');
        throw new CoolifyRequestError(`Coolify request ${ctx} failed with status ${res.status}${detail ? ` — ${detail}` : ''}`, { status: res.status, fields });
    }
}
