import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EnvVarSchema,
  BulkResponseSchema,
  DeployAckApplicationSchema,
  DeployAckServiceSchema,
  parseOrContractError,
} from '../src/client/schemas.js';
import { CoolifyContractError } from '../src/errors/index.js';

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/${name}`, import.meta.url)), 'utf8'));

describe('coolify schemas', () => {
  it('parses an env-list item including an extra comment field (passthrough)', () => {
    const list = fx('envs-list.json') as unknown[];
    const item = EnvVarSchema.parse(list[0]);
    expect(item.key).toBe('NODE_ENV');
    expect(item.is_build_time).toBe(false);
  });

  it('parses the application deploy ack with deployment_uuid', () => {
    const ack = DeployAckApplicationSchema.parse(fx('deploy-ack-application.json'));
    expect(ack.deployment_uuid).toBe('deploy-123');
  });

  it('parses the service deploy ack without deployment_uuid', () => {
    const ack = DeployAckServiceSchema.parse(fx('deploy-ack-service.json'));
    expect('deployment_uuid' in ack).toBe(false);
  });

  it('parseOrContractError throws CoolifyContractError on shape mismatch', () => {
    expect(() => parseOrContractError(BulkResponseSchema, { not: 'an array' }, 'bulk')).toThrow(
      CoolifyContractError,
    );
  });
});
