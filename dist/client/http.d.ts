import type { Logger } from '../logging/index.js';
export interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeoutMs: number;
    now?: () => number;
}
type BreakerState = 'closed' | 'open' | 'half-open';
export declare class CircuitBreaker {
    private readonly opts;
    private failures;
    private openedAt;
    private internalState;
    private readonly now;
    constructor(opts: CircuitBreakerOptions);
    get state(): BreakerState;
    canRequest(): boolean;
    recordSuccess(): void;
    recordFailure(): void;
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
export declare function httpRequest(url: string, init: {
    method: string;
    token: string;
    jsonBody?: unknown;
}, opts: HttpRequestOptions): Promise<HttpResult>;
export {};
