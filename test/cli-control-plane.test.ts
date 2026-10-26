import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParsedArgs } from '../src/cli/args.js';
import { errorToExitCode } from '../src/cli/main.js';
import { deployCmd } from '../src/cli/commands/deploy.js';
import { envList, envDelete, envDiff, composeReferences } from '../src/cli/commands/env.js';
import { EnvVarSchema } from '../src/client/schemas.js';
import { composeGet, composeSet } from '../src/cli/commands/compose.js';
import { proxySet, proxyRestart, proxyGet } from '../src/cli/commands/proxy.js';
import { databaseSet, databaseBackup } from '../src/cli/commands/database.js';
import { deploymentCancelCmd } from '../src/cli/commands/deployments.js';
import { statusCmd } from '../src/cli/commands/status.js';
import { instanceInfo, notInApi } from '../src/cli/commands/instance.js';
import { LockedVarError, CoolifyFeatureNotSupportedError, CoolifyAuthScopeError } from '../src/errors/index.js';
import type { CmdDeps } from '../src/cli/deps.js';
import type { AuditRecord } from '../src/client/safe-write.js';
import type { ResolvedTarget } from '../src/config/schema.js';

const fx = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/v4.5/${name}`, import.meta.url)), 'utf8'));
const SERVICE = fx('service.json');
const PROXY = fx('server-proxy.json');
const PLANTED = /fixture-not-a-real-secret|fixture-webhook-secret|\$\$apr1|fixture-db-password/;

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

const args = (argv: string[]): ParsedArgs => parseArgs(argv);
const svcTarget: ResolvedTarget = { instanceUrl: 'https://c', kind: 'service', uuid: 'svc-1', token: 't' };
const appTarget: ResolvedTarget = { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1', token: 't' };

function targetClient(over: Record<string, unknown> = {}) {
  return {
    listEnvs: vi.fn(), upsertEnvs: vi.fn(), deleteEnv: vi.fn().mockResolvedValue({ message: 'deleted' }),
    deploy: vi.fn().mockResolvedValue({ message: 'queued', deploymentUuid: 'dep-1' }),
    restart: vi.fn().mockResolvedValue({ message: 'Service restaring request queued.' }),
    get: vi.fn().mockResolvedValue(fx('application.json')),
    getService: vi.fn().mockResolvedValue(SERVICE),
    getDatabase: vi.fn(), updateServiceCompose: vi.fn().mockResolvedValue({ uuid: 'svc-1', domains: [] }),
    getRuntimeLogs: vi.fn(), listDeployments: vi.fn().mockResolvedValue([]), getDeployment: vi.fn(),
    getLatestDeployment: vi.fn().mockResolvedValue(undefined), getLatestBuildLogs: vi.fn(),
    waitForDeployment: vi.fn(), cancelDeployment: vi.fn(),
    ...over,
  };
}
function instanceClient(over: Record<string, unknown> = {}) {
  return {
    instanceUrl: 'https://c',
    getVersion: vi.fn().mockResolvedValue('4.5.0'), getHealth: vi.fn().mockResolvedValue('OK'),
    listRunningDeployments: vi.fn(), getDeployment: vi.fn(), cancelDeployment: vi.fn(),
    listServers: vi.fn(), getServer: vi.fn(), getServerResources: vi.fn(),
    getServerProxy: vi.fn().mockResolvedValue(PROXY),
    saveServerProxyConfiguration: vi.fn().mockResolvedValue({ message: 'Proxy configuration saved.' }),
    restartServerProxy: vi.fn().mockResolvedValue({ message: 'Proxy restart queued.' }),
    listDatabases: vi.fn(), getDatabase: vi.fn(), updateDatabase: vi.fn().mockResolvedValue(undefined),
    listDatabaseBackups: vi.fn().mockResolvedValue([]), runDatabaseBackup: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}
function makeDeps(target: ResolvedTarget, client: ReturnType<typeof targetClient>, inst = instanceClient()) {
  const audits: AuditRecord[] = [];
  const deps = {
    resolveTargetFor: () => target,
    clientFactory: () => client,
    instanceFor: () => ({ name: 'prod', client: inst }),
    actor: 'test',
    auditSink: vi.fn(async (r: AuditRecord) => { audits.push(r); }),
    now: () => new Date('2026-10-26T00:00:00Z'),
    writeFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as CmdDeps;
  return { deps, audits, inst };
}

describe('CLI arg parsing quirks agents hit', () => {
  it('accepts --flag=value, hyphen/colon command spellings and flags before the command', () => {
    expect(parseArgs(['env-diff', '--app=web']).command).toBe('env-diff');
    expect(parseArgs(['env:diff', '--app', 'web']).app).toBe('web');
    const a = parseArgs(['--app', 'web', '--json', 'status']);
    expect([a.command, a.app, a.json]).toEqual(['status', 'web', true]);
    expect(parseArgs(['config-doctor']).command).toBe('config-doctor');
  });

  it('parses the new control-plane flags', () => {
    const a = parseArgs(['compose', 'set', '--app', 's', '--image', 'umami=ghcr.io/u/umami:3.4.0', '--image', 'db=postgres:16', '--restart', '--apply']);
    expect(a.images).toEqual(['umami=ghcr.io/u/umami:3.4.0', 'db=postgres:16']);
    expect(parseArgs(['database', 'set', '--app', 'pg', '--public', 'false']).public).toBe(false);
    expect(parseArgs(['deployment', 'cancel', 'dep-9', '--instance', 'prod']).deployment).toBe('dep-9');
    expect(parseArgs(['deploy', '--app', 'a', '--force', '--wait', '--timeout', '900']).timeout).toBe(900);
    expect(parseArgs(['version', '--instance', 'prod']).command).toBe('instance-info');
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['env', 'delete', '--app', 'a', '--key', 'A', '--key', 'B']).keys).toEqual(['A', 'B']);
  });

  it('rejects unknown flags, stray positionals and bad values with a usage error', () => {
    expect(() => parseArgs(['status', '--nope'])).toThrow(/Unknown flag/);
    expect(() => parseArgs(['status', 'extra'])).toThrow(/Unexpected argument/);
    expect(() => parseArgs(['database', 'set', '--public', 'maybe'])).toThrow(/true or false/);
    expect(() => parseArgs([])).toThrow(/No command/);
  });
});

describe('deploy', () => {
  it('--force --wait exits 7 when the deployment fails, and audits the force option', async () => {
    const client = targetClient({ waitForDeployment: vi.fn().mockResolvedValue({ deployment_uuid: 'dep-1', status: 'failed' }) });
    const { deps, audits } = makeDeps(appTarget, client);
    const code = await deployCmd(args(['deploy', '--app', 'web', '--force', '--wait', '--timeout', '60']), deps);
    expect(client.deploy).toHaveBeenCalledWith({ force: true });
    expect(client.waitForDeployment.mock.calls[0]![1]).toMatchObject({ timeoutMs: 60_000 });
    expect(code).toBe(7);
    expect(audits[0]).toMatchObject({ action: 'deploy', options: { force: true }, outcome: 'success' });
  });

  it('--wait exits 0 when the deployment finishes', async () => {
    const client = targetClient({ waitForDeployment: vi.fn().mockResolvedValue({ deployment_uuid: 'dep-1', status: 'finished' }) });
    expect(await deployCmd(args(['deploy', '--app', 'web', '--wait', '--json']), makeDeps(appTarget, client).deps)).toBe(0);
    expect(JSON.parse(stdout()).finalStatus).toBe('finished');
  });

  it('rejects --force on a service and --latest on an application before sending or auditing anything', async () => {
    const client = targetClient();
    const svc = makeDeps(svcTarget, client);
    expect(await deployCmd(args(['deploy', '--app', 'svc', '--force']), svc.deps)).toBe(2);
    expect(err.join('')).toContain('deploy --app svc --restart --latest');
    expect(await deployCmd(args(['deploy', '--app', 'web', '--latest']), makeDeps(appTarget, client).deps)).toBe(2);
    expect(client.deploy).not.toHaveBeenCalled();
    expect(client.restart).not.toHaveBeenCalled();
    expect(svc.audits).toEqual([]);
  });

  it('--restart --latest restarts a service pulling images; --wait explains there is nothing to wait for', async () => {
    const client = targetClient();
    expect(await deployCmd(args(['deploy', '--app', 'svc', '--restart', '--latest', '--wait']), makeDeps(svcTarget, client).deps)).toBe(0);
    expect(client.restart).toHaveBeenCalledWith({ latest: true });
    expect(err.join('')).toMatch(/creates no deployment record/);
  });
});

describe('env list / env delete', () => {
  const rows = [
    { uuid: 'e1', key: 'PASSWORD', value: 'hunter2-secret', is_preview: false, is_build_time: false, is_literal: false, is_multiline: false, is_shown_once: false },
    { uuid: 'e2', key: 'OLD_FLAG', value: 'x', is_preview: false, is_build_time: false, is_literal: false, is_multiline: false, is_shown_once: false },
    { uuid: 'e3', key: 'OLD_FLAG', value: 'y', is_preview: true, is_build_time: false, is_literal: false, is_multiline: false, is_shown_once: false },
  ];

  it('env list never prints values', async () => {
    const client = targetClient({ listEnvs: vi.fn().mockResolvedValue(rows) });
    await envList(args(['env', 'list', '--app', 's', '--json']), makeDeps(svcTarget, client).deps);
    expect(stdout()).not.toContain('hunter2-secret');
    expect(JSON.parse(stdout())[0]).toMatchObject({ key: 'OLD_FLAG', value_length: 1 });
  });

  it('is a dry-run without --apply and deletes only the chosen scope with it', async () => {
    const client = targetClient({ listEnvs: vi.fn().mockResolvedValueOnce(rows) });
    const { deps, audits } = makeDeps(svcTarget, client);
    await envDelete(args(['env', 'delete', '--app', 's', '--key', 'OLD_FLAG']), deps);
    expect(client.deleteEnv).not.toHaveBeenCalled();
    client.listEnvs.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[0], rows[2]]);
    expect(await envDelete(args(['env', 'delete', '--app', 's', '--key', 'OLD_FLAG', '--apply']), deps)).toBe(0);
    expect(client.deleteEnv.mock.calls).toEqual([['e2']]); // prod row only; preview row e3 untouched
    expect(audits[0]).toMatchObject({ action: 'env.delete', keysAffected: ['OLD_FLAG'], resourceKind: 'service' });
    expect(JSON.stringify(audits)).not.toMatch(/hunter2|"x"|"y"/);
  });

  it('refuses (exit 6) to delete a key the compose still references, unless --force', async () => {
    const svc = { ...SERVICE, docker_compose_raw: 'services:\n  app:\n    image: x:1\n    environment:\n      - PASSWORD=${PASSWORD}\n' };
    const client = targetClient({ listEnvs: vi.fn().mockResolvedValue(rows), getService: vi.fn().mockResolvedValue(svc) });
    const { deps } = makeDeps(svcTarget, client);
    const e = await envDelete(args(['env', 'delete', '--app', 's', '--key', 'PASSWORD', '--apply']), deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LockedVarError);
    expect(errorToExitCode(e)).toBe(6);
    expect(client.deleteEnv).not.toHaveBeenCalled();
    await envDelete(args(['env', 'delete', '--app', 's', '--key', 'PASSWORD', '--apply', '--force']), deps);
    expect(client.deleteEnv).toHaveBeenCalledWith('e1');
  });

  // Without read:sensitive Coolify omits `value` / `real_value`. That used to be a contract error;
  // now listing works (length unknown) and diff/apply refuse with a scope error (exit 5).
  it('handles a token without read:sensitive: list works, diff refuses with exit 5', async () => {
    const hidden = EnvVarSchema.parse({ uuid: 'h1', key: 'API_KEY', is_preview: false, is_literal: false, is_multiline: false, is_shown_once: false });
    expect(hidden).toMatchObject({ value: '', value_hidden: true });
    const client = targetClient({ listEnvs: vi.fn().mockResolvedValue([hidden]) });
    const { deps } = makeDeps(svcTarget, client);
    await envList(args(['env', 'list', '--app', 's']), deps);
    expect(stdout()).toContain('API_KEY  [prod]  len=hidden');
    const e = await envDiff(args(['env', 'diff', '--app', 's', '--set', 'API_KEY=x']), deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyAuthScopeError);
    expect(errorToExitCode(e)).toBe(5);
  });

  it('detects compose references in all the shapes compose uses', () => {
    expect(composeReferences('x: ${PASSWORD}', 'PASSWORD')).toBe(true);
    expect(composeReferences('      - PASSWORD', 'PASSWORD')).toBe(true);
    expect(composeReferences('      PASSWORD: abc', 'PASSWORD')).toBe(true);
    expect(composeReferences('      - PASSWORD_HASH=${PASSWORD_HASH}', 'PASSWORD')).toBe(false);
  });
});

describe('compose get / set', () => {
  it('compose get prints redacted and writes the raw document only to --out', async () => {
    const client = targetClient();
    const { deps } = makeDeps(svcTarget, client);
    await composeGet(args(['compose', 'get', '--app', 's', '--out', 'svc.yml']), deps);
    expect(stdout()).not.toMatch(PLANTED);
    expect(stdout()).toContain('# umami: ghcr.io/umami-software/umami:3.0.3');
    expect((deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['svc.yml', SERVICE['docker_compose_raw']]);
  });

  // Regression (found by the live leak check): the JSON document carried the compose under a
  // `compose` key the redactor did not recognise, so literal secrets went out unredacted.
  it('compose get --json redacts the compose document', async () => {
    await composeGet(args(['compose', 'get', '--app', 's', '--json']), makeDeps(svcTarget, targetClient()).deps);
    expect(stdout()).not.toMatch(PLANTED);
    expect(JSON.parse(stdout()).compose).toContain('HARDCODED_TOKEN=[REDACTED]');
  });

  it('--image is a dry-run by default and shows a redacted diff', async () => {
    const client = targetClient();
    await composeSet(args(['compose', 'set', '--app', 's', '--image', 'umami=ghcr.io/umami-software/umami:3.4.0']), makeDeps(svcTarget, client).deps);
    expect(client.updateServiceCompose).not.toHaveBeenCalled();
    expect(stdout()).toContain('image umami: ghcr.io/umami-software/umami:3.0.3 -> ghcr.io/umami-software/umami:3.4.0');
    expect(stdout()).not.toMatch(PLANTED);
  });

  it('--apply --restart saves only the edited image line, confirms, restarts with latest and audits', async () => {
    const saved: string[] = [];
    const client = targetClient({
      updateServiceCompose: vi.fn(async (c: string) => { saved.push(c); return { uuid: 'svc-1' }; }),
      getService: vi.fn().mockResolvedValueOnce(SERVICE).mockImplementation(async () => ({ ...SERVICE, docker_compose_raw: saved[0] })),
    });
    const { deps, audits } = makeDeps(svcTarget, client);
    await composeSet(args(['compose', 'set', '--app', 's', '--image', 'umami=ghcr.io/umami-software/umami:3.4.0', '--apply', '--restart', '--json']), deps);
    expect(saved[0]).toBe((SERVICE['docker_compose_raw'] as string).replace('umami:3.0.3', 'umami:3.4.0'));
    expect(client.restart).toHaveBeenCalledWith({ latest: true });
    const report = JSON.parse(stdout());
    expect(report).toMatchObject({ dryRun: false, confirmed: true, restart: 'Service restaring request queued.' });
    expect(audits.map((a) => a.action)).toEqual(['compose.update', 'restart']);
    expect(audits[0]).toMatchObject({ keysAffected: ['umami'], options: { images: 'umami=ghcr.io/umami-software/umami:3.4.0' } });
  });

  it('refuses to edit an application compose (it is owned by git)', async () => {
    await expect(composeSet(args(['compose', 'set', '--app', 'a', '--image', 'x=y:1', '--apply']), makeDeps(appTarget, targetClient()).deps))
      .rejects.toBeInstanceOf(CoolifyFeatureNotSupportedError);
  });
});

describe('proxy', () => {
  it('proxy set --image is a dry-run that names the version change and warns on a major bump', async () => {
    const { deps, inst } = makeDeps(appTarget, targetClient());
    await proxySet(args(['proxy', 'set', '--instance', 'prod', '--server', 'srv-1', '--image', 'traefik:v4.0']), deps);
    expect(inst.saveServerProxyConfiguration).not.toHaveBeenCalled();
    expect(stdout()).toContain('proxy image traefik: traefik:v3.6 -> traefik:v4.0');
    expect(stdout()).toContain('WARNING: major version changes');
    expect(stdout()).not.toMatch(PLANTED);
  });

  it('proxy set --apply saves the compose with only the image changed; restart is a separate opt-in', async () => {
    const saved: string[] = [];
    const inst = instanceClient({
      saveServerProxyConfiguration: vi.fn(async (_u: string, c: string) => { saved.push(c); return {}; }),
      getServerProxy: vi.fn().mockResolvedValueOnce(PROXY).mockImplementation(async () => ({ ...PROXY, configuration: saved[0] })),
    });
    const { deps, audits } = makeDeps(appTarget, targetClient(), inst);
    await proxySet(args(['proxy', 'set', '--instance', 'prod', '--server', 'srv-1', '--image', 'traefik:v3.7.13', '--apply']), deps);
    expect(saved[0]).toBe((PROXY['configuration'] as string).replace("'traefik:v3.6'", "'traefik:v3.7.13'"));
    expect(inst.restartServerProxy).not.toHaveBeenCalled();
    expect(stdout()).toContain('Saved and confirmed');
    expect(audits[0]).toMatchObject({ action: 'proxy.configuration', resourceKind: 'server', resourceUuid: 'srv-1', options: { images: 'traefik=traefik:v3.7.13' } });
  });

  it('proxy set explains when Coolify withholds the configuration (no read:sensitive / not admin)', async () => {
    const inst = instanceClient({ getServerProxy: vi.fn().mockResolvedValue({ ...PROXY, configuration: null }) });
    await expect(proxySet(args(['proxy', 'set', '--instance', 'prod', '--server', 'srv-1', '--image', 'traefik:v3.7']), makeDeps(appTarget, targetClient(), inst).deps))
      .rejects.toThrow(/read:sensitive/);
  });

  it('proxy restart is a dry-run without --apply', async () => {
    const { deps, inst, audits } = makeDeps(appTarget, targetClient());
    await proxyRestart(args(['proxy', 'restart', '--instance', 'prod', '--server', 'srv-1']), deps);
    expect(inst.restartServerProxy).not.toHaveBeenCalled();
    await proxyRestart(args(['proxy', 'restart', '--instance', 'prod', '--server', 'srv-1', '--apply']), deps);
    expect(inst.restartServerProxy).toHaveBeenCalledWith('srv-1');
    expect(audits[0]!.action).toBe('proxy.restart');
  });

  it('proxy get redacts the configuration on stdout', async () => {
    await proxyGet(args(['proxy', 'get', '--instance', 'prod', '--server', 'srv-1']), makeDeps(appTarget, targetClient()).deps);
    expect(stdout()).toContain('image traefik: traefik:v3.6');
    expect(stdout()).not.toMatch(PLANTED);
  });
});

describe('database, deployment cancel, status, instance', () => {
  it('database set --public false: dry-run, then PATCH + confirm with --apply', async () => {
    const inst = instanceClient({
      getDatabase: vi.fn().mockResolvedValueOnce({ uuid: 'db-1', name: 'pg', is_public: true, public_port: 5433 })
        .mockResolvedValueOnce({ uuid: 'db-1', name: 'pg', is_public: true, public_port: 5433 })
        .mockResolvedValueOnce({ uuid: 'db-1', name: 'pg', is_public: false, public_port: 5433 }),
    });
    const { deps, audits } = makeDeps(appTarget, targetClient(), inst);
    await databaseSet(args(['database', 'set', '--instance', 'prod', '--database', 'db-1', '--public', 'false']), deps);
    expect(inst.updateDatabase).not.toHaveBeenCalled();
    await databaseSet(args(['database', 'set', '--instance', 'prod', '--database', 'db-1', '--public', 'false', '--apply']), deps);
    expect(inst.updateDatabase).toHaveBeenCalledWith('db-1', { is_public: false });
    expect(stdout()).toContain('Updated and confirmed.');
    expect(audits[0]).toMatchObject({ action: 'database.update', keysAffected: ['is_public'], options: { is_public: false } });
  });

  it('database backup needs a backup config and runs it only with --apply', async () => {
    const inst = instanceClient({ listDatabaseBackups: vi.fn().mockResolvedValue([{ uuid: 'bk-1', frequency: 'daily' }]) });
    const { deps } = makeDeps(appTarget, targetClient(), inst);
    await databaseBackup(args(['database', 'backup', '--instance', 'prod', '--database', 'db-1']), deps);
    expect(inst.runDatabaseBackup).not.toHaveBeenCalled();
    await databaseBackup(args(['database', 'backup', '--instance', 'prod', '--database', 'db-1', '--apply']), deps);
    expect(inst.runDatabaseBackup).toHaveBeenCalledWith('db-1', 'bk-1');
  });

  it('deployment cancel: no-op on a finished deployment, dry-run otherwise, cancels with --apply', async () => {
    const inst = instanceClient({
      getDeployment: vi.fn().mockResolvedValueOnce({ deployment_uuid: 'd', status: 'finished' }).mockResolvedValue({ deployment_uuid: 'd', status: 'in_progress' }),
      cancelDeployment: vi.fn().mockResolvedValue({ message: 'Deployment cancelled successfully.', status: 'cancelled-by-user' }),
    });
    const { deps, audits } = makeDeps(appTarget, targetClient(), inst);
    await deploymentCancelCmd(args(['deployment', 'cancel', 'd', '--instance', 'prod', '--apply']), deps);
    expect(inst.cancelDeployment).not.toHaveBeenCalled();
    await deploymentCancelCmd(args(['deployment', 'cancel', 'd', '--instance', 'prod']), deps);
    expect(inst.cancelDeployment).not.toHaveBeenCalled();
    await deploymentCancelCmd(args(['deployment', 'cancel', 'd', '--instance', 'prod', '--apply']), deps);
    expect(inst.cancelDeployment).toHaveBeenCalledWith('d');
    expect(audits[0]).toMatchObject({ action: 'deployment.cancel', resourceKind: 'deployment', resourceUuid: 'd' });
  });

  it('status --json redacts webhook secrets and compose literals', async () => {
    await statusCmd(args(['status', '--app', 'web', '--json']), makeDeps(appTarget, targetClient()).deps);
    expect(stdout()).not.toMatch(PLANTED);
    expect(JSON.parse(stdout()).app.name).toBe('my-api');
  });

  it('instance info reports version and health', async () => {
    await instanceInfo(args(['instance', 'info', '--instance', 'prod']), makeDeps(appTarget, targetClient()).deps);
    expect(stdout()).toContain('Coolify 4.5.0, health OK');
  });

  it('server patch / reboot / instance upgrade say plainly that the API has no such endpoint', async () => {
    for (const cmd of [['server', 'patch'], ['server', 'reboot'], ['instance', 'upgrade']]) {
      const e = await notInApi(args(cmd)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(CoolifyFeatureNotSupportedError);
      expect((e as Error).message).toMatch(/not exposed by the Coolify API/);
      expect(errorToExitCode(e)).toBe(2);
    }
  });
});
