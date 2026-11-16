import { CoolifyAuthError, CoolifyBulkUnmarshalError, CoolifyNetworkError } from '../errors/index.js';
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
/** Failures that happen before a request can leave: nothing reached Coolify. */
const NOT_SENT = /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EHOSTDOWN|UND_ERR_CONNECT_TIMEOUT|ERR_INVALID_URL|ERR_TLS_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/;
const MAYBE_PROCESSED = ' The request may have reached Coolify: check what it did before sending it again.';
function networkError(url, method, err, timeoutMs, token, attempts, isRead) {
    const origin = originOf(url);
    if (isTimeout(err)) {
        return new CoolifyNetworkError(`Coolify did not answer ${method} ${url} within ${Math.round(timeoutMs / 1000)}s${attempts > 1 ? ` (tried ${attempts} times)` : ''}.${isRead ? '' : MAYBE_PROCESSED}`, { reason: 'timeout', ...(isRead ? {} : { outcomeUnknown: true }) });
    }
    const code = causeCode(err);
    // A write whose connection broke AFTER it could have been sent is not "nothing happened".
    const unknown = !isRead && !NOT_SENT.test(code ?? '');
    // The runtime's own message may quote what it was given (an invalid header value is the token).
    const raw = err instanceof Error ? err.message : String(err);
    const detail = (token.length >= 4 ? raw.split(token).join('[REDACTED]') : raw).slice(0, 300);
    return new CoolifyNetworkError(`Cannot reach Coolify at ${origin} (${method}): ${code ? `${code} — ` : ''}${detail}${unknown ? `.${MAYBE_PROCESSED}` : ''}`, { reason: code ?? 'network', ...(unknown ? { outcomeUnknown: true } : {}) });
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
    const isRead = /^(GET|HEAD)$/i.test(init.method);
    const idempotent = init.idempotent ?? isRead;
    const backoff = (attempt) => Math.min(maxRetryDelayMs, backoffBaseMs * 2 ** attempt);
    // A token with whitespace or control characters (a pasted newline, a quote left in a .env) cannot
    // be sent as a header. Say so here, without ever echoing it: the runtime's error would quote it.
    if (!/^[\x21-\x7e]+$/.test(init.token)) {
        throw new CoolifyAuthError('The API token contains whitespace or non-printable characters and cannot be sent. Check the env var that holds it (stray quotes or a line break?).');
    }
    if (!breaker.canRequest()) {
        throw new CoolifyNetworkError(`Circuit open for ${originOf(url)} after repeated failures; refusing ${init.method} ${url}`, { reason: 'circuit-open' });
    }
    let timeouts = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const headers = {
            Authorization: `Bearer ${init.token}`,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        };
        // Redirects are never followed: a redirect to another origin would carry the request body
        // there, and one to https drops the Authorization header and fails confusingly. The instance
        // URL in the config must be the final one.
        let requestInit = { method: init.method, headers, redirect: 'manual' };
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
            // …except for a write Coolify already answered 2xx: it was carried out, only the
            // acknowledgement is lost. Reporting a network error would get the mutation repeated. (A
            // write that may be replayed is replayed first; a read without its body is no answer.)
            const answered2xx = response !== undefined && response.status >= 200 && response.status < 300;
            if (answered2xx && !isRead && (!idempotent || attempt >= maxRetries)) {
                breaker.recordSuccess();
                return { status: response.status, body: undefined, bodyLost: true }; // reason: answered2xx implies response is defined
            }
            breaker.recordFailure();
            // A server that accepts the connection and never answers is retried ONCE: four silent
            // 30 s attempts outlast the two-minute timeout of the agent that is waiting for this.
            if (isTimeout(err))
                timeouts += 1;
            if (idempotent && attempt < maxRetries && timeouts < 2) {
                await sleep(backoff(attempt));
                continue;
            }
            throw networkError(url, init.method, err, timeoutMs, init.token, attempt + 1, isRead);
        }
        const status = response.status;
        const body = init.rawText ? text : parseBody(text);
        if (status >= 300 && status < 400) {
            breaker.recordSuccess();
            const location = response.headers.get('location');
            return location === null ? { status, body } : { status, body, location };
        }
        if (status >= 200 && status < 300) {
            breaker.recordSuccess();
            return { status, body };
        }
        // The unmarshal quirk belongs to the (idempotent) bulk env write: a read, or a write that must
        // not be replayed, that happens to carry that text is an ordinary answer.
        const unmarshal = idempotent && !isRead && bodyHasUnmarshalQuirk(body);
        const rateLimited = status === 429;
        // A definitive 4xx answer (other than 429 / the unmarshal quirk) is not a transport failure
        // and is never retried: return it for typed-error mapping.
        if (status >= 400 && status < 500 && !rateLimited && !unmarshal) {
            breaker.recordSuccess();
            return { status, body };
        }
        breaker.recordFailure();
        const retryable = rateLimited || idempotent;
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
