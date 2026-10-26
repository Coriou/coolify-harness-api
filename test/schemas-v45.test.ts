import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ApplicationSchema,
  DeploymentSchema,
  ServiceSchema,
  ServerSchema,
  ServerProxySchema,
  ServerResourceSchema,
  DatabaseSchema,
  EnvVarSchema,
  isTerminalDeploymentStatus,
  parseOrContractError,
} from '../src/client/schemas.js';

// Fixtures under v4.5/ were recorded from live Coolify 4.5.0 instances (read-only GETs) and then
// sanitized: every key, JSON type and null is kept as Coolify sent it; string values are replaced.
const fx = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/v4.5/${name}`, import.meta.url)), 'utf8'));

describe('Coolify 4.5.0 recorded payloads', () => {
  // Regression: `status` failed contract validation since 4.3.16 because apps send
  // `git_full_url: null` and `health_check_port: null`, which `.optional()` rejected.
  it('parses a real application payload with null git_full_url / health_check_port', () => {
    const raw = fx('application.json') as Record<string, unknown>;
    expect(raw['git_full_url']).toBeNull();
    expect(raw['health_check_port']).toBeNull();
    const app = parseOrContractError(ApplicationSchema, raw, 'get');
    expect(app.uuid).toBe('app-1');
    expect(app.git_full_url).toBeNull();
  });

  // Regression: `deploy --wait` / `deployment <uuid>` failed on in-flight deployments because a
  // queued row has commit_message / finished_at / server_name ... = null.
  it('parses a queued deployment whose nullable columns are all null', () => {
    const d = parseOrContractError(DeploymentSchema, fx('deployment-queued.json'), 'getDeployment');
    expect(d.status).toBe('queued');
    expect(d.commit_message).toBeNull();
    expect(d.finished_at).toBeNull();
    expect(isTerminalDeploymentStatus(d.status)).toBe(false);
  });

  it('parses a finished deployment (with its embedded application object)', () => {
    const d = parseOrContractError(DeploymentSchema, fx('deployment.json'), 'getDeployment');
    expect(d.status).toBe('finished');
    expect(isTerminalDeploymentStatus(d.status)).toBe(true);
  });

  it('parses the wrapped { count, deployments } list items', () => {
    const body = fx('deployments-for-app.json') as { count: number; deployments: unknown[] };
    const list = body.deployments.map((x) => DeploymentSchema.parse(x));
    expect(body.count).toBeGreaterThan(0);
    expect(list[0]!.deployment_uuid).toBe('dep-finished-1');
  });

  it('parses service, servers, server, proxy, resources and databases payloads', () => {
    const svc = ServiceSchema.parse(fx('service.json'));
    expect(svc.applications?.[0]?.name).toBe('umami');
    expect(svc.docker_compose_raw).toContain('image: ghcr.io/umami-software/umami:3.0.3');
    expect(z.array(ServerSchema).parse(fx('servers.json'))[0]!.uuid).toBe('srv-1');
    expect(ServerSchema.parse(fx('server.json')).name).toBe('localhost');
    const proxy = ServerProxySchema.parse(fx('server-proxy.json'));
    expect(proxy.proxy_type).toBe('TRAEFIK');
    expect(proxy.configuration).toContain("image: 'traefik:v3.6'");
    expect(z.array(ServerResourceSchema).parse(fx('server-resources.json')).length).toBeGreaterThan(0);
    expect(DatabaseSchema.parse(fx('database.json')).is_public).toBe(false);
    expect(z.array(DatabaseSchema).parse(fx('databases.json'))[0]!.uuid).toBe('db-1');
  });

  it('parses 4.5 env rows (is_buildtime, is_runtime, comment: null, real_value)', () => {
    const raw = fx('service-envs.json') as Array<{ is_buildtime: boolean }>;
    const rows = raw.map((r) => EnvVarSchema.parse(r));
    expect(rows[0]!.is_build_time).toBe(raw[0]!.is_buildtime);
  });
});
