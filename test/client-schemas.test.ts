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

  // Bug 1 (read): Coolify >=4.0.0-beta.463 renamed the response field is_build_time -> is_buildtime
  // (and added is_runtime). Accept either spelling and normalize onto the canonical is_build_time so
  // downstream code (safe-write, CLI) only reasons about one field name.
  it('parses a newer (>=beta.463) env item that uses is_buildtime instead of is_build_time', () => {
    const list = fx('envs-list-newer-buildtime.json') as unknown[];
    const item = EnvVarSchema.parse(list[0]);
    expect(item.key).toBe('NODE_ENV');
    // normalized onto the canonical field so downstream has one shape
    expect(item.is_build_time).toBe(true);
    // the raw newer field is preserved via passthrough, never silently dropped
    expect((item as { is_buildtime?: boolean }).is_buildtime).toBe(true);
    // the newly-added is_runtime field is tolerated (passthrough)
    expect((item as { is_runtime?: boolean }).is_runtime).toBe(true);
  });

  it('normalizes a MIXED list where one item is old-style and one is new-style', () => {
    const oldStyle = { uuid: 'e1', key: 'A', value: '1', is_preview: false, is_build_time: true,
      is_literal: false, is_multiline: false, is_shown_once: false };
    const newStyle = { uuid: 'e2', key: 'B', value: '2', is_preview: false, is_buildtime: false,
      is_literal: false, is_multiline: false, is_shown_once: false };
    const [a, b] = BulkResponseSchema.parse([oldStyle, newStyle]);
    expect(a!.is_build_time).toBe(true);
    expect(b!.is_build_time).toBe(false);
  });

  it('prefers is_build_time when a server sends BOTH fields', () => {
    const item = EnvVarSchema.parse({
      uuid: 'e', key: 'K', value: 'v', is_preview: false,
      is_build_time: true, is_buildtime: false,
      is_literal: false, is_multiline: false, is_shown_once: false,
    });
    expect(item.is_build_time).toBe(true);
  });

  it('defaults is_build_time to false when neither field is present', () => {
    const item = EnvVarSchema.parse({
      uuid: 'e', key: 'K', value: 'v', is_preview: false,
      is_literal: false, is_multiline: false, is_shown_once: false,
    });
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
    expect(app.name).toBe('my-api');
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
