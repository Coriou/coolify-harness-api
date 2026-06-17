import type { ResolvedTarget } from '../config/schema.js';
import { CircuitBreaker, type FetchLike } from './http.js';
import type { Logger } from '../logging/index.js';
import { type DeployAck, type EnvVar, type EnvWriteItem } from './schemas.js';
export interface CoolifyClientDeps {
    fetchImpl: FetchLike;
    logger: Logger;
    breaker?: CircuitBreaker;
    maxRetries?: number;
    backoffBaseMs?: number;
    sleep?: (ms: number) => Promise<void>;
}
export declare class CoolifyClient {
    private readonly target;
    private readonly deps;
    private readonly breaker;
    constructor(target: ResolvedTarget, deps: CoolifyClientDeps);
    private base;
    private request;
    private assertOk;
    listEnvs(): Promise<EnvVar[]>;
    upsertEnvs(items: EnvWriteItem[]): Promise<EnvVar[]>;
    deploy(): Promise<DeployAck>;
    restart(): Promise<DeployAck>;
    private ackFor;
}
