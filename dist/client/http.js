import { CoolifyBulkUnmarshalError } from '../errors/index.js';
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
const UNMARSHAL_RE = /cannot unmarshal array/i;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Parse a response body. Most Coolify endpoints return JSON, but `/version` and `/health` return a
 * bare `text/html` string (e.g. `4.5.0`, `OK`) that is not valid JSON. Fall back to the raw text
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
export async function httpRequest(url, init, opts) {
    const { fetchImpl, breaker, logger } = opts;
    const maxRetries = opts.maxRetries ?? 3;
    const backoffBaseMs = opts.backoffBaseMs ?? 50;
    const sleep = opts.sleep ?? defaultSleep;
    if (!breaker.canRequest()) {
        throw new Error(`Circuit open for ${url}; refusing request`);
    }
    let lastUnmarshal = false;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const headers = { Authorization: `Bearer ${init.token}` };
        let requestInit = { method: init.method, headers };
        if (init.jsonBody !== undefined) {
            headers['content-type'] = 'application/json';
            requestInit = { ...requestInit, body: JSON.stringify(init.jsonBody) };
        }
        logger.debug('coolify.request', {
            url,
            method: init.method,
            attempt,
            bodyFieldCount: init.jsonBody && typeof init.jsonBody === 'object'
                ? Object.keys(init.jsonBody).length
                : 0,
        });
        let response;
        try {
            response = await fetchImpl(url, requestInit);
        }
        catch (err) {
            breaker.recordFailure();
            if (attempt < maxRetries) {
                await sleep(backoffBaseMs * 2 ** attempt);
                continue;
            }
            throw err instanceof Error ? err : new Error(String(err));
        }
        const status = response.status;
        const text = await response.text();
        const body = parseBody(text);
        if (status >= 200 && status < 300) {
            breaker.recordSuccess();
            return { status, body };
        }
        // Terminal 4xx (except 429): no retry, return to caller for typed-error mapping.
        if (status >= 400 && status < 500 && status !== 429) {
            if (!bodyHasUnmarshalQuirk(body)) {
                breaker.recordSuccess(); // a definitive answer from upstream is not a transport failure
                return { status, body };
            }
        }
        breaker.recordFailure();
        lastUnmarshal = bodyHasUnmarshalQuirk(body);
        if (attempt < maxRetries) {
            const retryAfter = response.headers.get('retry-after');
            const waitMs = status === 429 && retryAfter ? Number(retryAfter) * 1000 : backoffBaseMs * 2 ** attempt;
            await sleep(Number.isFinite(waitMs) ? waitMs : backoffBaseMs * 2 ** attempt);
            continue;
        }
        if (lastUnmarshal) {
            throw new CoolifyBulkUnmarshalError('Coolify bulk endpoint returned the unmarshal-array quirk after retries');
        }
        return { status, body };
    }
    // Unreachable, but the type system needs a return.
    throw new Error('httpRequest exhausted without resolution');
}
