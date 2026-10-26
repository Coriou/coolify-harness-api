import { CircuitBreaker, type FetchLike, type HttpResult } from './http.js';
import type { Logger } from '../logging/index.js';
export interface CoolifyClientDeps {
    fetchImpl: FetchLike;
    logger: Logger;
    breaker?: CircuitBreaker;
    maxRetries?: number;
    backoffBaseMs?: number;
    sleep?: (ms: number) => Promise<void>;
}
export type Query = Record<string, string | number | boolean | undefined>;
export declare function withQuery(path: string, query?: Query): string;
/**
 * Shared transport for every Coolify call: bearer auth, retries + circuit breaker (http.ts), and
 * HTTP-status → typed-error mapping. Paths are relative to `${instanceUrl}/api/v1`.
 */
export declare class CoolifyApi {
    readonly instanceUrl: string;
    private readonly token;
    readonly deps: CoolifyClientDeps;
    readonly breaker: CircuitBreaker;
    constructor(instanceUrl: string, token: string, deps: CoolifyClientDeps);
    url(path: string): string;
    request(path: string, method: string, jsonBody?: unknown): Promise<HttpResult>;
    private assertOk;
}
