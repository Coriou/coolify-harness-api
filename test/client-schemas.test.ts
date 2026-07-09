import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EnvVarSchema,
  BulkResponseSchema,
  DeployAckApplicationSchema,
  DeployAckServiceSchema,
  ApplicationSchema,
  DeploymentSchema,
  RuntimeLogsResponseSchema,
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

describe('Application / Deployment / Logs schemas (new observability)', () => {
  it('parses application.json with passthrough of unknown fields', () => {
    const app = ApplicationSchema.parse(fx('application.json'));
    expect(app.uuid).toBe('app-uuid-1234');
    expect(app.name).toBe('pfi-api');
    expect(app.status).toBe('running');
    expect(app.git_commit_sha).toBe('a1b2c3d4e5f6789012345678901234567890abcd');
    // passthrough
    expect((app as any).unknown_passthrough_field).toBe('should be retained');
    expect((app as any).server?.name).toBe('srv-01');
  });

  it('parses runtime-logs.json', () => {
    const logs = RuntimeLogsResponseSchema.parse(fx('runtime-logs.json'));
    expect(typeof logs.logs).toBe('string');
    expect(logs.logs).toContain('Listening on');
  });

  it('parses a single deployment.json', () => {
    const d = DeploymentSchema.parse(fx('deployment.json'));
    expect(d.deployment_uuid).toBe('deploy-uuid-9876');
    expect(d.status).toBe('finished');
    expect(d.logs).toContain('build complete');
  });

  it('parses deployments list (array form) and tolerates logs: null + passthrough', () => {
    const list = fx('deployments-for-app.json') as unknown[];
    const parsed = list.map((item) => DeploymentSchema.parse(item));
    expect(parsed).toHaveLength(3);
    expect(parsed[0].status).toBe('finished');
    expect(parsed[1].status).toBe('in_progress');
    const failed = parsed[2];
    expect(failed.status).toBe('failed');
    expect(failed.logs).toBeNull();
    expect((failed as any).passthrough_extra).toBe('present on failed too');
  });

  it('rejects invalid deployment status', () => {
    expect(() => DeploymentSchema.parse({ deployment_uuid: 'x', status: 'weird' })).toThrow();
  });
});
