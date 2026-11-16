import { CoolifyBulkUnmarshalError, CoolifyNetworkError } from '../errors/index.js';
import { HARNESS_VERSION } from '../version.js';
export class CircuitBreaker {
    opts;
    failures = 0;
    openedAt = 0;
    internalState = 'closed';
    now;
    constructor(opts) {
        this.opts = opts;
        this.now = opts.now ?? (() => Date.now());
    }
    get state() {
        return this.internalState;
    }
    canRequest() {
        if (this.internalState === 'open') {
            if (this.now() - this.openedAt >= this.opts.resetTimeoutMs) {
                this.internalState = 'half-open';
                return true;
            }
            return false;
        }
        return true;
    }
    recordSuccess() {
        this.failures = 0;
        this.internalState = 'closed';
    }
    recordFailure() {
        this.failures += 1;
        if (this.internalState === 'half-open' || this.failures >= this.opts.failureThreshold) {
            this.internalState = 'open';
            this.openedAt = this.now();
        }
    }
}
export const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const USER_AGENT = `coolify-harness/${HARNESS_VERSION}`;
const UNMARSHAL_RE = /cannot unmarshal array/i;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Parse a response body. Most Coolify endpoints return JSON, but `/version` and `/health` return a
 * bare `text/html` string (e.g. `4.7.5`, `OK`) that is not valid JSON. Fall back to the raw text
 * rather than letting `JSON.parse` throw a SyntaxError out of the transport layer.
 */
function parseBody(text) {
    if (text.length === 0)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function bodyHasUnmarshalQuirk(body) {
    if (body && typeof body === 'object' && 'message' in body) {
        const msg = body.message; // reason: narrowed by the 'message' in body guard above
        return typeof msg === 'string' && UNMARSHAL_RE.test(msg);
    }
    return false;
}
/** `scheme://host[:port]` of a URL, for messages (the path may be long; the origin is what failed). */
function originOf(url) {
    try {
        return new URL(url).origin;
    }
    catch {
        return url;
    }
}
/** The system error code behind a failed `fetch` (`ENOTFOUND`, `ECONNREFUSED`, `UND_ERR_…`), if any. */
function causeCode(err) {
    let cur = err;
    for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth += 1) {
        const code = cur.code; // reason: probing the optional `code` of an unknown error
        if (typeof code === 'string')
            return code;
        cur = cur.cause; // reason: walking the optional `cause` chain of an unknown error
    }
    return undefined;
}
function isTimeout(err) {
    const name = err && typeof err === 'object' ? err.name : undefined; // reason: probing the optional `name` of an unknown error
    return name === 'TimeoutError' || name === 'AbortError';
}
function networkError(url, method, err, timeoutMs) {
    const origin = originOf(url);
    if (isTimeout(err)) {
        return new CoolifyNetworkError(`Coolify did not answer ${method} ${url} within ${Math.round(timeoutMs / 1000)}s`, { reason: 'timeout' });
    }
    const code = causeCode(err);
    const detail = err instanceof Error ? err.message : String(err);
    return new CoolifyNetworkError(`Cannot reach Coolify at ${origin} (${method}): ${code ? `${code} — ` : ''}${detail}`, { reason: code ?? 'network' });
}
/** Seconds form only (`Retry-After: 2`); an HTTP-date or garbage yields undefined. */
function retryAfterMs(header) {
    if (header === null || !/^\d+(\.\d+)?$/.test(header.trim()))
        return undefined;
    return Number(header) * 1000;
}
export async function httpRequest(url, init, opts) {
    const { fetchImpl, breaker, logger } = opts;
    const maxRetries = opts.maxRetries ?? 3;
    const backoffBaseMs = opts.backoffBaseMs ?? 250;
    const sleep = opts.sleep ?? defaultSleep;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetryDelayMs = opts.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    const idempotent = init.idempotent ?? /^(GET|HEAD)$/i.test(init.method);
    const backoff = (attempt) => Math.min(maxRetryDelayMs, backoffBaseMs * 2 ** attempt);
    if (!breaker.canRequest()) {
        throw new CoolifyNetworkError(`Circuit open for ${originOf(url)} after repeated failures; refusing ${init.method} ${url}`, { reason: 'circuit-open' });
    }
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const headers = {
            Authorization: `Bearer ${init.token}`,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        };
        let requestInit = { method: init.method, headers };
        if (init.jsonBody !== undefined) {
            headers['content-type'] = 'application/json';
            requestInit = { ...requestInit, body: JSON.stringify(init.jsonBody) };
        }
        if (timeoutMs > 0)
            requestInit = { ...requestInit, signal: AbortSignal.timeout(timeoutMs) };
        logger.debug('coolify.request', {
            url,
            method: init.method,
            attempt,
            bodyFieldCount: init.jsonBody && typeof init.jsonBody === 'object'
                ? Object.keys(init.jsonBody).length
                : 0,
        });
        let response;
        let text;
        try {
            response = await fetchImpl(url, requestInit);
            // Reading the body is part of the attempt: a connection dropped mid-body is a network error.
            text = await response.text();
        }
        catch (err) {
            breaker.recordFailure();
            if (idempotent && attempt < maxRetries) {
                await sleep(backoff(attempt));
                continue;
            }
            throw networkError(url, init.method, err, timeoutMs);
        }
        const status = response.status;
        const body = parseBody(text);
        if (status >= 200 && status < 300) {
            breaker.recordSuccess();
            return { status, body };
        }
        const unmarshal = bodyHasUnmarshalQuirk(body);
        const rateLimited = status === 429;
        // A definitive 4xx answer (other than 429 / the unmarshal quirk) is not a transport failure
        // and is never retried: return it for typed-error mapping.
        if (status >= 400 && status < 500 && !rateLimited && !unmarshal) {
            breaker.recordSuccess();
            return { status, body };
        }
        breaker.recordFailure();
        const retryable = rateLimited || unmarshal || idempotent;
        if (retryable && attempt < maxRetries) {
            const asked = rateLimited ? retryAfterMs(response.headers.get('retry-after')) : undefined;
            // A server asking for a longer pause than we are willing to sit through gets the 429
            // reported instead of a silent multi-minute hang.
            if (asked !== undefined && asked > maxRetryDelayMs)
                return { status, body };
            await sleep(asked ?? backoff(attempt));
            continue;
        }
        if (unmarshal) {
            throw new CoolifyBulkUnmarshalError('Coolify bulk endpoint returned the unmarshal-array quirk after retries');
        }
        return { status, body };
    }
    // Unreachable, but the type system needs a return.
    throw new Error('httpRequest exhausted without resolution');
}
