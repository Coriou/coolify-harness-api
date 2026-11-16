import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, symlinkSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z as z3 } from 'zod/v3';
import { parseArgs } from '../src/cli/args.js';
import { main, errorToExitCode } from '../src/cli/main.js';
import { buildDepsFrom, flagSet, tokenEnv } from '../src/cli/dispatch.js';
import { envApply, envDelete, envDiff, parseDotenv } from '../src/cli/commands/env.js';
import { deployCmd } from '../src/cli/commands/deploy.js';
import { composeGet, composeSet } from '../src/cli/commands/compose.js';
import { databaseSet } from '../src/cli/commands/database.js';
import { catalogGen } from '../src/cli/commands/catalog.js';
import { helpCmd, HELP, EXIT_CODES } from '../src/cli/commands/help.js';
import { defaultWriteFile } from '../src/cli/deps.js';
import { makeAuditSink } from '../src/cli/audit-sink.js';
import { CoolifyClient } from '../src/client/coolify.js';
import { CoolifyInstanceClient } from '../src/client/instance.js';
import { CircuitBreaker, httpRequest } from '../src/client/http.js';
import { documentSecrets } from '../src/client/base.js';
import { planEnvWrite, applyEnvWrite } from '../src/client/safe-write.js';
import { waitForDeployment } from '../src/client/wait.js';
import { walkEnvSchema } from '../src/catalog/walk.js';
import { loadConfigModule, loadRegistry } from '../src/config/load.js';
import { noopLogger } from '../src/logging/index.js';
import type { Deployment, EnvVar, EnvWriteItem } from '../src/client/schemas.js';
import {
  ConfigError, CoolifyAuthError, CoolifyAuthScopeError, CoolifyNetworkError, CoolifyNotFoundError, CoolifyRequestError,
  UsageError,
} from '../src/errors/index.js';
import type { CmdDeps } from '../src/cli/deps.js';
import type { AuditRecord } from '../src/client/safe-write.js';
import type { ResolvedTarget } from '../src/config/schema.js';

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/v4.7/${name}`, import.meta.url)), 'utf8'));
const SECRET = 'hunter2-sup3r-s3cret';

let out: string[];
let err: string[];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
beforeEach(() => {
  out = []; err = [];
  process.stdout.write = ((c: string | Uint8Array) => { out.push(String(c)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => { err.push(String(c)); return true; }) as typeof process.stderr.write;
});
afterEach(() => { process.stdout.write = realOut; process.stderr.write = realErr; });
const stdout = (): string => out.join('');
const stderr = (): string => err.join('');
const oneJson = (): Record<string, unknown> => {
  const parsed = JSON.parse(stdout()) as Record<string, unknown>;
  expect(stdout().trimEnd()).toBe(JSON.stringify(parsed, null, 2));
  return parsed;
};

let dir: string;
beforeAll(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'coolify-harness-review-'))); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const appTarget: ResolvedTarget = { instanceUrl: 'https://c.example', kind: 'application', uuid: 'app-1', token: 't' };
const svcTarget: ResolvedTarget = { ...appTarget, kind: 'service', uuid: 'svc-1' };
const clientDeps = (fetchImpl: unknown) => ({ fetchImpl: fetchImpl as never, logger: noopLogger(), maxRetries: 0 });
const row = (key: string, value: string, over: Partial<EnvVar> = {}): EnvVar => ({
  uuid: `env-${key}`, key, value, value_hidden: false, value_null: false, is_preview: false,
  is_build_time: true, is_literal: false, is_multiline: false, is_shown_once: false, ...over,
});

function cmdDeps(client: Record<string, unknown>, target: ResolvedTarget = appTarget, over: Partial<CmdDeps> = {}): { deps: CmdDeps; audits: AuditRecord[] } {
  const audits: AuditRecord[] = [];
  return {
    audits,
    deps: {
      resolveTargetFor: () => target,
      clientFactory: () => client as unknown as ReturnType<CmdDeps['clientFactory']>,
      actor: 'test',
      auditSink: vi.fn(async (r: AuditRecord) => { audits.push(r); }),
      now: () => new Date('2026-11-16T00:00:00Z'),
      ...over,
    },
  };
}

describe('a mutation Coolify accepted is never reported as failed', () => {
  it('env apply on a service: the created row comes back without its flag columns (not an env row by our schema)', async () => {
    // What ServicesController::create_bulk_envs answers for a NEW key: updateOrCreate without refresh.
    const created = [{ uuid: 'new-1', key: 'NEW_KEY', value: 'v', is_runtime: true, is_buildtime: true }];
    let rows: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'PATCH') { rows = [{ ...(fx('service-envs.json') as Array<Record<string, unknown>>)[0], key: 'NEW_KEY', value: 'v', real_value: 'v' }]; return json(201, created); }
      return json(200, rows);
    });
    const client = new CoolifyClient(svcTarget, clientDeps(fetchImpl));
    const audits: AuditRecord[] = [];
    const result = await applyEnvWrite(planEnvWrite([], { values: { NEW_KEY: 'v' } }), {
      client, logger: noopLogger(), target: { instanceUrl: 'https://c.example', kind: 'service', uuid: 'svc-1' },
      actor: 't', writeAudit: async (r) => { audits.push(r); },
    });
    expect(result).toMatchObject({ confirmed: true });
    expect(audits[0]!.outcome).toBe('success');
  });

  it('deploy: a 200 acknowledgement in an unknown shape is still an accepted deploy, and keeps the uuid if there is one', async () => {
    const odd = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => json(200, { status: 'ok', deployment_uuid: 'dep-odd' }))));
    await expect(odd.deploy()).resolves.toEqual({ message: 'accepted', deploymentUuid: 'dep-odd' });
    const bare = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => json(200, ['queued']))));
    await expect(bare.restart()).resolves.toEqual({ message: 'accepted' });
    // A 204 is a success without a body by definition; an EMPTY 200 is not something Coolify sends.
    const del = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => new Response(null, { status: 204 }))));
    await expect(del.deleteEnv('e1')).resolves.toEqual({ message: '' });
    const empty = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => new Response('', { status: 200 }))));
    await expect(empty.deleteEnv('e1')).rejects.toThrow(/an empty answer.*check before retrying/);
    const inst = new CoolifyInstanceClient({ instanceUrl: 'https://c.example', token: 't' }, clientDeps(vi.fn(async () => json(200, ['unexpected']))));
    await expect(inst.cancelDeployment('d1')).resolves.toEqual({ message: '' });
    await expect(inst.restartServerProxy('s1')).resolves.toEqual({ message: '' });
  });

  it('a READ in an unknown shape is still a contract error', async () => {
    const client = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => json(200, { nope: true }))));
    await expect(client.listEnvs()).rejects.toThrow(/failed contract validation/);
  });

  it('compose set: a failing confirmation read keeps the save, still restarts, and says "not confirmed"', async () => {
    const service = fx('service.json') as Record<string, unknown>;
    const client = {
      getService: vi.fn().mockResolvedValueOnce(service).mockRejectedValueOnce(new CoolifyRequestError('GET failed with status 500', { status: 500 })),
      updateServiceCompose: vi.fn(async () => ({})),
      restart: vi.fn(async () => ({ message: 'Restart request queued.' })),
    };
    const d = cmdDeps(client, svcTarget);
    const code = await composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--image', 'umami=ghcr.io/umami-software/umami:3.5.0', '--apply', '--restart', '--json']), d.deps);
    expect(code).toBe(0);
    expect(oneJson()).toMatchObject({ dryRun: false, confirmed: null, confirmError: expect.stringContaining('500') as unknown, restart: 'Restart request queued.' });
    expect(client.restart).toHaveBeenCalledWith({ latest: true });
    expect(d.audits.map((a) => `${a.action}:${a.outcome}`)).toEqual(['compose.update:success', 'restart:success']);
  });

  it('compose set: a failing restart still reports that the compose was saved', async () => {
    const service = fx('service.json') as Record<string, unknown>;
    const client = {
      getService: vi.fn().mockResolvedValue(service),
      updateServiceCompose: vi.fn(async () => ({})),
      restart: vi.fn(async () => { throw new CoolifyNetworkError('Cannot reach Coolify', { reason: 'ECONNRESET' }); }),
    };
    const run = composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--image', 'umami=ghcr.io/umami-software/umami:3.5.0', '--apply', '--restart', '--json']), cmdDeps(client, svcTarget).deps);
    await expect(run).rejects.toBeInstanceOf(CoolifyNetworkError);
    expect(oneJson()).toMatchObject({ dryRun: false, changed: true, restart: null, restartFailed: true });
  });

  it('env delete: rows deleted before a failure are reported', async () => {
    const rows = [row('A', '1'), row('B', '2')];
    const client = {
      listEnvs: vi.fn(async () => rows),
      get: vi.fn(async () => ({ uuid: 'app-1', name: 'a', build_pack: 'dockerfile' })),
      deleteEnv: vi.fn().mockResolvedValueOnce({ message: 'deleted' }).mockRejectedValueOnce(new CoolifyRequestError('DELETE failed with status 500', { status: 500 })),
    };
    const d = cmdDeps(client);
    await expect(envDelete(parseArgs(['env', 'delete', '--app', 'web', '--key', 'A', '--key', 'B', '--apply', '--json']), d.deps)).rejects.toBeInstanceOf(CoolifyRequestError);
    expect(oneJson()).toMatchObject({ dryRun: false, deleted: 1, confirmed: null, failed: true });
    expect(d.audits[0]).toMatchObject({ action: 'env.delete', outcome: 'failure' });
  });
});

describe('the API token is never echoed', () => {
  it('a token with a line break is refused with an auth error that does not quote it, before any request', async () => {
    const fetchImpl = vi.fn();
    const e = await httpRequest('https://c.example/api/v1/version', { method: 'GET', token: `12|${SECRET}\nrest` }, {
      fetchImpl: fetchImpl as never, breaker: new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000 }), logger: noopLogger(),
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyAuthError);
    expect((e as Error).message).not.toContain(SECRET);
    expect(errorToExitCode(e)).toBe(5);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a runtime error that quotes the Authorization header is scrubbed', async () => {
    const token = `12|${SECRET}`;
    const fetchImpl = vi.fn(async () => { throw new TypeError(`Headers.append: "Bearer ${token}" is an invalid header value.`); });
    const e = await httpRequest('https://c.example/api/v1/version', { method: 'GET', token }, {
      fetchImpl: fetchImpl as never, breaker: new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000 }), logger: noopLogger(), maxRetries: 0,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyNetworkError);
    expect((e as Error).message).not.toContain(SECRET);
  });

  it('redirects are not followed: the token and the body never go to another address', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe('manual');
      return new Response(null, { status: 301, headers: { location: 'https://elsewhere.example/api/v1/version' } });
    });
    const inst = new CoolifyInstanceClient({ instanceUrl: 'http://c.example', token: 't' }, clientDeps(fetchImpl));
    const e = await inst.getVersion().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyRequestError);
    expect((e as Error).message).toContain('redirect (301) to https://elsewhere.example');
    expect((e as Error).message).toContain('set the instance url in the config');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a server error quoting a line of the compose that was sent is scrubbed', async () => {
    const compose = `services:\n  app:\n    environment:\n      DB_PASSWORD: ${SECRET} : x\n`;
    expect(documentSecrets(compose)).toContain(`${SECRET} : x`);
    const fetchImpl = vi.fn(async () => json(422, { message: `Unable to parse at line 4 (near "DB_PASSWORD: ${SECRET} : x").` }));
    const e = await new CoolifyClient(svcTarget, clientDeps(fetchImpl)).updateServiceCompose(compose).catch((x: unknown) => x);
    expect((e as Error).message).toContain('failed with status 422');
    expect((e as Error).message).not.toContain(SECRET);
  });

  it('the proxy configuration save is not replayed after a lost answer (the replay would skip the backup)', async () => {
    const fetchImpl = vi.fn(async () => json(502, { message: 'bad gateway' }));
    const inst = new CoolifyInstanceClient({ instanceUrl: 'https://c.example', token: 't' }, { fetchImpl: fetchImpl as never, logger: noopLogger(), sleep: async () => {} });
    await expect(inst.saveServerProxyConfiguration('s1', 'services: {}')).rejects.toBeInstanceOf(CoolifyRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('arguments and files are described, never quoted', () => {
  it('a stray argument made only of letters is not echoed either', () => {
    let message = '';
    try { parseArgs(['env', 'apply', '--app', 'web', '--set', 'DB_PASSWORD=', 'correcthorsebattery']); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('1 unexpected argument(s)');
    expect(message).not.toContain('correcthorsebattery');
    expect(() => parseArgs(['hunterTwoSecret'])).toThrow(/Unknown command: <15-character word>/);
    expect(() => parseArgs(['env', 'show'])).toThrow(/Unknown command: env <4-character word>\. Did you mean `env diff`/);
  });

  it('an invalid variable name is refused before any request, without echoing it (it is often a stray line of a secret)', async () => {
    const client = { listEnvs: vi.fn(), upsertEnvs: vi.fn() };
    const wrapped = `SIGNING_KEY=aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ\n${SECRET}TAILofTHEsecret0123==\n`;
    const d = cmdDeps(client, appTarget, { readFile: vi.fn(async () => wrapped) });
    const e = await envApply(parseArgs(['env', 'apply', '--app', 'web', '--from-file', '.env', '--apply']), d.deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect((e as Error).message).toContain('1 variable name(s) are not valid (1 from .env)');
    expect((e as Error).message).not.toContain(SECRET);
    expect(client.listEnvs).not.toHaveBeenCalled();
    await expect(envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', 'MY-KEY=1', '--set', 'OK=2']), d.deps)).rejects.toThrow(/1 variable name\(s\) are not valid \(1 from --set\)/);
    expect(parseDotenv('A.B=1\n_X=2\n')).toEqual({ 'A.B': '1', _X: '2' });
  });

  it('the config refuses a token where a variable NAME belongs, with or without the "N|" prefix, and never quotes it', () => {
    for (const tokenEnvValue of [`12|${SECRET}`, 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd', 'has space', '']) {
      let message = '';
      try { loadRegistry({ instances: { prod: { url: 'https://c.example', tokenEnv: tokenEnvValue } }, targets: {} }); } catch (e) { message = (e as Error).message; expect(e).toBeInstanceOf(ConfigError); }
      expect(message).toContain('instances.prod.tokenEnv: must be the NAME of an environment variable');
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('AbCdEfGhIjKl');
    }
    expect(() => loadRegistry({ instances: { prod: { url: 'https://c.example', tokenEnv: 'COOLIFY_PROD_TOKEN' } }, targets: {} })).not.toThrow();
  });

  it('an unquoted token in a config file (a ReferenceError naming part of it) is not echoed', async () => {
    const file = join(dir, 'unquoted.config.mjs');
    writeFileSync(file, 'export default { instances: { prod: { url: "https://c.example", tokenEnv: hunter2TokenFragment } }, targets: {} };\n');
    const e = await loadConfigModule(file).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConfigError);
    expect((e as Error).message).toContain('an identifier is not defined (an unquoted value?)');
    expect((e as Error).message).not.toContain('hunter2TokenFragment');
  });
});

describe('--token-file', () => {
  it('reads tokens from a dotenv file; a set environment variable wins; process.env is not touched', async () => {
    const file = join(dir, 'tokens.env');
    // The project's whole .env: lines that are not KEY=VALUE, padding and comments must not matter.
    writeFileSync(file, 'FROM_FILE_ONLY="12|file-token"\nPATH=/nope\nthis line is not an assignment\nPADDED = 12|padded-token   # rotated in May\nexport EXPORTED=\'12|exported\'\nBLANK_IN_ENV=12|from-file\n');
    process.env['BLANK_IN_ENV'] = '';
    try {
      const { env, missingFiles } = await tokenEnv({ tokenFiles: [file] });
      expect(env['FROM_FILE_ONLY']).toBe('12|file-token');
      expect(env['PADDED']).toBe('12|padded-token');
      expect(env['EXPORTED']).toBe('12|exported');
      expect(env['PATH']).toBe(process.env['PATH']); // the real environment wins…
      expect(env['BLANK_IN_ENV']).toBe('12|from-file'); // …unless it is blank
      expect(missingFiles).toEqual([]);
      expect(process.env['FROM_FILE_ONLY']).toBeUndefined();
    } finally {
      delete process.env['BLANK_IN_ENV'];
    }
    expect((await tokenEnv({})).env).toBe(process.env);
    expect(parseArgs(['status', '--app', 'a', '--token-file', '.env', '--token-file=.env.local']).tokenFiles).toEqual(['.env', '.env.local']);
    // Node itself claims `--env-file`, wherever it sits on the command line: the harness must not use that name.
    expect(() => parseArgs(['status', '--app', 'a', '--env-file', '.env'])).toThrow(/Unknown flag: --env-file/);
  });

  it('a missing token file is not an error by itself, but a missing token says the file was not there', async () => {
    const tokens = await tokenEnv({ tokenFiles: [join(dir, 'missing.env')] });
    expect(tokens.missingFiles).toEqual([join(dir, 'missing.env')]);
    const registry = { instances: { prod: { url: 'https://c.example', tokenEnv: 'NOT_SET_ANYWHERE_X' } }, targets: { web: { instance: 'prod', kind: 'application' as const, uuid: 'a' } } };
    const deps = buildDepsFrom({ registry }, tokens);
    expect(() => deps.resolveTargetFor(parseArgs(['status', '--app', 'web']))).toThrow(/Env var 'NOT_SET_ANYWHERE_X' .* is not set \(and --token-file .*missing\.env does not exist\)/);
  });
});

describe('files that hold secrets', () => {
  it('--out forces 0600 on an existing world-readable file and refuses to write through a symlink', async () => {
    const file = join(dir, 'compose.out.yml');
    writeFileSync(file, 'old', { mode: 0o644 });
    await defaultWriteFile(file, 'new secret content');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe('new secret content');
    const victim = join(dir, 'victim.txt');
    writeFileSync(victim, 'untouched');
    const link = join(dir, 'link.yml');
    symlinkSync(victim, link);
    await expect(defaultWriteFile(link, 'secret')).rejects.toThrow();
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
  });

  it('the audit log is 0600 even when an older version created it 0644', async () => {
    const log = join(dir, 'audit', 'audit.jsonl');
    const sink = makeAuditSink(log);
    const record = { ts: 't', actor: 'a', instanceUrl: 'u', resourceKind: 'application', resourceUuid: 'x', action: 'deploy', planSummary: { creates: 0, updates: 0, unchanged: 0, duplicateKeyDrift: 0 }, keysAffected: [], outcome: 'success' } as AuditRecord;
    await sink(record);
    expect(statSync(log).mode & 0o777).toBe(0o600);
    const old = join(dir, 'audit', 'old.jsonl');
    writeFileSync(old, '', { mode: 0o644 });
    await makeAuditSink(old)(record);
    expect(statSync(old).mode & 0o777).toBe(0o600);
    expect(readFileSync(old, 'utf8').trim()).toBe(JSON.stringify(record));
  });
});

describe('env values are compared the way Coolify stores them', () => {
  it('edge whitespace does not make a key an eternal update, and confirms', async () => {
    const current = [row('A', 'spaced'), row('TAB', 'x'), row('PEM', '-----BEGIN-----\nabc\n-----END-----')];
    const plan = planEnvWrite(current, { values: { A: ' spaced ', TAB: '\tx\n', PEM: '-----BEGIN-----\nabc\n-----END-----', NEW: ' v ' } });
    expect(plan.unchanged).toEqual(['A', 'TAB', 'PEM']);
    expect(plan.creates).toEqual([{ key: 'NEW', value: ' v ' }]);
    expect(plan.warnings.map((w) => w.kind)).toEqual(['trimmed-value', 'trimmed-value', 'trimmed-value']);
    const client = {
      upsertEnvs: vi.fn(async (_items: EnvWriteItem[]) => []),
      listEnvs: vi.fn(async () => [...current, row('NEW', 'v')]), // Coolify trimmed it
    };
    // A multi-line value keeps its edge whitespace on Coolify 4.7: a final newline is a real change.
    const pem = planEnvWrite(current, { values: { PEM: '-----BEGIN-----\nabc\n-----END-----\n' } });
    expect(pem.updates.map((u) => u.key)).toEqual(['PEM']);
    // PHP's trim() does not remove a no-break space: Coolify would store it, so it is a change.
    expect(planEnvWrite([row('N', 'x')], { values: { N: 'x\u00a0' } }).updates.map((u) => u.key)).toEqual(['N']);
    const result = await applyEnvWrite(plan, { client, logger: noopLogger(), target: { instanceUrl: 'u', kind: 'application', uuid: 'a' }, actor: 't', writeAudit: async () => {} });
    expect(result.confirmed).toBe(true);
  });

  it('a value withheld for lack of scope is not a confirmation; a locked one is', async () => {
    const plan = planEnvWrite([row('A', '1')], { values: { A: '2' } });
    const base = { logger: noopLogger(), target: { instanceUrl: 'u', kind: 'application' as const, uuid: 'a' }, actor: 't', writeAudit: async () => {} };
    const withheld = { upsertEnvs: vi.fn(async () => []), listEnvs: vi.fn(async () => [row('A', '', { value_hidden: true })]) };
    expect((await applyEnvWrite(plan, { ...base, client: withheld })).confirmed).toBe(false);
    const locked = { upsertEnvs: vi.fn(async () => []), listEnvs: vi.fn(async () => [row('A', '', { value_hidden: true, is_shown_once: true })]) };
    expect((await applyEnvWrite(plan, { ...base, client: locked })).confirmed).toBe(true);
  });

  it('the audit record is written right after the write, before the confirmation read', async () => {
    const order: string[] = [];
    const client = { upsertEnvs: vi.fn(async () => { order.push('write'); return []; }), listEnvs: vi.fn(async () => { order.push('confirm-read'); return [row('A', '2')]; }) };
    await applyEnvWrite(planEnvWrite([row('A', '1')], { values: { A: '2' } }), {
      client, logger: noopLogger(), target: { instanceUrl: 'u', kind: 'application', uuid: 'a' }, actor: 't', writeAudit: async () => { order.push('audit'); },
    });
    expect(order).toEqual(['write', 'audit', 'confirm-read']);
  });
});

describe('a withheld compose is not an empty compose', () => {
  const withheldService = (): Record<string, unknown> => { const { docker_compose_raw: _c, ...rest } = fx('service.json') as Record<string, unknown>; return rest; };

  it('compose get / compose set fail with a scope error (exit 5) instead of printing or diffing nothing', async () => {
    const client = { getService: vi.fn(async () => withheldService()), updateServiceCompose: vi.fn() };
    const d = cmdDeps(client, svcTarget, { writeFile: vi.fn() });
    for (const run of [
      () => composeGet(parseArgs(['compose', 'get', '--app', 'svc', '--out', 'x.yml']), d.deps),
      () => composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--image', 'umami=a:1', '--apply']), d.deps),
    ]) {
      const e = await run().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(CoolifyAuthScopeError);
      expect(errorToExitCode(e)).toBe(5);
      expect((e as Error).message).toContain("'read:sensitive'");
    }
    expect(d.deps.writeFile).not.toHaveBeenCalled();
    expect(client.updateServiceCompose).not.toHaveBeenCalled();
  });

  it('env delete refuses to skip its compose-lock check silently; --force says "I know"', async () => {
    const client = {
      listEnvs: vi.fn(async () => [row('APP_SECRET', 'x')]),
      getService: vi.fn(async () => withheldService()),
      deleteEnv: vi.fn(async () => ({ message: 'deleted' })),
    };
    const d = cmdDeps(client, svcTarget);
    await expect(envDelete(parseArgs(['env', 'delete', '--app', 'svc', '--key', 'APP_SECRET', '--apply']), d.deps)).rejects.toBeInstanceOf(CoolifyAuthScopeError);
    expect(client.deleteEnv).not.toHaveBeenCalled();
    expect(await envDelete(parseArgs(['env', 'delete', '--app', 'svc', '--key', 'APP_SECRET', '--apply', '--force']), d.deps)).toBe(0);
    expect(client.deleteEnv).toHaveBeenCalledTimes(1);
  });
});

describe('database set --public', () => {
  const dbDeps = (before: Record<string, unknown>) => {
    const inst = {
      instanceUrl: 'https://c.example',
      getDatabase: vi.fn(async () => ({ ...before })),
      updateDatabase: vi.fn(async (_uuid: string, patch: Record<string, unknown>) => { Object.assign(before, patch); }),
    };
    const d = cmdDeps({}, appTarget, { instanceFor: () => ({ name: 'prod', client: inst as never }) });
    return { inst, deps: d.deps };
  };

  it('sends public_port together with is_public: Coolify only starts the public proxy when both are in one request', async () => {
    const { inst, deps } = dbDeps({ uuid: 'db-1', name: 'db', is_public: false, public_port: 5433 });
    expect(await databaseSet(parseArgs(['database', 'set', '--instance', 'prod', '--database', 'db-1', '--public', 'true', '--apply']), deps)).toBe(0);
    expect(inst.updateDatabase).toHaveBeenCalledWith('db-1', { is_public: true, public_port: 5433 });
  });

  it('refuses to make a database public without any port, and moves the port of a public one with both fields', async () => {
    const noPort = dbDeps({ uuid: 'db-1', name: 'db', is_public: false, public_port: null });
    expect(await databaseSet(parseArgs(['database', 'set', '--instance', 'prod', '--database', 'db-1', '--public', 'true', '--apply']), noPort.deps)).toBe(2);
    expect(noPort.inst.updateDatabase).not.toHaveBeenCalled();
    const move = dbDeps({ uuid: 'db-1', name: 'db', is_public: true, public_port: 5433 });
    await databaseSet(parseArgs(['database', 'set', '--instance', 'prod', '--database', 'db-1', '--public-port', '5544', '--apply']), move.deps);
    expect(move.inst.updateDatabase).toHaveBeenCalledWith('db-1', { public_port: 5544, is_public: true });
  });
});

describe('deploy --wait', () => {
  const dep = (status: string, uuid = 'dep-running'): Deployment => ({ deployment_uuid: uuid, status });

  it('follows the deployment already in progress when Coolify skipped the request (it used to exit 0 at once)', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'Deployment already queued for this commit.' })),
      // newest first: a preview (pull request) deployment, then the production one that is building
      listDeployments: vi.fn(async () => [{ ...dep('in_progress', 'dep-pr-42'), pull_request_id: 42 }, { ...dep('in_progress'), pull_request_id: 0 }, dep('finished', 'dep-old')]),
      waitForDeployment: vi.fn(async () => dep('finished')),
    };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(0);
    expect(client.waitForDeployment).toHaveBeenCalledWith('dep-running', expect.anything());
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-running', followedExisting: true, finalStatus: 'finished' });
    expect(stderr()).toBe(''); // with --json the document says it (followedExisting)
    out = [];
    await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait']), cmdDeps(client).deps);
    expect(stderr()).toContain('following the deployment already in progress: dep-running');
  });

  it('when the deployment Coolify was busy with has already ended, ITS outcome is reported (never a bare "skipped")', async () => {
    const rows = [
      { ...dep('in_progress', 'dep-pr-42'), pull_request_id: 42 },
      { ...dep('finished', 'dep-older'), updated_at: '2026-11-15T10:00:00.000000Z' },
      { ...dep('failed', 'dep-just-failed'), updated_at: '2026-11-16T10:00:05.000000Z' },
    ];
    const client = {
      deploy: vi.fn(async () => ({ message: 'Deployment already queued for this commit.' })),
      listDeployments: vi.fn(async () => rows),
      waitForDeployment: vi.fn(),
    };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(7);
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-just-failed', followedExisting: true, finalStatus: 'failed' });
    expect(JSON.parse(stderr())).toMatchObject({ error: { code: 'DEPLOY_FAILED', exitCode: 7, deploymentUuid: 'dep-just-failed' } });
    expect(client.waitForDeployment).not.toHaveBeenCalled();
    // …and exit 0 when that deployment finished.
    out = []; err = [];
    rows[2] = { ...rows[2]!, status: 'finished' };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(0);
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-just-failed', followedExisting: true, finalStatus: 'finished' });
    expect(stderr()).toBe('');
  });

  it('does not say "nothing to wait for" when it could not look: the read error fails the command', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'Deployment already queued for this commit.' })),
      listDeployments: vi.fn(async () => { throw new CoolifyRequestError('GET failed with status 503', { status: 503 }); }),
      waitForDeployment: vi.fn(),
    };
    await expect(deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).rejects.toBeInstanceOf(CoolifyRequestError);
    expect(oneJson()).toMatchObject({ deploymentUuid: null, waitFailed: true });
  });

  it('Ctrl-C during the wait exits 130 and says the deployment keeps running', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'queued', deploymentUuid: 'dep-9' })),
      waitForDeployment: vi.fn((_uuid: string, opts: { signal: AbortSignal }) => new Promise<Deployment>((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => { reject(new Error('interrupted')); });
        process.emit('SIGINT');
      })),
    };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(130);
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-9', interrupted: true });
    expect((JSON.parse(stderr()) as { error: Record<string, unknown> }).error).toMatchObject({ code: 'INTERRUPTED', exitCode: 130, deploymentUuid: 'dep-9' });
  });

  it('a failed deployment prints its document on stdout AND an error document on stderr (exit 7)', async () => {
    const client = { deploy: vi.fn(async () => ({ message: 'queued', deploymentUuid: 'dep-9' })), waitForDeployment: vi.fn(async () => dep('failed', 'dep-9')) };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(7);
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-9', finalStatus: 'failed' });
    expect(JSON.parse(stderr())).toEqual({ error: { code: 'DEPLOY_FAILED', message: 'Deployment dep-9 ended with status failed', exitCode: 7, deploymentUuid: 'dep-9', finalStatus: 'failed' } });
  });

  it('when the wait itself fails, the queued deployment is not lost: stdout has it, the error carries its uuid', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'queued', deploymentUuid: 'dep-9' })),
      waitForDeployment: vi.fn(async () => { throw new CoolifyNetworkError('Cannot reach Coolify', { reason: 'ECONNRESET' }); }),
    };
    const e = await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyNetworkError);
    expect((e as { deploymentUuid?: string }).deploymentUuid).toBe('dep-9');
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-9', finalStatus: null, waitFailed: true });
  });

  it('flag set keeps ONE document when the deploy step fails after a queued deployment', async () => {
    const client = {
      listEnvs: vi.fn(async () => [row('F', 'off')]),
      upsertEnvs: vi.fn(async () => []),
      deploy: vi.fn(async () => ({ message: 'queued', deploymentUuid: 'dep-9' })),
      waitForDeployment: vi.fn(async () => { throw new CoolifyNetworkError('down', { reason: 'ECONNRESET' }); }),
    };
    client.listEnvs.mockResolvedValueOnce([row('F', 'off')]).mockResolvedValue([row('F', 'on')]);
    await expect(flagSet(parseArgs(['flag', 'set', '--app', 'web', '--set', 'F=on', '--apply', '--redeploy', '--wait', '--json']), cmdDeps(client).deps)).rejects.toBeInstanceOf(CoolifyNetworkError);
    expect(oneJson()).toMatchObject({ applied: ['F'], deploy: { deploymentUuid: 'dep-9', waitFailed: true } });
  });
});

describe('waitForDeployment and the circuit breaker', () => {
  const dep = (status: string): Deployment => ({ deployment_uuid: 'd1', status });
  const open = (): CoolifyNetworkError => new CoolifyNetworkError('Circuit open', { reason: 'circuit-open' });

  it('a poll refused by the open breaker is not a failed poll: a 60 s outage is survived', async () => {
    const get = vi.fn<() => Promise<Deployment>>();
    get.mockResolvedValueOnce(dep('in_progress'));
    get.mockRejectedValueOnce(new CoolifyNetworkError('down', { reason: 'ECONNREFUSED' }));
    for (let i = 0; i < 30; i += 1) get.mockRejectedValueOnce(open()); // breaker open, then reset
    get.mockResolvedValue(dep('finished'));
    let t = 0;
    await expect(waitForDeployment(get, 'd1', { now: () => t, sleep: async (ms) => { t += ms; } })).resolves.toMatchObject({ status: 'finished' });
  });

  it('a 404 is fatal on the first poll (never queued) but transient once the deployment has been seen', async () => {
    const never = vi.fn(async (): Promise<Deployment> => { throw new CoolifyNotFoundError('404'); });
    await expect(waitForDeployment(never, 'd1', { sleep: async () => {} })).rejects.toBeInstanceOf(CoolifyNotFoundError);
    expect(never).toHaveBeenCalledTimes(1);
    const seen = vi.fn<() => Promise<Deployment>>().mockResolvedValueOnce(dep('in_progress')).mockRejectedValueOnce(new CoolifyNotFoundError('404 page not found')).mockResolvedValue(dep('finished'));
    await expect(waitForDeployment(seen, 'd1', { sleep: async () => {} })).resolves.toMatchObject({ status: 'finished' });
  });

  it('a poll still in flight at the deadline is abandoned', async () => {
    const hang = vi.fn((): Promise<Deployment> => new Promise(() => {}));
    const started = Date.now();
    await expect(waitForDeployment(hang, 'd1', { timeoutMs: 40, pollGraceMs: 0 })).rejects.toThrow(/timed out after 40ms/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('an abort during a poll is honoured as soon as the poll returns, without another sleep', async () => {
    const abort = new AbortController();
    const sleep = vi.fn(async () => {});
    const get = vi.fn(async () => { abort.abort(new Error('interrupted')); return dep('in_progress'); });
    await expect(waitForDeployment(get, 'd1', { sleep, signal: abort.signal })).rejects.toThrow('interrupted');
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('help and catalog honour --json', () => {
  it('help --json is one document that carries the text, the commands and the exit codes', async () => {
    expect(await helpCmd({ json: true })).toBe(0);
    const doc = oneJson();
    expect(doc['help']).toBe(HELP);
    expect(doc['commands']).toContain('env diff');
    expect(doc['exitCodes']).toEqual(EXIT_CODES);
    out = [];
    expect(await main(['env', '--help', '--json'])).toBe(0);
    expect(oneJson()['version']).toBeDefined();
  });

  it('catalog gen --json reports what it wrote', async () => {
    const file = join(dir, 'cat.config.mjs');
    const md = join(dir, 'catalog.md');
    writeFileSync(file, `export default { instances: {}, targets: {} };\nexport const catalog = { schemas: [], out: { markdown: ${JSON.stringify(md)} } };\n`);
    expect(await catalogGen(parseArgs(['catalog', 'gen', '--json', '--config', file]))).toBe(0);
    expect(oneJson()).toEqual({ written: [md], keys: 0 });
    expect(existsSync(md)).toBe(true);
  });

  it('a schema that is not an object is a config error (exit 2), not an internal one', () => {
    let e: unknown;
    try { walkEnvSchema(z3.string(), { service: 'api' }); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(ConfigError);
    expect(errorToExitCode(e)).toBe(2);
  });
});

describe('zod 3 catalogs stay byte-identical to 0.4', () => {
  it('nested defaults read the innermost one, and a description on a middle wrapper is not picked up', () => {
    const [nested] = walkEnvSchema(z3.object({ A: z3.string().default('inner').optional().default('outer') }), { service: 's' });
    expect(nested!.default).toBe('inner');
    const [middle] = walkEnvSchema(z3.object({ B: z3.preprocess((v) => v, z3.string().optional().describe('only in the middle')) }), { service: 's' });
    expect(middle!.description).toBeUndefined();
  });
});

describe('second review round', () => {
  it('a 2xx that is not JSON is NOT an acknowledgement: an HTML page must not read as "deployed"', async () => {
    const html = (): Response => new Response('<!doctype html><title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    const client = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => html())));
    const d = cmdDeps(client as never);
    const e = await deployCmd(parseArgs(['deploy', '--app', 'web', '--json']), d.deps).catch((x: unknown) => x);
    expect((e as Error).message).toContain('a 2xx that is not a JSON object');
    expect(errorToExitCode(e)).toBe(1);
    expect(d.audits[0]).toMatchObject({ action: 'deploy', outcome: 'failure' });
    await expect(new CoolifyClient(svcTarget, clientDeps(vi.fn(async () => html()))).updateServiceCompose('services: {}')).rejects.toThrow(/not a JSON object/);
    await expect(new CoolifyInstanceClient({ instanceUrl: 'https://c.example', token: 't' }, clientDeps(vi.fn(async () => html()))).getVersion()).rejects.toThrow(/did not answer with a Coolify version/);
  });

  it('a write answered 2xx whose body could not be read was still carried out', async () => {
    const lost = { status: 200, headers: new Headers(), text: async () => { throw new TypeError('terminated'); } } as unknown as Response;
    await expect(new CoolifyClient(appTarget, clientDeps(vi.fn(async () => lost))).deploy()).resolves.toEqual({ message: 'accepted' });
    // …but a READ whose body is lost is a network error (and is retried).
    await expect(new CoolifyClient(appTarget, clientDeps(vi.fn(async () => lost))).listEnvs()).rejects.toBeInstanceOf(CoolifyNetworkError);
  });

  it('the "unmarshal" quirk text does not get a non-idempotent request replayed', async () => {
    const fetchImpl = vi.fn(async () => json(500, { message: 'cannot unmarshal array into Go value' }));
    const client = new CoolifyClient(appTarget, { fetchImpl: fetchImpl as never, logger: noopLogger(), sleep: async () => {} });
    await expect(client.deploy()).rejects.toBeInstanceOf(CoolifyRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a wait with a timeout beyond what a timer can hold (or Infinity) does not expire at once', async () => {
    for (const timeoutMs of [Infinity, Number.MAX_SAFE_INTEGER, 3e9]) {
      const get = vi.fn<() => Promise<Deployment>>().mockResolvedValueOnce({ deployment_uuid: 'd', status: 'in_progress' }).mockResolvedValue({ deployment_uuid: 'd', status: 'finished' });
      await expect(waitForDeployment(get, 'd', { timeoutMs, sleep: async () => {} })).resolves.toMatchObject({ status: 'finished' });
    }
  });

  it('the default sleep is cancelled by an abort (the process must not outlive Ctrl-C)', async () => {
    const abort = new AbortController();
    const started = Date.now();
    const p = waitForDeployment(async () => ({ deployment_uuid: 'd', status: 'in_progress' }), 'd', { intervalMs: 60_000, signal: abort.signal });
    setTimeout(() => { abort.abort(new Error('interrupted')); }, 20);
    await expect(p).rejects.toThrow('interrupted');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('dotenv: blanks before a quoted value are not part of it, and only \\n / \\r are expanded', () => {
    expect(parseDotenv('A = "v"\nB= \'w\'\nC="back\\\\slash \\t tab"\nD="two\\nlines"\n')).toEqual({ A: 'v', B: 'w', C: 'back\\\\slash \\t tab', D: 'two\nlines' });
  });

  it('variable names: dots are fine, 256 characters are not, a base64 tail is not a name', async () => {
    const client = { listEnvs: vi.fn(async () => []), upsertEnvs: vi.fn() };
    const d = cmdDeps(client);
    expect(await envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', 'A.B=1', '--set', '_X=2']), d.deps)).toBe(0);
    await expect(envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', `${'K'.repeat(256)}=1`]), d.deps)).rejects.toBeInstanceOf(UsageError);
    const wrapped = cmdDeps(client, appTarget, { readFile: vi.fn(async () => 'PRIVATE_KEY=aGVsbG8gd29ybGQ\nc2VjcmV0S3cr3tValue9xZZ==\n') });
    const e = await envDiff(parseArgs(['env', 'diff', '--app', 'web', '--from-file', '.env']), wrapped.deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect((e as Error).message).not.toContain('S3cr3tValue9x');
  });

  it('a word that only starts like a command is not echoed', () => {
    let message = '';
    try { parseArgs(['env', 'set-S3cr3tValue9x']); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('Unknown command: env <17-character word>');
    expect(message).not.toContain('S3cr3tValue9x');
    expect(() => parseArgs(['env-diff', 'extra'])).toThrow(/1 unexpected argument/);
  });

  it('--help wins over every other flag, and --json still picks its format', async () => {
    expect(parseArgs(['deploy', '--app', 'web', '--force', '--help'])).toMatchObject({ command: 'help', json: false });
    expect(parseArgs(['--bogus-flag', '-h', '--json'])).toMatchObject({ command: 'help', json: true });
  });

  it('config doctor --offline keeps the 0.4 local check: no token is not a failure unless a target is named', async () => {
    const CONFIG = fileURLToPath(new URL('./fixtures/config/basic.config.ts', import.meta.url));
    const { configDoctor } = await import('../src/cli/commands/config-doctor.js');
    const getVersion = vi.fn();
    expect(await configDoctor(parseArgs(['config', 'doctor', '--offline', '--config', CONFIG]), { env: {}, getVersion })).toBe(0);
    expect(stdout()).toContain('token COOLIFY_PROD_TOKEN: MISSING');
    expect(await configDoctor(parseArgs(['config', 'doctor', '--offline', '--app', 'my-api', '--config', CONFIG]), { env: {}, getVersion })).toBe(5);
    expect(getVersion).not.toHaveBeenCalled();
    await expect(configDoctor(parseArgs(['config', 'doctor', '--app', 'my-api', '--instance', 'other', '--config', CONFIG]), { env: {}, getVersion }))
      .rejects.toThrow(/--app my-api is on instance 'prod', not 'other'/);
    out = []; err = [];
    const notCoolify = vi.fn(async () => { throw new Error('https://c/api/v1/version did not answer with a Coolify version'); });
    expect(await configDoctor(parseArgs(['config', 'doctor', '--json', '--config', CONFIG]), { env: { COOLIFY_PROD_TOKEN: 'tok' }, getVersion: notCoolify })).toBe(1);
    expect(oneJson()).toMatchObject({ ok: false });
  });

  it('database set: a port change on an already-public database comes with a note; --public true without a port is refused in the dry-run too', async () => {
    const before: Record<string, unknown> = { uuid: 'db-1', name: 'db', is_public: true, public_port: 5433 };
    const inst = { instanceUrl: 'https://c.example', getDatabase: vi.fn(async () => ({ ...before })), updateDatabase: vi.fn() };
    const d = cmdDeps({}, appTarget, { instanceFor: () => ({ name: 'prod', client: inst as never }) });
    expect(await databaseSet(parseArgs(['database', 'set', '--instance', 'prod', '--database', 'db-1', '--public-port', '5544', '--json']), d.deps)).toBe(0);
    expect((oneJson()['notes'] as string[])[0]).toContain('does not move the port of a database that is already public');
    expect(inst.updateDatabase).not.toHaveBeenCalled();
    const noPort = { instanceUrl: 'https://c.example', getDatabase: vi.fn(async () => ({ uuid: 'db-1', name: 'db', is_public: false, public_port: null })), updateDatabase: vi.fn() };
    const d2 = cmdDeps({}, appTarget, { instanceFor: () => ({ name: 'prod', client: noPort as never }) });
    expect(await databaseSet(parseArgs(['database', 'set', '--instance', 'prod', '--database', 'db-1', '--public', 'true']), d2.deps)).toBe(2);
  });

  it('compose get --out --json keeps stderr empty and reports the file in the document', async () => {
    const client = { getService: vi.fn(async () => fx('service.json')) };
    const d = cmdDeps(client, svcTarget, { writeFile: vi.fn(async () => {}) });
    expect(await composeGet(parseArgs(['compose', 'get', '--app', 'svc', '--out', 'svc.yml', '--json']), d.deps)).toBe(0);
    expect(oneJson()['out']).toMatchObject({ path: 'svc.yml', unredacted: true });
    expect(stderr()).toBe('');
  });

  it('logs --build says when Coolify withheld the log instead of printing an empty one', async () => {
    const { logsCmd } = await import('../src/cli/commands/logs.js');
    const client = { getLatestDeployment: vi.fn(async () => ({ deployment_uuid: 'd1', status: 'finished', logs: null })), getDeployment: vi.fn(async () => ({ deployment_uuid: 'd1', status: 'finished' })) };
    expect(await logsCmd(parseArgs(['logs', '--app', 'web', '--build', '--json']), cmdDeps(client).deps)).toBe(0);
    expect(oneJson()).toMatchObject({ logs: '', logs_available: false });
    out = [];
    await logsCmd(parseArgs(['logs', '--app', 'web', '--build']), cmdDeps(client).deps);
    expect(stderr()).toContain('Coolify returned no build log (the token needs read:sensitive');
  });

  it('status tolerates a 401 on the deployments read as well', async () => {
    const { statusCmd } = await import('../src/cli/commands/status.js');
    const client = { get: vi.fn(async () => fx('application.json')), getLatestDeployment: vi.fn(async () => { throw new CoolifyAuthError('Coolify auth failed (401)', { status: 401 }); }) };
    expect(await statusCmd(parseArgs(['status', '--app', 'web', '--json']), cmdDeps(client).deps)).toBe(0);
    expect(oneJson()['latestDeploymentError']).toContain('401');
  });

  it('a closed pipe silences the stream instead of ending the command; any other stream error still throws', async () => {
    const { ignoreClosedPipe } = await import('../src/cli/main.js');
    const { EventEmitter } = await import('node:events');
    const stream = Object.assign(new EventEmitter(), { write: (() => { throw new Error('should have been replaced'); }) as unknown });
    ignoreClosedPipe(stream as never);
    stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    expect((stream.write as () => boolean)()).toBe(true);
    expect(() => stream.emit('error', Object.assign(new Error('disk'), { code: 'EIO' }))).toThrow('disk');
  });

  it('the audit log is never written through a symlink', async () => {
    const victim = join(dir, 'audit-victim.txt');
    writeFileSync(victim, 'untouched', { mode: 0o644 });
    const link = join(dir, 'audit-link', 'audit.jsonl');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'audit-link'));
    symlinkSync(victim, link);
    const record = { ts: 't', actor: 'a', instanceUrl: 'u', resourceKind: 'application', resourceUuid: 'x', action: 'deploy', planSummary: { creates: 0, updates: 0, unchanged: 0, duplicateKeyDrift: 0 }, keysAffected: [], outcome: 'success' } as AuditRecord;
    await expect(makeAuditSink(link)(record)).rejects.toThrow();
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(statSync(victim).mode & 0o777).toBe(0o644);
  });
});
