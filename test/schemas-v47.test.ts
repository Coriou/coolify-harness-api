import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ApplicationSchema, BulkResponseSchema, DatabaseSchema, DeploymentSchema, RuntimeLogsResponseSchema,
  ServerDomainsSchema, ServerProxySchema, ServerResourceSchema, ServerSchema, ServiceSchema,
  isTerminalDeploymentStatus, parseOrContractError,
} from '../src/client/schemas.js';
import { CoolifyContractError } from '../src/errors/index.js';
import { redactDeep } from '../src/client/redact.js';

// Fixtures under v4.7/ were recorded from a live Coolify 4.7.5 instance (read-only GETs) and
// sanitised: keys, JSON types and nulls are Coolify's; every string is synthetic. See its README.
const dir = fileURLToPath(new URL('./fixtures/coolify/v4.7/', import.meta.url));
const fx = (name: string): unknown => JSON.parse(readFileSync(`${dir}${name}`, 'utf8'));

describe('Coolify 4.7.5 recorded payloads', () => {
  it('every fixture file is covered by a schema below', () => {
    expect(readdirSync(dir).filter((f) => f.endsWith('.json')).sort()).toEqual([
      'application-envs.json', 'application.json', 'database-envs.json', 'database.json', 'databases.json',
      'deployment-queued.json', 'deployment.json', 'deployments-for-app.json', 'deployments-running.json',
      'envs-compose-blank.json', 'envs-locked.json', 'runtime-logs.json', 'server-domains.json', 'server-proxy.json',
      'server-resources.json', 'server.json', 'servers.json', 'service-envs.json', 'service.json',
    ]);
  });

  it('parses the application, service, database and server payloads', () => {
    expect(parseOrContractError(ApplicationSchema, fx('application.json'), 'get').uuid).toBe('app-1');
    const svc = parseOrContractError(ServiceSchema, fx('service.json'), 'getService');
    expect(svc.applications?.[0]?.name).toBe('umami');
    expect(svc.databases?.[0]?.name).toBe('postgresql');
    expect(parseOrContractError(DatabaseSchema, fx('database.json'), 'getDatabase').is_public).toBe(false);
    expect(parseOrContractError(z.array(DatabaseSchema), fx('databases.json'), 'listDatabases')[0]!.uuid).toBe('db-1');
    expect(parseOrContractError(z.array(ServerSchema), fx('servers.json'), 'listServers')[0]!.uuid).toBe('srv-1');
    expect(parseOrContractError(ServerSchema, fx('server.json'), 'getServer').name).toBe('localhost');
    expect(parseOrContractError(z.array(ServerResourceSchema), fx('server-resources.json'), 'resources').length).toBeGreaterThan(0);
    expect(parseOrContractError(ServerDomainsSchema, fx('server-domains.json'), 'domains')[0]!.domains[0]).toBe('app.example.com');
  });

  it('parses the proxy payload, including the proxy_error_page field added in 4.7', () => {
    const raw = fx('server-proxy.json') as Record<string, unknown>;
    expect('proxy_error_page' in raw).toBe(true);
    const proxy = parseOrContractError(ServerProxySchema, raw, 'getServerProxy');
    expect(proxy.proxy_type).toBe('TRAEFIK');
    expect(proxy.configuration).toContain("image: 'traefik:v3.6'");
  });

  it('parses deployments: the wrapped list, a finished row (is_mcp is new in 4.7) and a queued one', () => {
    const list = fx('deployments-for-app.json') as { count: number; deployments: Array<Record<string, unknown>> };
    expect(list.count).toBeGreaterThan(0);
    expect('is_mcp' in list.deployments[0]!).toBe(true);
    expect(list.deployments.map((d) => parseOrContractError(DeploymentSchema, d, 'list').deployment_uuid)[0]).toBe('dep-finished-1');
    const one = parseOrContractError(DeploymentSchema, fx('deployment.json'), 'getDeployment');
    expect(isTerminalDeploymentStatus(one.status)).toBe(true);
    const queued = parseOrContractError(DeploymentSchema, fx('deployment-queued.json'), 'getDeployment');
    expect([queued.status, queued.commit_message, queued.finished_at]).toEqual(['queued', null, null]);
    expect(parseOrContractError(z.array(DeploymentSchema), fx('deployments-running.json'), 'running')).toEqual([]);
  });

  it('parses env rows of all three resource kinds, with null values and null order', () => {
    const app = parseOrContractError(BulkResponseSchema, fx('application-envs.json'), 'listEnvs');
    expect(app.filter((r) => r.value_null).map((r) => r.key)).toEqual(['BLANK_FLAG', 'MODEL_PATH']);
    expect(app.every((r) => !r.value_hidden)).toBe(true);
    expect(parseOrContractError(BulkResponseSchema, fx('service-envs.json'), 'listEnvs')).toHaveLength(3);
    expect(parseOrContractError(BulkResponseSchema, fx('database-envs.json'), 'listEnvs')).toHaveLength(2);
  });

  it('reads a locked (shown-once) row as hidden, not null — Coolify omits its value for every token', () => {
    const rows = parseOrContractError(BulkResponseSchema, fx('envs-locked.json'), 'listEnvs');
    const locked = rows.find((r) => r.key === 'STRIPE_SECRET')!;
    expect([locked.value_hidden, locked.value_null, locked.is_shown_once, locked.value]).toEqual([true, false, true, '']);
  });

  it('parses runtime logs', () => {
    expect(parseOrContractError(RuntimeLogsResponseSchema, fx('runtime-logs.json'), 'logs').logs).toContain('fixture runtime log line');
  });

  it('redacts every planted secret of every 4.7 payload', () => {
    const planted = /fixture-not-a-real-secret|fixture-db-password|\$\$apr1|fixture-value|fixture-pem|fixture\$literal/;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      expect(JSON.stringify(redactDeep(fx(f))), f).not.toMatch(planted);
    }
  });
});

describe('contract errors', () => {
  it('name the failing field paths and types, never a value', () => {
    const rows = fx('application-envs.json') as Array<Record<string, unknown>>;
    const broken = [rows[0], { ...rows[1], value: 12345, is_preview: 'sup3r-s3cret-value' }];
    let err: unknown;
    try { parseOrContractError(BulkResponseSchema, broken, 'listEnvs'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CoolifyContractError);
    const e = err as CoolifyContractError;
    expect(e.message).toMatch(/^Coolify response \(listEnvs\) failed contract validation: /);
    expect(e.message).toContain('[1].value');
    expect(e.message).toContain('[1].is_preview');
    expect(`${e.message}\n${e.zodIssues}`).not.toMatch(/sup3r|12345/);
  });
});
