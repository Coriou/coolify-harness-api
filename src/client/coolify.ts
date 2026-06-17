import type { ResolvedTarget } from '../config/schema.js';
import { CircuitBreaker, httpRequest, type FetchLike, type HttpResult } from './http.js';
import type { Logger } from '../logging/index.js';
import {
  BulkResponseSchema,
  DeployAckApplicationSchema,
  DeployAckServiceSchema,
  EnvVarSchema,
  parseOrContractError,
  type DeployAck,
  type EnvVar,
  type EnvWriteItem,
} from './schemas.js';
import { CoolifyAuthError, CoolifyNotFoundError } from '../errors/index.js';
import { z } from 'zod';

export interface CoolifyClientDeps {
  fetchImpl: FetchLike;
  logger: Logger;
  breaker?: CircuitBreaker;
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class CoolifyClient {
  private readonly breaker: CircuitBreaker;
  constructor(
    private readonly target: ResolvedTarget,
    private readonly deps: CoolifyClientDeps,
  ) {
    this.breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  }

  private base(): string {
    const family = this.target.kind === 'application' ? 'applications' : 'services';
    return `${this.target.instanceUrl}/api/v1/${family}/${this.target.uuid}`;
  }

  private async request(path: string, method: string, jsonBody?: unknown): Promise<HttpResult> {
    const res = await httpRequest(
      `${this.base()}${path}`,
      jsonBody === undefined
        ? { method, token: this.target.token }
        : { method, token: this.target.token, jsonBody },
      {
        fetchImpl: this.deps.fetchImpl,
        logger: this.deps.logger,
        breaker: this.breaker,
        ...(this.deps.maxRetries !== undefined ? { maxRetries: this.deps.maxRetries } : {}),
        ...(this.deps.backoffBaseMs !== undefined ? { backoffBaseMs: this.deps.backoffBaseMs } : {}),
        ...(this.deps.sleep !== undefined ? { sleep: this.deps.sleep } : {}),
      },
    );
    this.assertOk(res, path);
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
      throw new Error(`Coolify request to ${ctx} failed with status ${res.status}`);
    }
  }

  async listEnvs(): Promise<EnvVar[]> {
    const res = await this.request('/envs', 'GET');
    return parseOrContractError(BulkResponseSchema, res.body, 'listEnvs');
  }

  async upsertEnvs(items: EnvWriteItem[]): Promise<EnvVar[]> {
    const res = await this.request('/envs/bulk', 'PATCH', { data: items });
    return parseOrContractError(BulkResponseSchema, res.body, 'upsertEnvs');
  }

  async deploy(): Promise<DeployAck> {
    return this.ackFor(await this.request('/start', 'POST'), 'deploy');
  }

  async restart(): Promise<DeployAck> {
    return this.ackFor(await this.request('/restart', 'POST'), 'restart');
  }

  private ackFor(res: HttpResult, ctx: string): DeployAck {
    if (this.target.kind === 'application') {
      const parsed = parseOrContractError(DeployAckApplicationSchema, res.body, ctx) as z.infer<
        typeof DeployAckApplicationSchema
      >; // reason: parseOrContractError is not generic; explicitly cast to the known schema output type
      return parsed.deployment_uuid === undefined
        ? { message: parsed.message }
        : { message: parsed.message, deploymentUuid: parsed.deployment_uuid };
    }
    const parsed = parseOrContractError(DeployAckServiceSchema, res.body, ctx);
    return { message: parsed.message };
  }
}
