import { CircuitBreaker, type FetchLike, type HttpResult } from './http.js';
import type { Logger } from '../logging/index.js';
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
export declare function withQuery(path: string, query?: Query): string;
export interface RequestOptions {
    /** Mark a non-GET request as safe to repeat (see HttpRequestInit.idempotent). */
    idempotent?: boolean;
    /**
     * Values sent in this request that must never be echoed back in an error message (env values,
     * compose documents). A server error quoting its input would otherwise reach stderr and the
     * audit log.
     */
    secrets?: readonly string[];
}
/**
 * Make a server-supplied message safe to print and audit: drop anything that repeats a secret we
 * sent, strip credentials inside URLs, collapse whitespace and bound the length.
 */
export declare function sanitizeServerMessage(message: string, secrets?: readonly string[]): string;
/**
 * Shared transport for every Coolify call: bearer auth, retries + circuit breaker (http.ts), and
 * HTTP-status → typed-error mapping. Paths are relative to `${instanceUrl}/api/v1`.
 */
export declare class CoolifyApi {
    private readonly token;
    readonly deps: CoolifyClientDeps;
    readonly breaker: CircuitBreaker;
    readonly instanceUrl: string;
    constructor(instanceUrl: string, token: string, deps: CoolifyClientDeps);
    url(path: string): string;
    request(path: string, method: string, jsonBody?: unknown, opts?: RequestOptions): Promise<HttpResult>;
    private assertOk;
}
