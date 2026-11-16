import { CircuitBreaker, httpRequest, type FetchLike, type HttpResult } from './http.js';
import type { Logger } from '../logging/index.js';
import { CoolifyAuthError, CoolifyContractError, CoolifyNotFoundError, CoolifyRequestError } from '../errors/index.js';
import { REDACTED, redactUrlCredentials } from './redact.js';
import { preloadSchemasOnceRequestIsSent } from './lazy-schemas.js';

export interface CoolifyClientDeps {
  fetchImpl: FetchLike;
  logger: Logger;
  breaker?: CircuitBreaker;
  /** Extra attempts for retryable requests (GET, 429, idempotent writes). Default 3. */
  maxRetries?: number;
  /** First retry delay, doubling per attempt. Default 250 ms. */
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt request timeout. Default 30 000 ms; 0 disables it. */
  timeoutMs?: number;
  /** Longest single pause between attempts (also caps a server `Retry-After`). Default 30 000 ms. */
  maxRetryDelayMs?: number;
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

export interface RequestOptions {
  /** Mark a non-GET request as safe to repeat (see HttpRequestInit.idempotent). */
  idempotent?: boolean;
  /**
   * Values sent in this request that must never be echoed back in an error message (env values,
   * compose documents). A server error quoting its input would otherwise reach stderr and the
   * audit log.
   */
  secrets?: readonly string[];
  /** The endpoint answers plain text (`/version`, `/health`): do not read it as JSON. */
  rawText?: boolean;
}

const MAX_SERVER_MESSAGE = 400;
const MAX_SCANNED_MESSAGE = 8000;

/**
 * The strings of a document (compose, proxy configuration) that a server error must not quote
 * back: the document itself, each of its lines, and each assigned value. A parse error typically
 * cites the offending line, which is where the literal secrets are.
 */
export function documentSecrets(document: string): string[] {
  const out = new Set<string>([document]);
  for (const raw of document.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length >= 4) out.add(line);
    // The value after the first `=` or `:` (found by scanning: a pattern with `[^=:]+…\s*[=:]`
    // backtracks over a long run of blanks).
    let sep = -1;
    for (let i = 1; i < line.length; i += 1) {
      const c = line.charAt(i);
      if (c === '=' || c === ':') { sep = i; break; }
    }
    if (sep < 0) continue;
    const value = line.slice(sep + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 4 && !/^(true|false|yes|no|on|off|null|\d+)$/i.test(value)) out.add(value);
  }
  return [...out];
}

/**
 * Make a server-supplied message safe to print and audit: drop anything that repeats a secret we
 * sent, strip credentials inside URLs, collapse whitespace and bound the length.
 */
export function sanitizeServerMessage(message: string, secrets: readonly string[] = []): string {
  // Bounded before it is scanned: the answer is the server's, and may be megabytes of anything.
  let out = message.length > MAX_SCANNED_MESSAGE ? message.slice(0, MAX_SCANNED_MESSAGE) : message;
  // Longest first so a secret that contains another is removed whole.
  for (const secret of [...secrets].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(REDACTED);
  }
  out = redactUrlCredentials(out).replace(/\s+/g, ' ').trim();
  return out.length > MAX_SERVER_MESSAGE ? `${out.slice(0, MAX_SERVER_MESSAGE)}…` : out;
}

function serverMessage(body: unknown, secrets: readonly string[]): { message?: string; fields: string[] } {
  if (!body || typeof body !== 'object') return { fields: [] };
  const b = body as { message?: unknown; errors?: unknown }; // reason: narrowed by the object guard above; fields read defensively
  // Field NAMES come from the server too: scrubbed like its message, and bounded.
  const fields = b.errors && typeof b.errors === 'object'
    ? Object.keys(b.errors).slice(0, 20).map((f) => sanitizeServerMessage(f.slice(0, 120), secrets))
    : [];
  return typeof b.message === 'string' ? { message: sanitizeServerMessage(b.message, secrets), fields } : { fields };
}

/**
 * Shared transport for every Coolify call: bearer auth, retries + circuit breaker (http.ts), and
 * HTTP-status → typed-error mapping. Paths are relative to `${instanceUrl}/api/v1`.
 */
export class CoolifyApi {
  readonly breaker: CircuitBreaker;
  readonly instanceUrl: string;
  constructor(
    instanceUrl: string,
    private readonly token: string,
    readonly deps: CoolifyClientDeps,
  ) {
    // `https://host/` + `/api/v1` would otherwise produce `//api/v1`.
    this.instanceUrl = instanceUrl.replace(/\/+$/, '');
    this.breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  }

  url(path: string): string {
    return `${this.instanceUrl}/api/v1${path}`;
  }

  async request(path: string, method: string, jsonBody?: unknown, opts: RequestOptions = {}): Promise<HttpResult> {
    const fullUrl = this.url(path);
    const d = this.deps;
    // Load the validators while Coolify is answering, not before the request leaves.
    preloadSchemasOnceRequestIsSent();
    const res = await httpRequest(
      fullUrl,
      {
        method,
        token: this.token,
        ...(jsonBody !== undefined ? { jsonBody } : {}),
        ...(opts.idempotent !== undefined ? { idempotent: opts.idempotent } : {}),
        ...(opts.rawText ? { rawText: true } : {}),
      },
      {
        fetchImpl: d.fetchImpl,
        logger: d.logger,
        breaker: this.breaker,
        ...(d.maxRetries !== undefined ? { maxRetries: d.maxRetries } : {}),
        ...(d.backoffBaseMs !== undefined ? { backoffBaseMs: d.backoffBaseMs } : {}),
        ...(d.sleep !== undefined ? { sleep: d.sleep } : {}),
        ...(d.timeoutMs !== undefined ? { timeoutMs: d.timeoutMs } : {}),
        ...(d.maxRetryDelayMs !== undefined ? { maxRetryDelayMs: d.maxRetryDelayMs } : {}),
      },
    );
    // The token itself must never come back in an error message (an echoing proxy, a debug page).
    const secrets = [...(opts.secrets ?? []), this.token, this.token.slice(this.token.indexOf('|') + 1)];
    this.assertOk(res, `${method} ${fullUrl}`, secrets, !/^(GET|HEAD)$/i.test(method));
    return res;
  }

  private assertOk(res: HttpResult, ctx: string, secrets: readonly string[], isWrite: boolean): void {
    if (res.status >= 200 && res.status < 300) return;
    if (res.status < 200) {
      // 1xx, or the status 0 of an opaque answer from an injected fetch: not an answer to rely on.
      throw new CoolifyRequestError(`Coolify request ${ctx} got an unusable answer (status ${res.status})`, { status: res.status });
    }
    if (res.status >= 300 && res.status < 400) {
      let to = '';
      try { to = res.location ? ` to ${new URL(res.location, this.instanceUrl).origin}` : ''; } catch { /* unparseable Location */ }
      throw new CoolifyRequestError(
        `Coolify answered ${ctx} with a redirect (${res.status})${to}. Redirects are not followed: set the instance url in the config to the final address (https, no trailing path).`,
        { status: res.status },
      );
    }
    const { message, fields } = serverMessage(res.body, secrets);
    if (res.status === 401 || res.status === 403) {
      // Coolify says WHY: `Unauthenticated.`, `Missing required permissions: delete`, or that the
      // token is limited to some projects. That sentence is the actionable part.
      throw new CoolifyAuthError(
        `Coolify auth failed (${res.status}) on ${ctx}${message ? ` — ${message}` : ''}`,
        { status: res.status, ...(message !== undefined ? { serverMessage: message } : {}) },
      );
    }
    if (res.status === 404) {
      throw new CoolifyNotFoundError(`Coolify resource not found (404) on ${ctx}${message ? ` — ${message}` : ''}`);
    }
    const detail = [message, fields.length ? `fields: ${fields.join(', ')}` : ''].filter(Boolean).join('; ');
    // A 5xx to a write settles nothing: Coolify may have done part or all of it before failing.
    const unsettled = isWrite && res.status >= 500 ? ' (a 5xx does not say whether the request took effect: check before sending it again)' : '';
    throw new CoolifyRequestError(
      `Coolify request ${ctx} failed with status ${res.status}${detail ? ` — ${detail}` : ''}${unsettled}`,
      { status: res.status, fields },
    );
  }
}

/** `message` of a JSON acknowledgement, read without a schema. */
export function rawMessage(body: unknown): string {
  const m = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined; // reason: narrowed by the object guard; read defensively
  return typeof m === 'string' ? m : '';
}

/**
 * Parse the acknowledgement of a mutation Coolify has ALREADY accepted (2xx). If the body is a
 * JSON object or array that does not match the schema — or the validators cannot be loaded, or the
 * body was lost on the way back — the write still happened: reporting it as a failure would make
 * an agent repeat it (a second deployment, a second delete). So such an acknowledgement is logged
 * and replaced by a best-effort one.
 *
 * A 2xx that is not a JSON object (an HTML login or maintenance page from a proxy, a wrong URL, an
 * empty 200: Coolify always answers its writes with JSON) is NOT an acknowledgement: nothing says
 * Coolify saw the request, so that stays an error. A 204 is, by definition, a success without a
 * body.
 */
export async function ackAfterWrite<T>(
  deps: CoolifyClientDeps, ctx: string, res: Pick<HttpResult, 'status' | 'body' | 'bodyLost'>, parse: () => Promise<T> | T, fallback: () => T,
): Promise<T> {
  if (res.bodyLost || (res.status === 204 && res.body === undefined)) {
    deps.logger.warn(res.bodyLost ? 'coolify.ack.lost' : 'coolify.ack.empty', { ctx });
    return fallback();
  }
  if (res.body === null || typeof res.body !== 'object') {
    const what = res.body === undefined ? 'an empty answer' : 'not a JSON object (a login or maintenance page? a wrong instance url?)';
    throw new CoolifyContractError(
      `Coolify answered ${ctx} with a 2xx that is ${what}. Whether the request was carried out is unknown: check before retrying.`,
      { zodIssues: 'non-JSON body' },
    );
  }
  try {
    return await parse();
  } catch (err) {
    deps.logger.warn('coolify.ack.unrecognised', { ctx, error: err instanceof Error ? err.message : String(err) });
    return fallback();
  }
}
