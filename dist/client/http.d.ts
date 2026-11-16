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
}
export declare const DEFAULT_TIMEOUT_MS = 30000;
export declare function httpRequest(url: string, init: HttpRequestInit, opts: HttpRequestOptions): Promise<HttpResult>;
export {};
