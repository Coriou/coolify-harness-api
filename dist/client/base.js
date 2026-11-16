import { CircuitBreaker, httpRequest } from './http.js';
import { CoolifyAuthError, CoolifyContractError, CoolifyNotFoundError, CoolifyRequestError } from '../errors/index.js';
import { REDACTED, redactUrlCredentials } from './redact.js';
import { preloadSchemasOnceRequestIsSent } from './lazy-schemas.js';
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
 * The strings of a document (compose, proxy configuration) that a server error must not quote
 * back: the document itself, each of its lines, and each assigned value. A parse error typically
 * cites the offending line, which is where the literal secrets are.
 */
export function documentSecrets(document) {
    const out = new Set([document]);
    for (const raw of document.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.length >= 4)
            out.add(line);
        const value = /^(?:-\s*)?['"]?[^=:'"]+['"]?\s*[=:]\s*(.+)$/.exec(line)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
        if (value !== undefined && value.length >= 4 && !/^(true|false|yes|no|on|off|null|\d+)$/i.test(value))
            out.add(value);
    }
    return [...out];
}
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
        // Load the validators while Coolify is answering, not before the request leaves.
        preloadSchemasOnceRequestIsSent();
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
        if (res.status >= 300 && res.status < 400) {
            let to = '';
            try {
                to = res.location ? ` to ${new URL(res.location, this.instanceUrl).origin}` : '';
            }
            catch { /* unparseable Location */ }
            throw new CoolifyRequestError(`Coolify answered ${ctx} with a redirect (${res.status})${to}. Redirects are not followed: set the instance url in the config to the final address (https, no trailing path).`, { status: res.status });
        }
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
/** `message` of a JSON acknowledgement, read without a schema. */
export function rawMessage(body) {
    const m = body && typeof body === 'object' ? body.message : undefined; // reason: narrowed by the object guard; read defensively
    return typeof m === 'string' ? m : '';
}
/**
 * Parse the acknowledgement of a mutation Coolify has ALREADY accepted (2xx). If the body is JSON
 * (or empty) but does not match the schema — or the validators cannot be loaded — the write still
 * happened: reporting it as a failure would make an agent repeat it (a second deployment, a second
 * delete). So an acknowledgement in an unexpected JSON shape is logged and replaced by a
 * best-effort one.
 *
 * A 2xx that is not JSON at all (an HTML login or maintenance page from a proxy, a wrong URL) is
 * NOT an acknowledgement: nothing says Coolify saw the request, so that stays an error.
 */
export async function ackAfterWrite(deps, ctx, body, parse, fallback) {
    try {
        return await parse();
    }
    catch (err) {
        const isJson = body === undefined || (body !== null && typeof body === 'object');
        if (!isJson) {
            throw new CoolifyContractError(`Coolify answered ${ctx} with a 2xx that is not JSON (a login or maintenance page? a wrong instance url?). Whether the request was carried out is unknown: check before retrying.`, { zodIssues: 'non-JSON body' });
        }
        deps.logger.warn('coolify.ack.unrecognised', { ctx, error: err instanceof Error ? err.message : String(err) });
        return fallback();
    }
}
