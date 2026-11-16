import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli/args.js';
import { main, errorToExitCode } from '../src/cli/main.js';
import { flagSet } from '../src/cli/dispatch.js';
import { envApply, envDiff, envDelete, envList } from '../src/cli/commands/env.js';
import { deployCmd } from '../src/cli/commands/deploy.js';
import { statusCmd } from '../src/cli/commands/status.js';
import { logsCmd } from '../src/cli/commands/logs.js';
import { deploymentsCmd } from '../src/cli/commands/deployments.js';
import { instanceInfo, serverGet } from '../src/cli/commands/instance.js';
import { configDoctor } from '../src/cli/commands/config-doctor.js';
import { HELP } from '../src/cli/commands/help.js';
import { BulkResponseSchema, type EnvVar, type EnvWriteItem } from '../src/client/schemas.js';
import { planEnvWrite } from '../src/client/safe-write.js';
import {
  CoolifyAuthError, CoolifyContractError, CoolifyFeatureNotSupportedError, CoolifyNetworkError, CoolifyNotFoundError,
  InvalidInputError, UsageError,
} from '../src/errors/index.js';
import { HARNESS_VERSION, TESTED_COOLIFY } from '../src/version.js';
import type { CmdDeps } from '../src/cli/deps.js';
import type { AuditRecord } from '../src/client/safe-write.js';
import type { ResolvedTarget } from '../src/config/schema.js';

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/v4.7/${name}`, import.meta.url)), 'utf8'));
const CONFIG = fileURLToPath(new URL('./fixtures/config/basic.config.ts', import.meta.url));
const SECRET = 'sup3r-s3cret-value';

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
/** stdout must be exactly ONE JSON document. */
const oneJson = (): Record<string, unknown> => {
  const text = stdout();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  expect(text.trimEnd()).toBe(JSON.stringify(parsed, null, 2));
  return parsed;
};

const appTarget: ResolvedTarget = { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1', token: 't' };
const svcTarget: ResolvedTarget = { ...appTarget, kind: 'service', uuid: 'svc-1' };
const row = (key: string, value: string, over: Partial<EnvVar> = {}): EnvVar => ({
  uuid: `env-${key}-${over.is_preview ? 'pv' : 'prod'}`, key, value, value_hidden: false, value_null: false, is_preview: false,
  is_build_time: true, is_literal: false, is_multiline: false, is_shown_once: false, ...over,
});

function fakeCoolify(initial: EnvVar[]) {
  let rows = initial.map((r) => ({ ...r }));
  return {
    rows: () => rows,
    listEnvs: vi.fn(async () => rows.map((r) => ({ ...r }))),
    upsertEnvs: vi.fn(async (items: EnvWriteItem[]) => {
      for (const item of items) {
        const hit = rows.find((r) => r.key === item.key && r.is_preview === (item.is_preview ?? false));
        if (hit) hit.value = item.value;
        else rows = [...rows, row(item.key, item.value, { is_preview: item.is_preview ?? false })];
      }
      return rows;
    }),
    deleteEnv: vi.fn(async (uuid: string) => { rows = rows.filter((r) => r.uuid !== uuid); return { message: 'Environment variable deleted.' }; }),
    get: vi.fn(async () => fx('application.json')),
    getService: vi.fn(async () => fx('service.json')),
    deploy: vi.fn(async () => ({ message: 'Deployment request queued.', deploymentUuid: 'dep-1' })),
    restart: vi.fn(async () => ({ message: 'Restart request queued.' })),
    getLatestDeployment: vi.fn(async () => fx('deployment.json')),
    getDeployment: vi.fn(async () => fx('deployment.json')),
    listDeployments: vi.fn(async () => (fx('deployments-for-app.json') as { deployments: unknown[] }).deployments),
    waitForDeployment: vi.fn(async () => ({ deployment_uuid: 'dep-1', status: 'finished', logs: 'x'.repeat(5000) })),
    getRuntimeLogs: vi.fn(async () => ({ logs: 'runtime line' })),
  };
}

function deps(api: ReturnType<typeof fakeCoolify>, target: ResolvedTarget = appTarget, over: Partial<CmdDeps> = {}): { deps: CmdDeps; audits: AuditRecord[] } {
  const audits: AuditRecord[] = [];
  return {
    audits,
    deps: {
      resolveTargetFor: () => target,
      clientFactory: () => api as unknown as ReturnType<CmdDeps['clientFactory']>,
      actor: 'test',
      auditSink: vi.fn(async (r: AuditRecord) => { audits.push(r); }),
      now: () => new Date('2026-11-16T00:00:00Z'),
      ...over,
    },
  };
}

describe('--json prints exactly one document, and never an env value', () => {
  it('env diff --json redacts desired values AND live duplicate values (they were printed in clear)', async () => {
    const api = fakeCoolify([row('A', 'live-secret-one'), { ...row('A', 'live-secret-two'), uuid: 'dup' }, row('B', 'same')]);
    const code = await envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', `A=${SECRET}`, '--set', `NEW=${SECRET}`, '--set', 'B=same', '--json']), deps(api).deps);
    expect(code).toBe(0);
    const doc = oneJson();
    expect(stdout()).not.toMatch(/sup3r|live-secret/);
    expect(doc['creates']).toEqual([{ key: 'NEW', value: '[REDACTED] (18 chars)' }]);
    expect((doc['duplicateKeyDrift'] as Array<{ key: string; values: string[] }>)[0]).toEqual({ key: 'A', values: ['[REDACTED] (15 chars)', '[REDACTED] (15 chars)'] });
    expect(doc['unchanged']).toEqual(['B']);
  });

  it('env apply --json (dry-run) is one document with dryRun / applied / confirmed and no prose', async () => {
    const api = fakeCoolify([row('A', '1')]);
    await envApply(parseArgs(['env', 'apply', '--app', 'web', '--set', `A=${SECRET}`, '--json']), deps(api).deps);
    const doc = oneJson();
    expect(doc).toMatchObject({ scope: 'production', dryRun: true, applied: [], confirmed: null });
    expect(stdout()).not.toContain(SECRET);
    expect(api.upsertEnvs).not.toHaveBeenCalled();
  });

  it('env apply --apply --json reports applied keys and confirmation in the same document', async () => {
    const api = fakeCoolify([row('A', '1')]);
    await envApply(parseArgs(['env', 'apply', '--app', 'web', '--set', `A=${SECRET}`, '--set', 'B=2', '--apply', '--json']), deps(api).deps);
    expect(oneJson()).toMatchObject({ dryRun: false, applied: ['B', 'A'], confirmed: true });
    expect(stdout()).not.toContain(SECRET);
  });

  it('env delete --apply --json is one document including deleted / confirmed', async () => {
    const api = fakeCoolify([row('OLD', 'x'), row('KEEP', 'y')]);
    const d = deps(api);
    expect(await envDelete(parseArgs(['env', 'delete', '--app', 'web', '--key', 'OLD', '--apply', '--json']), d.deps)).toBe(0);
    expect(oneJson()).toMatchObject({ dryRun: false, scope: 'prod', delete: [{ key: 'OLD', uuid: 'env-OLD-prod' }], deleted: 1, confirmed: true });
    expect(d.audits[0]).toMatchObject({ action: 'env.delete', keysAffected: ['OLD'], outcome: 'success' });
  });

  it('deploy --wait --json --no-logs drops the build log and says how big it was', async () => {
    const api = fakeCoolify([]);
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json', '--no-logs']), deps(api).deps)).toBe(0);
    const doc = oneJson();
    expect(doc['finalStatus']).toBe('finished');
    expect(doc['finalDeployment']).toEqual({ deployment_uuid: 'dep-1', status: 'finished', logs_length: 5000 });
  });

  it('deployments / status --no-logs keep every field but logs', async () => {
    const api = fakeCoolify([]);
    await deploymentsCmd(parseArgs(['deployments', '--app', 'web', '--json', '--no-logs']), deps(api).deps);
    const list = JSON.parse(stdout()) as Array<Record<string, unknown>>;
    expect(list[0]!['deployment_uuid']).toBe('dep-finished-1');
    expect('logs' in list[0]!).toBe(false);
    expect(typeof list[0]!['logs_length']).toBe('number');
    out = [];
    await statusCmd(parseArgs(['status', '--app', 'web', '--json', '--no-logs']), deps(api).deps);
    const latest = (oneJson()['latestDeployment'] as Record<string, unknown>);
    expect('logs' in latest).toBe(false);
    out = [];
    await statusCmd(parseArgs(['status', '--app', 'web', '--json']), deps(api).deps);
    expect('logs' in (oneJson()['latestDeployment'] as Record<string, unknown>)).toBe(true); // default shape unchanged
  });
});

describe('errors are precise and machine-readable', () => {
  it('with --json, a failure is one JSON document on stderr with the error code and exit code', async () => {
    const code = await main(['status', '--app', 'nope', '--json', '--config', CONFIG]);
    expect(code).toBe(2);
    expect(stdout()).toBe('');
    const doc = JSON.parse(stderr()) as { error: Record<string, unknown> };
    expect(doc.error).toMatchObject({ code: 'CONFIG', exitCode: 2 });
    expect(String(doc.error['message'])).toContain("Unknown target 'nope'. Known targets: my-api");
  });

  it('a missing token is exit 5 and names the env var, never a value', async () => {
    const saved = process.env['COOLIFY_PROD_TOKEN'];
    delete process.env['COOLIFY_PROD_TOKEN'];
    try {
      expect(await main(['status', '--app', 'my-api', '--json', '--config', CONFIG])).toBe(5);
      expect((JSON.parse(stderr()) as { error: Record<string, unknown> }).error).toMatchObject({ code: 'MISSING_TOKEN', exitCode: 5 });
    } finally {
      if (saved !== undefined) process.env['COOLIFY_PROD_TOKEN'] = saved;
    }
  });

  it('a usage error is prose without --json and JSON with it, exit 2 either way', async () => {
    expect(await main(['status', '--nope'])).toBe(2);
    expect(stderr()).toBe('usage error: Unknown flag: --nope\n');
    err = [];
    expect(await main(['status', '--nope', '--json'])).toBe(2);
    expect(JSON.parse(stderr())).toEqual({ error: { code: 'USAGE', message: 'Unknown flag: --nope', exitCode: 2 } });
  });

  it('a command-level usage problem follows the same contract', async () => {
    const api = fakeCoolify([]);
    expect(await serverGet(parseArgs(['server', 'get', '--instance', 'prod', '--json']), deps(api).deps)).toBe(2);
    expect((JSON.parse(stderr()) as { error: { code: string } }).error.code).toBe('USAGE');
    err = [];
    expect(await logsCmd(parseArgs(['logs', '--json']), deps(api).deps)).toBe(2);
    expect((JSON.parse(stderr()) as { error: { message: string } }).error.message).toBe('logs: --app <name> is required');
  });

  it('a missing config file is a config error (exit 2) that says what to do', async () => {
    expect(await main(['status', '--app', 'x', '--config', '/nonexistent/coolify-harness.config.ts'])).toBe(2);
    expect(stderr()).toContain('Config file not found: /nonexistent/coolify-harness.config.ts');
  });

  it('maps every error class to its documented exit code', () => {
    expect(errorToExitCode(new UsageError('x'))).toBe(2);
    expect(errorToExitCode(new InvalidInputError('x', { issues: [] }))).toBe(2);
    expect(errorToExitCode(new CoolifyFeatureNotSupportedError('x'))).toBe(2);
    expect(errorToExitCode(new CoolifyAuthError('x', { status: 401 }))).toBe(5);
    expect(errorToExitCode(new CoolifyNetworkError('x', { reason: 'timeout' }))).toBe(1);
    expect(errorToExitCode(new CoolifyNotFoundError('x'))).toBe(1);
    expect(errorToExitCode(new CoolifyContractError('x', { zodIssues: '' }))).toBe(1);
    expect(errorToExitCode(Object.assign(new Error('x'), { name: 'ZodError' }))).toBe(2);
  });
});

describe('argument parsing protects the agent from itself', () => {
  it('a value flag followed by another flag is a missing value, not a target named --json', () => {
    expect(() => parseArgs(['status', '--app', '--json'])).toThrow(/Missing value for --app/);
    expect(parseArgs(['env', 'diff', '--app', 'web', '--set=K=--x']).set).toEqual({ K: '--x' });
  });

  it('never echoes a stray argument or a malformed --set (it may be a secret)', () => {
    for (const argv of [['env', 'apply', '--app', 'web', '--set', 'KEY=', SECRET], ['env', 'apply', '--app', 'web', '--set', SECRET]]) {
      let message = '';
      try { parseArgs(argv); } catch (e) { message = (e as Error).message; }
      expect(message).not.toBe('');
      expect(message).not.toContain(SECRET);
    }
  });

  it('suggests the command the agent probably meant', () => {
    expect(() => parseArgs(['env', 'show'])).toThrow(/Did you mean `env diff`, `env apply`, `env list`, `env delete`\?/);
    expect(() => parseArgs(['stauts', '--app', 'web'])).toThrow(/Did you mean `status`\?/);
    expect(() => parseArgs(['deploy', '--apply', '--dry-run'])).toThrow(/contradict/);
    expect(() => parseArgs(['status', '--json=yes'])).toThrow(/--json does not take a value/);
  });

  it('--version and help answer without a config', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(stdout()).toBe(`coolify-harness ${HARNESS_VERSION} (Coolify API tested on ${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})\n`);
    out = [];
    expect(await main(['--version', '--json'])).toBe(0);
    expect(JSON.parse(stdout())).toEqual({ name: 'coolify-harness', version: HARNESS_VERSION, testedCoolify: TESTED_COOLIFY });
    out = [];
    expect(await main(['env', 'diff', '--help'])).toBe(0);
    expect(stdout()).toBe(HELP);
  });

  it('the help text documents every command and every exit code', () => {
    for (const cmd of ['config doctor', 'status', 'env list', 'env diff', 'env apply', 'env delete', 'flag set', 'deploy', 'logs', 'deployments', 'deployment cancel',
      'compose get', 'compose set', 'instance info', 'servers', 'server get', 'proxy get', 'proxy set', 'proxy restart', 'databases', 'database get', 'database set',
      'database backups', 'database backup', 'catalog gen', 'catalog check']) {
      expect(HELP, cmd).toContain(cmd);
    }
    for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8]) expect(HELP).toMatch(new RegExp(`\\b${code} `));
    expect(HELP).not.toMatch(/\bnpm\b|\bnpx\b/);
  });
});

describe('safety: nothing changes behind a dry-run', () => {
  it('flag set --redeploy without --apply does NOT deploy (it used to)', async () => {
    const api = fakeCoolify([row('FLAG', 'off')]);
    const d = deps(api);
    expect(await flagSet(parseArgs(['flag', 'set', '--app', 'web', '--set', 'FLAG=on', '--redeploy']), d.deps)).toBe(0);
    expect(api.upsertEnvs).not.toHaveBeenCalled();
    expect(api.deploy).not.toHaveBeenCalled();
    expect(d.audits).toEqual([]);
    expect(stdout()).toContain('--redeploy skipped: this was a dry-run');
  });

  it('flag set --apply --redeploy --json writes, deploys, and prints ONE document', async () => {
    const api = fakeCoolify([row('FLAG', 'off')]);
    const d = deps(api);
    expect(await flagSet(parseArgs(['flag', 'set', '--app', 'web', '--set', 'FLAG=on', '--apply', '--redeploy', '--json']), d.deps)).toBe(0);
    const doc = oneJson();
    expect(doc).toMatchObject({ dryRun: false, applied: ['FLAG'], confirmed: true, deploy: { action: 'deploy', deploymentUuid: 'dep-1' } });
    expect(d.audits.map((a) => a.action)).toEqual(['env.apply', 'deploy']);
  });

  it('deploy --dry-run sends nothing and audits nothing', async () => {
    const api = fakeCoolify([]);
    const d = deps(api);
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--force', '--dry-run', '--json']), d.deps)).toBe(0);
    expect(oneJson()).toMatchObject({ dryRun: true, action: 'deploy', force: true, target: { name: 'web', kind: 'application', uuid: 'app-1' } });
    expect(api.deploy).not.toHaveBeenCalled();
    expect(d.audits).toEqual([]);
  });

  it('--preview on a service is refused before any request: Coolify would write the production row', async () => {
    const api = fakeCoolify([row('A', '1')]);
    for (const run of [
      () => envDiff(parseArgs(['env', 'diff', '--app', 'svc', '--set', 'A=2', '--preview']), deps(api, svcTarget).deps),
      () => envApply(parseArgs(['env', 'apply', '--app', 'svc', '--set', 'A=2', '--preview', '--apply']), deps(api, svcTarget).deps),
      () => envDelete(parseArgs(['env', 'delete', '--app', 'svc', '--key', 'A', '--preview', '--apply']), deps(api, svcTarget).deps),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(CoolifyFeatureNotSupportedError);
    }
    expect(api.listEnvs).not.toHaveBeenCalled();
    expect(api.upsertEnvs).not.toHaveBeenCalled();
    expect(api.deleteEnv).not.toHaveBeenCalled();
  });

  it('a failing audit log never turns a done mutation into a failure (the agent would redo it)', async () => {
    const api = fakeCoolify([]);
    const d = deps(api, appTarget, { auditSink: vi.fn(async () => { throw new Error('EROFS: read-only file system'); }) });
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web']), d.deps)).toBe(0);
    expect(api.deploy).toHaveBeenCalledTimes(1);
    expect(stderr()).toContain('WARNING: audit record for deploy (success) could not be written: EROFS');
  });

  it('a failed confirmation read after a successful write is "applied, not confirmed", not a failed write', async () => {
    const api = fakeCoolify([row('A', '1')]);
    api.listEnvs.mockResolvedValueOnce([row('A', '1')]).mockRejectedValueOnce(new CoolifyNetworkError('Cannot reach Coolify', { reason: 'ECONNRESET' }));
    const d = deps(api);
    expect(await envApply(parseArgs(['env', 'apply', '--app', 'web', '--set', 'A=2', '--apply', '--json']), d.deps)).toBe(0);
    expect(oneJson()).toMatchObject({ dryRun: false, applied: ['A'], confirmed: false, confirmError: 'Cannot reach Coolify' });
    expect(d.audits[0]).toMatchObject({ outcome: 'success', options: { scope: 'production', confirmed: false } });
  });
});

describe('env planning on real-world rows', () => {
  it('duplicates that already hold the desired value are unchanged (a diff used to never come back clean)', () => {
    const plan = planEnvWrite([row('A', 'v'), { ...row('A', 'v'), uuid: 'dup' }], { values: { A: 'v' } });
    expect(plan).toMatchObject({ updates: [], unchanged: ['A'], duplicateKeyDrift: [] });
    expect(plan.warnings[0]!.kind).toBe('duplicate-key-repair');
  });

  it('--fail-on-changes exits 4 only when something would be written', async () => {
    const api = fakeCoolify([row('A', '1')]);
    expect(await envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', 'A=1', '--fail-on-changes']), deps(api).deps)).toBe(0);
    expect(await envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', 'A=2', '--fail-on-changes']), deps(api).deps)).toBe(4);
  });

  it('a value update keeps the flags the row has set (Coolify 4.5 reset omitted flags)', () => {
    const rows = BulkResponseSchema.parse(fx('envs-locked.json'));
    const plan = planEnvWrite(rows, { values: { JWT_PRIVATE_KEY: 'new-pem', LITERAL_DOLLAR: 'new$', NODE_ENV: 'staging' } });
    expect(plan.updates).toEqual([
      { key: 'JWT_PRIVATE_KEY', value: 'new-pem', is_multiline: true },
      { key: 'LITERAL_DOLLAR', value: 'new$', is_literal: true },
      { key: 'NODE_ENV', value: 'staging' },
    ]);
  });

  it('a locked (shown-once) row is not a scope problem: it is rewritten with a warning and stays locked', async () => {
    const rows = BulkResponseSchema.parse(fx('envs-locked.json'));
    const api = fakeCoolify(rows);
    await envApply(parseArgs(['env', 'apply', '--app', 'web', '--set', 'STRIPE_SECRET=sk_live_x', '--set', 'NODE_ENV=production', '--apply', '--json']), deps(api).deps);
    const doc = oneJson();
    expect(api.upsertEnvs).toHaveBeenCalledWith([{ key: 'STRIPE_SECRET', value: 'sk_live_x', is_shown_once: true }]);
    expect((doc['warnings'] as Array<{ kind: string }>)[0]!.kind).toBe('locked-value');
    expect(doc['unchanged']).toEqual(['NODE_ENV']);
    expect(doc['confirmed']).toBe(true);
    out = [];
    await envList(parseArgs(['env', 'list', '--app', 'web']), deps(api).deps);
    expect(stdout()).toMatch(/STRIPE_SECRET {2}\[prod\] {2}len=locked/);
    expect(stdout()).not.toContain('read:sensitive');
  });

  it('env delete asks for the delete ability Coolify 4.7 requires', async () => {
    const api = fakeCoolify([row('OLD', 'x')]);
    api.deleteEnv.mockRejectedValue(new CoolifyAuthError('Coolify auth failed (403)', { status: 403, serverMessage: 'Missing required permissions: delete' }));
    const d = deps(api);
    const e = await envDelete(parseArgs(['env', 'delete', '--app', 'web', '--key', 'OLD', '--apply']), d.deps).catch((x: unknown) => x);
    expect(errorToExitCode(e)).toBe(5);
    expect((e as Error).message).toContain("needs a token with 'delete'");
    expect((e as Error).message).toContain('Missing required permissions: delete');
    expect(d.audits[0]).toMatchObject({ action: 'env.delete', outcome: 'failure' });
  });

  it('a missing --from-file is a usage error and costs no request', async () => {
    const api = fakeCoolify([]);
    const d = deps(api, appTarget, { readFile: vi.fn(async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); }) });
    await expect(envDiff(parseArgs(['env', 'diff', '--app', 'web', '--from-file', '.env.missing']), d.deps)).rejects.toThrow(/Cannot read --from-file \.env\.missing \(ENOENT\)/);
    expect(api.listEnvs).not.toHaveBeenCalled();
  });
});

describe('status', () => {
  it('reads the resource and the latest deployment concurrently', async () => {
    const api = fakeCoolify([]);
    let inFlight = 0; let peak = 0;
    const slow = async <T>(v: T): Promise<T> => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return v; };
    api.get.mockImplementation(() => slow(fx('application.json')));
    api.getLatestDeployment.mockImplementation(() => slow(fx('deployment.json')));
    await statusCmd(parseArgs(['status', '--app', 'web', '--json']), deps(api).deps);
    expect(peak).toBe(2);
  });

  it('does not hide a contract error on the latest deployment behind "none found"', async () => {
    const api = fakeCoolify([]);
    api.getLatestDeployment.mockRejectedValue(new CoolifyContractError('Coolify response (listDeployments[0]) failed contract validation: status: expected string', { zodIssues: '' }));
    expect(await statusCmd(parseArgs(['status', '--app', 'web', '--json']), deps(api).deps)).toBe(0);
    expect(oneJson()).toMatchObject({ latestDeployment: null, latestDeploymentError: expect.stringContaining('failed contract validation') as unknown });
    expect(stderr()).toContain('could not read the latest deployment');
  });

  it('an auth failure on the latest deployment still fails the command', async () => {
    const api = fakeCoolify([]);
    api.getLatestDeployment.mockRejectedValue(new CoolifyAuthError('Coolify auth failed (401)', { status: 401 }));
    await expect(statusCmd(parseArgs(['status', '--app', 'web']), deps(api).deps)).rejects.toBeInstanceOf(CoolifyAuthError);
  });
});

describe('logs --build', () => {
  it('uses the log already embedded in the list row instead of fetching the deployment again', async () => {
    const api = fakeCoolify([]);
    expect(await logsCmd(parseArgs(['logs', '--app', 'web', '--build', '--json']), deps(api).deps)).toBe(0);
    expect(api.getLatestDeployment).toHaveBeenCalledTimes(1);
    expect(api.getDeployment).not.toHaveBeenCalled();
    expect(oneJson()).toMatchObject({ type: 'build', deployment_uuid: 'dep-finished-1', status: 'finished' });
  });
});

describe('compatibility with the live Coolify version', () => {
  const inst = (version: string) => ({
    instanceUrl: 'https://c', getVersion: vi.fn(async () => version), getHealth: vi.fn(async () => 'OK'),
  });
  const withInstance = (version: string): CmdDeps => ({
    ...deps(fakeCoolify([])).deps,
    instanceFor: () => ({ name: 'prod', client: inst(version) as unknown as NonNullable<ReturnType<NonNullable<CmdDeps['instanceFor']>>>['client'] }),
  });

  it('instance info says "tested" inside the range, with no warning', async () => {
    expect(await instanceInfo(parseArgs(['instance', 'info', '--instance', 'prod', '--json']), withInstance(TESTED_COOLIFY.max))).toBe(0);
    expect(oneJson()).toEqual({ instance: 'prod', url: 'https://c', version: TESTED_COOLIFY.max, health: 'OK', compatibility: 'tested', testedCoolify: TESTED_COOLIFY });
    expect(stderr()).toBe('');
  });

  it('instance info WARNS (stderr + JSON, exit 0) when Coolify is newer or older than the tested range', async () => {
    expect(await instanceInfo(parseArgs(['instance', 'info', '--instance', 'prod', '--json']), withInstance('4.9.0'))).toBe(0);
    expect(oneJson()).toMatchObject({ version: '4.9.0', compatibility: 'newer', warning: expect.stringContaining('newer than the range') as unknown });
    expect(stderr()).toContain('WARNING: Coolify 4.9.0 is newer than the range');
    out = []; err = [];
    expect(await instanceInfo(parseArgs(['instance', 'info', '--instance', 'prod']), withInstance('4.3.16'))).toBe(0);
    expect(stdout()).toContain('OUTSIDE the tested range');
    expect(stderr()).toContain('older than the range');
  });

  it('config doctor checks every instance that has a token, reports the version, and warns outside the range', async () => {
    const getVersion = vi.fn(async () => '4.8.1');
    const code = await configDoctor(parseArgs(['config', 'doctor', '--json', '--config', CONFIG]), { env: { COOLIFY_PROD_TOKEN: 'tok' }, getVersion });
    expect(code).toBe(0);
    const doc = oneJson();
    expect(doc).toMatchObject({ ok: true, harness: HARNESS_VERSION, offline: false });
    expect((doc['instances'] as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'prod', tokenPresent: true, reachable: true, version: '4.8.1', compatibility: 'newer' });
    expect(stdout()).not.toContain('"tok"');
    expect(stderr()).toContain('WARNING [prod]: Coolify 4.8.1 is newer');
    expect(getVersion).toHaveBeenCalledWith({ instanceUrl: 'https://coolify.example.com', token: 'tok' });
  });

  it('config doctor without a token reports it and stays exit 0; naming the target makes it exit 5', async () => {
    const getVersion = vi.fn();
    expect(await configDoctor(parseArgs(['config', 'doctor', '--config', CONFIG]), { env: {}, getVersion })).toBe(0);
    expect(stdout()).toContain('token COOLIFY_PROD_TOKEN: MISSING');
    expect(getVersion).not.toHaveBeenCalled();
    out = []; err = [];
    expect(await configDoctor(parseArgs(['config', 'doctor', '--app', 'my-api', '--config', CONFIG]), { env: {}, getVersion })).toBe(5);
    expect(stderr()).toContain("Env var 'COOLIFY_PROD_TOKEN' (token for instance 'prod') is not set");
  });

  it('config doctor --offline never calls Coolify; a rejected token fails the named target with exit 5', async () => {
    const getVersion = vi.fn(async () => { throw new CoolifyAuthError('Coolify auth failed (401) — Unauthenticated.', { status: 401 }); });
    expect(await configDoctor(parseArgs(['config', 'doctor', '--offline', '--app', 'my-api', '--config', CONFIG]), { env: { COOLIFY_PROD_TOKEN: 'tok' }, getVersion })).toBe(0);
    expect(getVersion).not.toHaveBeenCalled();
    expect(stdout()).toContain("Target 'my-api' resolves and its token is present.");
    out = []; err = [];
    expect(await configDoctor(parseArgs(['config', 'doctor', '--app', 'my-api', '--json', '--config', CONFIG]), { env: { COOLIFY_PROD_TOKEN: 'tok' }, getVersion })).toBe(5);
    expect(oneJson()).toMatchObject({ ok: false });
  });
});
