import { CoolifyAuthError, CoolifyBulkUnmarshalError, CoolifyNetworkError } from '../errors/index.js';
import type { Logger } from '../logging/index.js';
import { HARNESS_VERSION } from '../version.js';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  now?: () => number;
}

type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private internalState: BreakerState = 'closed';
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? ((): number => Date.now());
  }

  get state(): BreakerState {
    return this.internalState;
  }

  canRequest(): boolean {
    if (this.internalState === 'open') {
      if (this.now() - this.openedAt >= this.opts.resetTimeoutMs) {
        this.internalState = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.internalState = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.internalState === 'half-open' || this.failures >= this.opts.failureThreshold) {
      this.internalState = 'open';
      this.openedAt = this.now();
    }
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpRequestOptions {
  fetchImpl: FetchLike;
  breaker: CircuitBreaker;
  logger: Logger;
  /** Extra attempts after the first one, for requests that may be retried. Default 3. */
  maxRetries?: number;
  /** First backoff delay; doubles per attempt. Default 250 ms. */
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt timeout. Default 30 s. 0 disables it. */
  timeoutMs?: number;
  /** Longest single wait between attempts, including a server `Retry-After`. Default 30 s. */
  maxRetryDelayMs?: number;
}

export interface HttpRequestInit {
  method: string;
  token: string;
  jsonBody?: unknown;
  /**
   * Whether repeating the request is harmless. Default: only GET / HEAD. A network error, a
   * timeout or a 5xx is retried ONLY for idempotent requests: the server may have processed a
   * mutation whose answer was lost, and replaying `POST …/start` would queue a second deployment.
   * A 429 (rate limited, not processed) and Coolify's bulk-unmarshal quirk are retried for every
   * method.
   */
  idempotent?: boolean;
}

export interface HttpResult {
  status: number;
  body: unknown;
  /** `Location` of a 3xx answer. Redirects are never followed (see httpRequest). */
  location?: string;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const USER_AGENT = `coolify-harness/${HARNESS_VERSION}`;
const UNMARSHAL_RE = /cannot unmarshal array/i;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Parse a response body. Most Coolify endpoints return JSON, but `/version` and `/health` return a
 * bare `text/html` string (e.g. `4.7.5`, `OK`) that is not valid JSON. Fall back to the raw text
 * rather than letting `JSON.parse` throw a SyntaxError out of the transport layer.
 */
function parseBody(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function bodyHasUnmarshalQuirk(body: unknown): boolean {
  if (body && typeof body === 'object' && 'message' in body) {
    const msg = (body as { message: unknown }).message; // reason: narrowed by the 'message' in body guard above
    return typeof msg === 'string' && UNMARSHAL_RE.test(msg);
  }
  return false;
}

/** `scheme://host[:port]` of a URL, for messages (the path may be long; the origin is what failed). */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** The system error code behind a failed `fetch` (`ENOTFOUND`, `ECONNREFUSED`, `UND_ERR_…`), if any. */
function causeCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth += 1) {
    const code = (cur as { code?: unknown }).code; // reason: probing the optional `code` of an unknown error
    if (typeof code === 'string') return code;
    cur = (cur as { cause?: unknown }).cause; // reason: walking the optional `cause` chain of an unknown error
  }
  return undefined;
}

function isTimeout(err: unknown): boolean {
  const name = err && typeof err === 'object' ? (err as { name?: unknown }).name : undefined; // reason: probing the optional `name` of an unknown error
  return name === 'TimeoutError' || name === 'AbortError';
}

function networkError(url: string, method: string, err: unknown, timeoutMs: number, token: string): CoolifyNetworkError {
  const origin = originOf(url);
  if (isTimeout(err)) {
    return new CoolifyNetworkError(
      `Coolify did not answer ${method} ${url} within ${Math.round(timeoutMs / 1000)}s`,
      { reason: 'timeout' },
    );
  }
  const code = causeCode(err);
  // The runtime's own message may quote what it was given (an invalid header value is the token).
  const raw = err instanceof Error ? err.message : String(err);
  const detail = (token.length >= 4 ? raw.split(token).join('[REDACTED]') : raw).slice(0, 300);
  return new CoolifyNetworkError(
    `Cannot reach Coolify at ${origin} (${method}): ${code ? `${code} — ` : ''}${detail}`,
    { reason: code ?? 'network' },
  );
}

/** Seconds form only (`Retry-After: 2`); an HTTP-date or garbage yields undefined. */
function retryAfterMs(header: string | null): number | undefined {
  if (header === null || !/^\d+(\.\d+)?$/.test(header.trim())) return undefined;
  return Number(header) * 1000;
}

export async function httpRequest(
  url: string,
  init: HttpRequestInit,
  opts: HttpRequestOptions,
): Promise<HttpResult> {
  const { fetchImpl, breaker, logger } = opts;
  const maxRetries = opts.maxRetries ?? 3;
  const backoffBaseMs = opts.backoffBaseMs ?? 250;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetryDelayMs = opts.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const idempotent = init.idempotent ?? /^(GET|HEAD)$/i.test(init.method);
  const backoff = (attempt: number): number => Math.min(maxRetryDelayMs, backoffBaseMs * 2 ** attempt);

  // A token with whitespace or control characters (a pasted newline, a quote left in a .env) cannot
  // be sent as a header. Say so here, without ever echoing it: the runtime's error would quote it.
  if (!/^[\x21-\x7e]+$/.test(init.token)) {
    throw new CoolifyAuthError(
      'The API token contains whitespace or non-printable characters and cannot be sent. Check the env var that holds it (stray quotes or a line break?).',
    );
  }

  if (!breaker.canRequest()) {
    throw new CoolifyNetworkError(
      `Circuit open for ${originOf(url)} after repeated failures; refusing ${init.method} ${url}`,
      { reason: 'circuit-open' },
    );
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${init.token}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };
    // Redirects are never followed: a redirect to another origin would carry the request body
    // there, and one to https drops the Authorization header and fails confusingly. The instance
    // URL in the config must be the final one.
    let requestInit: RequestInit = { method: init.method, headers, redirect: 'manual' };
    if (init.jsonBody !== undefined) {
      headers['content-type'] = 'application/json';
      requestInit = { ...requestInit, body: JSON.stringify(init.jsonBody) };
    }
    if (timeoutMs > 0) requestInit = { ...requestInit, signal: AbortSignal.timeout(timeoutMs) };
    logger.debug('coolify.request', {
      url,
      method: init.method,
      attempt,
      bodyFieldCount: init.jsonBody && typeof init.jsonBody === 'object'
        ? Object.keys(init.jsonBody).length
        : 0,
    });

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(url, requestInit);
      // Reading the body is part of the attempt: a connection dropped mid-body is a network error.
      text = await response.text();
    } catch (err) {
      breaker.recordFailure();
      if (idempotent && attempt < maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw networkError(url, init.method, err, timeoutMs, init.token);
    }

    const status = response.status;
    const body = parseBody(text);

    if (status >= 300 && status < 400) {
      breaker.recordSuccess();
      const location = response.headers.get('location');
      return location === null ? { status, body } : { status, body, location };
    }

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
      if (asked !== undefined && asked > maxRetryDelayMs) return { status, body };
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
