import { CircuitBreaker, httpRequest, type FetchLike, type HttpResult } from './http.js';
import type { Logger } from '../logging/index.js';
import { CoolifyAuthError, CoolifyNotFoundError, CoolifyRequestError } from '../errors/index.js';

export interface CoolifyClientDeps {
  fetchImpl: FetchLike;
  logger: Logger;
  breaker?: CircuitBreaker;
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type Query = Record<string, string | number | boolean | undefined>;

export function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function serverMessage(body: unknown): { message?: string; fields: string[] } {
  if (!body || typeof body !== 'object') return { fields: [] };
  const b = body as { message?: unknown; errors?: unknown }; // reason: narrowed by the object guard above; fields read defensively
  const fields = b.errors && typeof b.errors === 'object' ? Object.keys(b.errors) : [];
  return typeof b.message === 'string' ? { message: b.message, fields } : { fields };
}

/**
 * Shared transport for every Coolify call: bearer auth, retries + circuit breaker (http.ts), and
 * HTTP-status → typed-error mapping. Paths are relative to `${instanceUrl}/api/v1`.
 */
export class CoolifyApi {
  readonly breaker: CircuitBreaker;
  constructor(
    readonly instanceUrl: string,
    private readonly token: string,
    readonly deps: CoolifyClientDeps,
  ) {
    this.breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  }

  url(path: string): string {
    return `${this.instanceUrl}/api/v1${path}`;
  }

  async request(path: string, method: string, jsonBody?: unknown): Promise<HttpResult> {
    const fullUrl = this.url(path);
    const res = await httpRequest(
      fullUrl,
      jsonBody === undefined ? { method, token: this.token } : { method, token: this.token, jsonBody },
      {
        fetchImpl: this.deps.fetchImpl,
        logger: this.deps.logger,
        breaker: this.breaker,
        ...(this.deps.maxRetries !== undefined ? { maxRetries: this.deps.maxRetries } : {}),
        ...(this.deps.backoffBaseMs !== undefined ? { backoffBaseMs: this.deps.backoffBaseMs } : {}),
        ...(this.deps.sleep !== undefined ? { sleep: this.deps.sleep } : {}),
      },
    );
    this.assertOk(res, `${method} ${fullUrl}`);
    return res;
  }

  private assertOk(res: HttpResult, ctx: string): void {
    if (res.status === 401 || res.status === 403) {
      throw new CoolifyAuthError(`Coolify auth failed (${res.status}) on ${ctx}`, { status: res.status });
    }
    if (res.status === 404) {
      throw new CoolifyNotFoundError(`Coolify resource not found (404) on ${ctx}`);
    }
    if (res.status >= 400) {
      const { message, fields } = serverMessage(res.body);
      const detail = [message, fields.length ? `fields: ${fields.join(', ')}` : ''].filter(Boolean).join('; ');
      throw new CoolifyRequestError(
        `Coolify request ${ctx} failed with status ${res.status}${detail ? ` — ${detail}` : ''}`,
        { status: res.status, fields },
      );
    }
  }
}
