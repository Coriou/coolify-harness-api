import { CoolifyBulkUnmarshalError } from '../errors/index.js';
import type { Logger } from '../logging/index.js';

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
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

const UNMARSHAL_RE = /cannot unmarshal array/i;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Parse a response body. Most Coolify endpoints return JSON, but `/version` and `/health` return a
 * bare `text/html` string (e.g. `4.5.0`, `OK`) that is not valid JSON. Fall back to the raw text
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

export async function httpRequest(
  url: string,
  init: { method: string; token: string; jsonBody?: unknown },
  opts: HttpRequestOptions,
): Promise<HttpResult> {
  const { fetchImpl, breaker, logger } = opts;
  const maxRetries = opts.maxRetries ?? 3;
  const backoffBaseMs = opts.backoffBaseMs ?? 50;
  const sleep = opts.sleep ?? defaultSleep;

  if (!breaker.canRequest()) {
    throw new Error(`Circuit open for ${url}; refusing request`);
  }

  let lastUnmarshal = false;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` };
    let requestInit: RequestInit = { method: init.method, headers };
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

    let response: Response;
    try {
      response = await fetchImpl(url, requestInit);
    } catch (err) {
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
      const waitMs =
        status === 429 && retryAfter ? Number(retryAfter) * 1000 : backoffBaseMs * 2 ** attempt;
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
