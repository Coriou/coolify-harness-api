import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { linkSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli/args.js';
import { main } from '../src/cli/main.js';
import { flagSet } from '../src/cli/dispatch.js';
import { beginRun } from '../src/cli/output-state.js';
import { describePath, parseDotenv, readTokenFiles } from '../src/cli/dotenv.js';
import { defaultWriteFile } from '../src/cli/deps.js';
import { deployCmd } from '../src/cli/commands/deploy.js';
import { envApply, envDelete } from '../src/cli/commands/env.js';
import { composeSet } from '../src/cli/commands/compose.js';
import { proxySet } from '../src/cli/commands/proxy.js';
import { countHiddenAdditions, printableDiffLine } from '../src/client/compose.js';
import { configDoctor } from '../src/cli/commands/config-doctor.js';
import { deploymentsCmd, withoutLogs } from '../src/cli/commands/deployments.js';
import { CoolifyClient } from '../src/client/coolify.js';
import { waitForDeployment } from '../src/client/wait.js';
import { CircuitBreaker, httpRequest } from '../src/client/http.js';
import { resolveInstance, resolveTarget } from '../src/config/load.js';
import { noopLogger } from '../src/logging/index.js';
import type { Deployment, EnvVar } from '../src/client/schemas.js';
import { ConfigError, CoolifyNetworkError, CoolifyRequestError, CoolifyWaitTimeoutError, UsageError } from '../src/errors/index.js';
import type { CmdDeps } from '../src/cli/deps.js';
import type { AuditRecord } from '../src/client/safe-write.js';
import type { ResolvedTarget } from '../src/config/schema.js';

const CONFIG = fileURLToPath(new URL('./fixtures/config/basic.config.ts', import.meta.url));
const TOKEN = '7|tok3nAAAA1111bbbb2222cccc3333dddd4444eeee';

let out: string[];
let err: string[];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
beforeEach(() => {
  out = []; err = [];
  beginRun(false);
  process.stdout.write = ((c: string | Uint8Array) => { out.push(String(c)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => { err.push(String(c)); return true; }) as typeof process.stderr.write;
});
afterEach(() => { process.stdout.write = realOut; process.stderr.write = realErr; });
const stdout = (): string => out.join('');
const stderr = (): string => err.join('');
const oneJson = (): Record<string, unknown> => JSON.parse(stdout()) as Record<string, unknown>;

let dir: string;
beforeAll(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'coolify-harness-round3-'))); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const appTarget: ResolvedTarget = { instanceUrl: 'https://c.example', kind: 'application', uuid: 'app-1', token: 't' };
const svcTarget: ResolvedTarget = { ...appTarget, kind: 'service', uuid: 'svc-1' };
const httpOpts = (fetchImpl: unknown, maxRetries = 3) => ({
  fetchImpl: fetchImpl as never, logger: noopLogger(), maxRetries, sleep: async () => {},
  breaker: new CircuitBreaker({ failureThreshold: 50, resetTimeoutMs: 1000 }),
});
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
const usageMessage = (argv: string[]): string => {
  try {
    parseArgs(argv);
  } catch (e) {
    expect(e).toBeInstanceOf(UsageError);
    return (e as Error).message;
  }
  throw new Error(`parsed without error: ${argv.join(' ')}`);
};

describe('--help wins; --version stands alone', () => {
  it('--version next to a command never runs the command (it deployed) and is not a success either', async () => {
    for (const argv of [['deploy', '--app', 'web', '--version'], ['-v', 'deploy', '--app', 'web'], ['deployment', 'cancel', 'dep-1', '--app', 'web', '--apply', '--version'], ['env', 'apply', '--app', 'web', '--set', 'A=1', '--apply', '-v']]) {
      expect(usageMessage(argv)).toMatch(/--version \(-v\) stands alone.*Nothing was run/);
    }
    // Exit 2 before the config is even looked for.
    expect(await main(['deploy', '--app', 'web', '--version', '--config', join(dir, 'does-not-exist.ts')])).toBe(2);
    expect(stdout()).toBe('');
    out = []; err = [];
    // Global flags are fine next to it: a wrapper script adds `--token-file .env` or `--config`.
    for (const argv of [['--version'], ['-v'], ['--version', '--json'], ['--config', 'x.config.ts', '--version'], ['--token-file', '.env', '-v'], ['--token-file=.env', '--version', '--json']]) {
      expect(parseArgs(argv)).toMatchObject({ command: 'help', version: true });
    }
    expect(usageMessage(['--version', '--apply'])).toMatch(/stands alone/);
    expect(await main(['--version'])).toBe(0);
    expect(stdout()).toMatch(/^coolify-harness \d+\.\d+\.\d+ /);
  });

  it('--help wins over a flag that is missing its value, and keeps --json', async () => {
    expect(parseArgs(['status', '--app', '--help']).command).toBe('help');
    expect(parseArgs(['deploy', '--app', 'web', '--apply', '-h', '--json'])).toMatchObject({ command: 'help', json: true, apply: false });
    expect(await main(['status', '--app', '--help', '--json'])).toBe(0);
    expect(oneJson()['commands']).toContain('deploy');
  });
});

describe('the parser', () => {
  it('prototype names are not commands, targets, instances or variables', async () => {
    for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(usageMessage([word])).toMatch(/Unknown command/);
    const registry = { instances: { prod: { url: 'https://c.example', tokenEnv: 'T' } }, targets: { web: { instance: 'prod', kind: 'application' as const, uuid: 'u' } } };
    expect(() => resolveTarget(registry, 'constructor', { T: 't' })).toThrow(ConfigError);
    expect(() => resolveInstance(registry, 'toString', { T: 't' })).toThrow(ConfigError);
    expect(usageMessage(['env', 'apply', '--app', 'web', '--set', '__proto__=x'])).toMatch(/__proto__ cannot be used/);
    expect(() => parseDotenv('A=1\n__proto__=x\n')).toThrow(/line 2: __proto__/);
    expect(await main(['constructor', '--json'])).toBe(2);
    expect(JSON.parse(stderr())).toMatchObject({ error: { code: 'USAGE', exitCode: 2 } });
  });

  it('numbers are plain digits within range; nothing typed after a flag is echoed back', () => {
    for (const bad of ['0x10', '1e3', '', '9999999999999', '-1', 'abc', 's3cr3t-AAAA1111']) {
      const message = usageMessage(['deployments', '--app', 'web', `--take=${bad}`]);
      expect(message).toMatch(/--take|Missing value/);
      if (bad.length > 3) expect(message).not.toContain(bad);
    }
    expect(usageMessage(['deployments', '--app', 'web', '--take', '0'])).toMatch(/from 1 to/);
    expect(usageMessage(['database', 'set', '--app', 'db', '--public-port', '99999'])).toMatch(/from 1024 to 65535/);
    expect(parseArgs(['deployments', '--app', 'web', '--take', '25', '--skip', '0'])).toMatchObject({ take: 25, skip: 0 });
    expect(usageMessage(['database', 'set', '--app', 'db', '--public', 's3cr3t-AAAA1111'])).not.toContain('s3cr3t');
    expect(usageMessage(['status', '--app', 'web', '--s3cr3t-AAAA1111bbbb'])).not.toContain('s3cr3t');
    expect(usageMessage(['status', '--app', 'web', '--bogus'])).toBe('Unknown flag: --bogus');
  });

  it('a mistyped flag with a value is an unknown flag; a switch given a value says so; an empty value is missing', () => {
    expect(usageMessage(['deployments', '--app', 'web', '--tak=5'])).toBe('Unknown flag: --tak');
    expect(usageMessage(['env', 'apply', '--app', 'web', '--apply=false'])).toBe('--apply does not take a value');
    expect(usageMessage(['status', '--app='])).toBe('Missing value for --app');
    expect(usageMessage(['status', '--config=', '--app', 'web'])).toBe('Missing value for --config');
  });

  it('two different deployment uuids are refused, not guessed', () => {
    expect(usageMessage(['deployment', 'cancel', 'dep-a', '--deployment', 'dep-b', '--app', 'web', '--apply'])).toMatch(/Two different deployment uuids/);
    expect(parseArgs(['deployment', 'cancel', 'dep-a', '--deployment', 'dep-a', '--app', 'web']).deployment).toBe('dep-a');
  });
});

describe('flag set', () => {
  it('a deploy switch that does not fit the target is refused BEFORE the variable is written', async () => {
    const client = { listEnvs: vi.fn(async () => []), upsertEnvs: vi.fn(async () => []), deploy: vi.fn() };
    const { deps, audits } = cmdDeps(client, svcTarget);
    await expect(flagSet(parseArgs(['flag', 'set', '--app', 'svc', '--set', 'NEWFLAG=on', '--apply', '--redeploy', '--force', '--json']), deps)).rejects.toThrow(/--force \(no-cache rebuild\) only exists for applications/);
    expect(client.listEnvs).not.toHaveBeenCalled();
    expect(client.upsertEnvs).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
    expect(stdout()).toBe('');
  });

  it('needs something to set: it is not a bare deploy', async () => {
    const client = { listEnvs: vi.fn(async () => []), deploy: vi.fn() };
    await expect(flagSet(parseArgs(['flag', 'set', '--app', 'web', '--redeploy', '--apply']), cmdDeps(client).deps)).rejects.toBeInstanceOf(UsageError);
    expect(client.deploy).not.toHaveBeenCalled();
  });
});

describe('token files', () => {
  it('a blank value in a later file does not erase the token an earlier one gave', async () => {
    const a = join(dir, 'a.env');
    const b = join(dir, 'b.env');
    writeFileSync(a, `COOLIFY_PROD_TOKEN="${TOKEN}"\nOTHER=1\n`);
    writeFileSync(b, 'COOLIFY_PROD_TOKEN=\nOTHER=2\n__proto__=x\n');
    const { vars, missing } = await readTokenFiles([a, b, join(dir, 'missing.env')]);
    expect(vars).toMatchObject({ COOLIFY_PROD_TOKEN: TOKEN, OTHER: '2' });
    expect(missing).toEqual([join(dir, 'missing.env')]);
  });

  it('a path is echoed only when it reads like one (a token pasted after --token-file is not)', async () => {
    expect(describePath('.env')).toBe('.env');
    expect(describePath('config/prod.env')).toBe('config/prod.env');
    expect(describePath(TOKEN)).toBe(`<${TOKEN.length}-character path>`);
    expect(describePath('abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toMatch(/^<40-character path>$/);
    expect(await configDoctor(parseArgs(['config', 'doctor', '--offline', '--instance', 'prod', '--json', '--config', CONFIG]), { env: {}, missingTokenFiles: [TOKEN, 'missing.env'] })).toBe(5);
    expect(stdout() + stderr()).not.toContain(TOKEN);
    expect(oneJson()['filesNotFound']).toEqual([`<${TOKEN.length}-character path>`, 'missing.env']);
  });
});

describe('env commands', () => {
  it('env delete --key NAME=value is refused without echoing the value', async () => {
    const client = { listEnvs: vi.fn() };
    expect(await envDelete(parseArgs(['env', 'delete', '--app', 'web', '--key', 'API_KEY=s3cr3t-AAAA1111bbbb2222', '--json']), cmdDeps(client).deps)).toBe(2);
    expect(stdout() + stderr()).not.toContain('s3cr3t');
    expect(client.listEnvs).not.toHaveBeenCalled();
  });

  it('env delete still finds a row whose name breaks today\'s rule (a legacy key with dashes)', async () => {
    const client = { listEnvs: vi.fn(async () => [row('MY-LEGACY-KEY', 'x')]), get: vi.fn(async () => ({ uuid: 'app-1', build_pack: 'nixpacks' })), deleteEnv: vi.fn() };
    expect(await envDelete(parseArgs(['env', 'delete', '--app', 'web', '--key', 'MY-LEGACY-KEY', '--json']), cmdDeps(client).deps)).toBe(0);
    expect(oneJson()).toMatchObject({ dryRun: true, delete: [{ key: 'MY-LEGACY-KEY' }], notFound: [] });
  });

  it('a key that is not found is echoed only when it reads like a name (a pasted token does not)', async () => {
    const client = { listEnvs: vi.fn(async () => [row('A', '1')]), get: vi.fn(async () => ({ uuid: 'app-1', build_pack: 'nixpacks' })) };
    const keys = ['A', 'MISSING_ONE', 'p@ss/w0rd!', 'glpat-s3cr3tAAAA1111bbbb', 'OLD-LEGACY-KEY'];
    expect(await envDelete(parseArgs(['env', 'delete', '--app', 'web', ...keys.flatMap((k) => ['--key', k]), '--json']), cmdDeps(client).deps)).toBe(0);
    expect(oneJson()['notFound']).toEqual(['MISSING_ONE', '<10-character key>', '<24-character key>', 'OLD-LEGACY-KEY']);
    expect(stdout()).not.toContain('p@ss');
    expect(stdout()).not.toContain('s3cr3t');
  });

  it('env apply --apply with nothing to write says so', async () => {
    const client = { listEnvs: vi.fn(async () => [row('A', '1')]), upsertEnvs: vi.fn() };
    expect(await envApply(parseArgs(['env', 'apply', '--app', 'web', '--set', 'A=1', '--apply']), cmdDeps(client).deps)).toBe(0);
    expect(stdout()).toContain('Nothing to write');
    expect(stdout()).not.toContain('Applied and confirmed');
    expect(client.upsertEnvs).not.toHaveBeenCalled();
  });
});

describe('--json keeps stderr for errors: an audit failure is in the document', () => {
  it('on success it is `auditError`; without --json it is a warning on stderr', async () => {
    const client = { deploy: vi.fn(async () => ({ message: 'Service starting request queued.' })) };
    const failing = { auditSink: vi.fn(async () => { throw new Error('EROFS: read-only file system'); }) };
    beginRun(true);
    expect(await deployCmd(parseArgs(['deploy', '--app', 'svc', '--json']), cmdDeps(client, svcTarget, failing).deps)).toBe(0);
    expect(stderr()).toBe('');
    expect(oneJson()['auditError']).toMatch(/audit record for deploy \(success\) could not be written: EROFS/);
    out = [];
    beginRun(false);
    expect(await deployCmd(parseArgs(['deploy', '--app', 'svc']), cmdDeps(client, svcTarget, failing).deps)).toBe(0);
    expect(stderr()).toMatch(/WARNING: audit record for deploy/);
  });
});

describe('deploy', () => {
  const dep = (status: string, uuid: string): Deployment => ({ deployment_uuid: uuid, status });

  it('SIGTERM during the wait ends like Ctrl-C: the document with the uuid, exit 130', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'queued', deploymentUuid: 'dep-9' })),
      getDeployment: vi.fn(async () => dep('queued', 'dep-9')),
      waitForDeployment: vi.fn((_uuid: string, opts: { signal: AbortSignal }) => new Promise<Deployment>((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => { reject(new Error('interrupted')); });
        process.emit('SIGTERM');
      })),
    };
    const before = process.listenerCount('SIGTERM');
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(130);
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-9', interrupted: true });
    expect(JSON.parse(stderr())).toMatchObject({ error: { code: 'INTERRUPTED', exitCode: 130, deploymentUuid: 'dep-9' } });
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('a wait that times out says what is still running and how to follow it', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'queued', deploymentUuid: 'dep-9' })),
      getDeployment: vi.fn(async () => dep('queued', 'dep-9')),
      waitForDeployment: vi.fn(async () => { throw new CoolifyWaitTimeoutError('dep-9', 3000, 'in_progress'); }),
    };
    const e = await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--timeout', '3', '--json']), cmdDeps(client).deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyWaitTimeoutError);
    expect((e as Error).message).toMatch(/--wait gave up after 3s: deployment dep-9 is still in_progress.*coolify-harness deployment dep-9 --app web/);
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-9', waitFailed: true });
  });

  it('--wait on a service says in the document that nothing was waited for', async () => {
    const client = { deploy: vi.fn(async () => ({ message: 'Service starting request queued.' })) };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'svc', '--wait', '--json']), cmdDeps(client, svcTarget).deps)).toBe(0);
    expect(oneJson()).toMatchObject({ waited: false, deploymentUuid: null });
    expect(String(oneJson()['note'])).toMatch(/creates no deployment record/);
    expect(stderr()).toBe('');
  });

  it('--no-logs leaves out the build log and the embedded application record', () => {
    const slim = withoutLogs({ deployment_uuid: 'd', status: 'finished', logs: 'x'.repeat(1000), application: { uuid: 'a', manual_webhook_secret_github: 'zzz' } } as Deployment);
    expect(slim).toEqual({ deployment_uuid: 'd', status: 'finished', logs_length: 1000 });
  });

  it('deployments --running needs no --instance', async () => {
    expect(parseArgs(['deployments', '--app', 'web', '--running']).running).toBe(true);
    expect(typeof deploymentsCmd).toBe('function');
  });
});

describe('document commands', () => {
  const service = (compose: string): Record<string, unknown> => ({ uuid: 'svc-1', docker_compose_raw: compose });
  const COMPOSE = 'services:\n  app:\n    image: nginx:1\n';

  it('compose set --from-file refuses a file that is not a compose document', async () => {
    const file = join(dir, 'empty.yml');
    writeFileSync(file, 'API_KEY=oops\n');
    const client = { getService: vi.fn(async () => service(COMPOSE)), updateServiceCompose: vi.fn() };
    await expect(composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--from-file', file, '--apply']), cmdDeps(client, svcTarget).deps)).rejects.toThrow(/no top-level `services:`/);
    expect(client.updateServiceCompose).not.toHaveBeenCalled();
  });

  it('compose set --apply --restart with nothing to save says the restart did not happen', async () => {
    const client = { getService: vi.fn(async () => service(COMPOSE)), updateServiceCompose: vi.fn(), restart: vi.fn() };
    expect(await composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--image', 'app=nginx:1', '--apply', '--restart', '--json']), cmdDeps(client, svcTarget).deps)).toBe(0);
    expect(oneJson()).toMatchObject({ changed: false, restart: null });
    expect(String(oneJson()['note'])).toMatch(/nothing changed.*not restarted.*deploy --app svc --restart --latest/);
    expect(client.restart).not.toHaveBeenCalled();
  });

  it('compose set says how many added lines the diff hides whole, and where to read them', async () => {
    const file = join(dir, 'hidden.yml');
    // A line the redactor hides whole (a PEM marker in a trailing comment), next to plain ones.
    writeFileSync(file, `${COMPOSE}    privileged: true # -----BEGIN X-----\n    restart: always\n`);
    const client = { getService: vi.fn(async () => service(COMPOSE)), updateServiceCompose: vi.fn() };
    expect(await composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--from-file', file]), cmdDeps(client, svcTarget).deps)).toBe(0);
    expect(stdout()).toContain('+     [REDACTED]');
    expect(stdout()).toContain('+     restart: always');
    expect(stdout()).toMatch(/NOTE: 1 added or changed line is hidden whole by redaction .*--from-file document: read them there before --apply/);
    expect(client.updateServiceCompose).not.toHaveBeenCalled();
  });

  it('compose set --json carries the count (0 when nothing is hidden)', async () => {
    const file = join(dir, 'hidden-json.yml');
    writeFileSync(file, `${COMPOSE}    privileged: true # -----BEGIN X-----\n    pid: host # -----BEGIN X-----\n`);
    const client = { getService: vi.fn(async () => service(COMPOSE)), updateServiceCompose: vi.fn() };
    await composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--from-file', file, '--json']), cmdDeps(client, svcTarget).deps);
    expect(oneJson()).toMatchObject({ dryRun: true, changed: true, hiddenAddedLines: 2 });
    out.length = 0;
    const plain = join(dir, 'plain.yml');
    writeFileSync(plain, `${COMPOSE}    restart: always\n`);
    await composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--from-file', plain, '--json']), cmdDeps(client, svcTarget).deps);
    expect(oneJson()).toMatchObject({ changed: true, hiddenAddedLines: 0 });
  });

  it('the count covers a hidden line that replaces a hidden line, and every piece of a line broken by a lone CR', () => {
    expect(countHiddenAdditions([
      '- [REDACTED]',
      '~ [REDACTED]   (redacted value changed)',
      '~ KEY: [REDACTED]   (redacted value changed)',
      '+     restart: always',
      '+     stop_grace_period: 5s\r    [REDACTED]',
      '+       - [REDACTED]',
    ])).toBe(3);
    // A CR inside a line would send the cursor back and overprint its start.
    expect(printableDiffLine('+     stop_grace_period: 5s\r    [REDACTED]')).toBe('+     stop_grace_period: 5s\\r    [REDACTED]');
    expect(printableDiffLine('+     image: x\r')).toBe('+     image: x\r');
  });

  it('compose set counts lines hidden on both sides of a change', async () => {
    const before = 'services:\n  app:\n    image: nginx:1\n    environment:\n      TLS_CERT: |\n        -----BEGIN CERTIFICATE-----\n        MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkq\n        hkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ\n        -----END CERTIFICATE-----\n';
    const file = join(dir, 'both-sides.yml');
    writeFileSync(file, 'services:\n  app:\n    image: nginx:1\n    environment:\n      TLS_CERT: x\n  sidecar:\n        image: evil/miner:latest # -----BEGIN X-----\n        privileged: true # -----BEGIN X-----\n        pid: host # -----BEGIN X-----\n');
    const client = { getService: vi.fn(async () => service(before)), updateServiceCompose: vi.fn() };
    await composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--from-file', file, '--json']), cmdDeps(client, svcTarget).deps);
    expect(oneJson()).toMatchObject({ changed: true, hiddenAddedLines: 3 });
  });

  it('proxy set says it too', async () => {
    const file = join(dir, 'proxy-hidden.yml');
    writeFileSync(file, 'services:\n  traefik:\n    image: traefik:v3.1\n    privileged: true # -----BEGIN X-----\n');
    const inst = { getServerProxy: vi.fn(async () => ({ configuration: 'services:\n  traefik:\n    image: traefik:v3.1\n' })), saveServerProxyConfiguration: vi.fn() };
    const deps = { ...cmdDeps({}).deps, instanceFor: () => ({ name: 'prod', client: inst as never }) };
    expect(await proxySet(parseArgs(['proxy', 'set', '--instance', 'prod', '--server', 's1', '--from-file', file]), deps)).toBe(0);
    expect(stdout()).toMatch(/NOTE: 1 added or changed line is hidden whole by redaction/);
    expect(inst.saveServerProxyConfiguration).not.toHaveBeenCalled();
  });

  it('proxy set refuses --image together with --from-file (the image was dropped without a word)', async () => {
    const inst = { getServerProxy: vi.fn(), saveServerProxyConfiguration: vi.fn() };
    const deps = { ...cmdDeps({}).deps, instanceFor: () => ({ name: 'prod', client: inst as never }) };
    expect(await proxySet(parseArgs(['proxy', 'set', '--instance', 'prod', '--server', 's1', '--from-file', 'p.yml', '--image', 'traefik:v9', '--apply', '--json']), deps)).toBe(2);
    expect(inst.getServerProxy).not.toHaveBeenCalled();
    expect(JSON.parse(stderr())).toMatchObject({ error: { code: 'USAGE' } });
  });
});

describe('transport: what a failure means', () => {
  const timeout = (): Error => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const reset = (code: string): Error => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code }) });

  it('a read that times out is tried once more, not four times', async () => {
    const fetchImpl = vi.fn(async () => { throw timeout(); });
    const e = await httpRequest('https://c.example/x', { method: 'GET', token: 't' }, httpOpts(fetchImpl)).catch((x: unknown) => x);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(e).toBeInstanceOf(CoolifyNetworkError);
    expect((e as CoolifyNetworkError).message).toMatch(/within 30s \(tried 2 times\)/);
    expect((e as CoolifyNetworkError).outcomeUnknown).toBeUndefined();
  });

  it('other read failures still get every retry', async () => {
    const fetchImpl = vi.fn(async () => { throw reset('ECONNRESET'); });
    await expect(httpRequest('https://c.example/x', { method: 'GET', token: 't' }, httpOpts(fetchImpl))).rejects.toBeInstanceOf(CoolifyNetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('a write that fails after it may have left says so; one that never left does not', async () => {
    for (const failure of [timeout(), reset('ECONNRESET'), reset('UND_ERR_SOCKET')]) {
      const e = await httpRequest('https://c.example/x', { method: 'POST', token: 't' }, httpOpts(vi.fn(async () => { throw failure; }))).catch((x: unknown) => x);
      expect((e as CoolifyNetworkError).outcomeUnknown).toBe(true);
      expect((e as Error).message).toMatch(/may have reached Coolify: check what it did before sending it again/);
    }
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'DEPTH_ZERO_SELF_SIGNED_CERT']) {
      const e = await httpRequest('https://c.example/x', { method: 'POST', token: 't' }, httpOpts(vi.fn(async () => { throw reset(code); }))).catch((x: unknown) => x);
      expect((e as CoolifyNetworkError).outcomeUnknown).toBeUndefined();
      expect((e as Error).message).not.toMatch(/may have reached/);
    }
  });

  it('a 5xx to a write settles nothing, and says so; to a read it is just an error', async () => {
    const client = new CoolifyClient(appTarget, { fetchImpl: (async () => json(500, { message: 'Server Error' })) as never, logger: noopLogger(), maxRetries: 0 });
    await expect(client.deploy()).rejects.toThrow(/failed with status 500 — Server Error \(a 5xx does not say whether the request took effect/);
    const e = await client.listEnvs().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyRequestError);
    expect((e as Error).message).not.toMatch(/does not say whether/);
  });

  it('the token is scrubbed from what the server says, field names included', async () => {
    const target = { ...appTarget, token: TOKEN };
    const body = { message: `Unauthenticated. token ${TOKEN} rejected (${TOKEN.slice(2)})`, errors: { [`field_${TOKEN}`]: ['bad'] } };
    for (const status of [401, 422]) {
      const client = new CoolifyClient(target, { fetchImpl: (async () => json(status, body)) as never, logger: noopLogger(), maxRetries: 0 });
      const e = await client.deploy().catch((x: unknown) => x);
      const text = JSON.stringify({ message: (e as Error).message, ...(e as object) });
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(TOKEN.slice(2));
      expect(text).toContain('[REDACTED]');
    }
  });
});

describe('requests that are given up on', () => {
  it('an aborted request is not retried and is not a timeout', async () => {
    const abort = new AbortController();
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      abort.abort();
    }));
    const e = await httpRequest('https://c.example/x', { method: 'GET', token: 't', signal: abort.signal }, httpOpts(fetchImpl)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyNetworkError);
    expect((e as CoolifyNetworkError).reason).toBe('aborted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(httpRequest('https://c.example/x', { method: 'GET', token: 't', signal: abort.signal }, httpOpts(fetchImpl))).rejects.toMatchObject({ reason: 'aborted' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // already aborted: nothing is sent
  });

  it('a wait that ends tells its poll to stop: nothing keeps running behind it', async () => {
    const seen: AbortSignal[] = [];
    const hang = (_uuid: string, poll: { signal: AbortSignal }): Promise<Deployment> => { seen.push(poll.signal); return new Promise(() => {}); };
    await expect(waitForDeployment(hang, 'd1', { timeoutMs: 20, pollGraceMs: 20 })).rejects.toBeInstanceOf(CoolifyWaitTimeoutError);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.aborted).toBe(true);
    // …and a poll that answered is left alone.
    const ok: AbortSignal[] = [];
    await waitForDeployment(async (_uuid, poll) => { ok.push(poll.signal); return { deployment_uuid: 'd1', status: 'finished' }; }, 'd1');
    expect(ok[0]!.aborted).toBe(false);
  });

  it('a short wait is not stretched by the poll grace, and nonsense options are refused', async () => {
    const hang = (): Promise<Deployment> => new Promise(() => {});
    const started = Date.now();
    await expect(waitForDeployment(hang, 'd1', { timeoutMs: 100 })).rejects.toBeInstanceOf(CoolifyWaitTimeoutError);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const bad of [{ pollGraceMs: Number.NaN }, { pollGraceMs: -1 }, { maxConsecutiveErrors: Number.NaN }, { maxConsecutiveErrors: -1 }]) {
      await expect(waitForDeployment(hang, 'd1', bad)).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('unreachable-host codes prove nothing was sent only while connecting', async () => {
    const failure = (code: string, syscall: string): Error => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code, syscall }) });
    const post = (err: Error): Promise<unknown> => httpRequest('https://c.example/x', { method: 'POST', token: 't' }, httpOpts(vi.fn(async () => { throw err; }))).catch((x: unknown) => x);
    expect(((await post(failure('EHOSTUNREACH', 'connect'))) as CoolifyNetworkError).outcomeUnknown).toBeUndefined();
    expect(((await post(failure('EHOSTUNREACH', 'read'))) as CoolifyNetworkError).outcomeUnknown).toBe(true);
    expect(((await post(failure('ENETUNREACH', 'write'))) as CoolifyNetworkError).outcomeUnknown).toBe(true);
  });
});

describe('what Coolify says is kept readable', () => {
  it('a refused /version keeps its reason (the endpoint is text only when it succeeds)', async () => {
    const inst = new CoolifyClient(appTarget, { fetchImpl: (async () => json(403, { message: 'Missing required permissions: read' })) as never, logger: noopLogger(), maxRetries: 0 }).instance();
    await expect(inst.getVersion()).rejects.toMatchObject({ serverMessage: 'Missing required permissions: read' });
  });

  it('field paths are not blanked by the values that were sent', async () => {
    const body = { message: 'The data.0.value field is required.', errors: { 'data.0.value': ['required'], 'data.0.is_literal': ['boolean'] } };
    const client = new CoolifyClient(appTarget, { fetchImpl: (async () => json(422, body)) as never, logger: noopLogger(), maxRetries: 0 });
    const e = await client.upsertEnvs([{ key: 'A', value: 'data' }, { key: 'B', value: 'true' }]).catch((x: unknown) => x);
    expect((e as CoolifyRequestError).fields).toEqual(['data.0.value', 'data.0.is_literal']);
    expect((e as Error).message).toContain('fields: data.0.value, data.0.is_literal');
  });

  it('a 404 says whether it is Coolify\'s own', async () => {
    const own = new CoolifyClient(appTarget, { fetchImpl: (async () => json(404, { message: 'Deployment not found.' })) as never, logger: noopLogger(), maxRetries: 0 });
    await expect(own.getDeployment('d1')).rejects.toMatchObject({ code: 'COOLIFY_NOT_FOUND', serverMessage: 'Deployment not found.' });
    const proxy = new CoolifyClient(appTarget, { fetchImpl: (async () => new Response('404 page not found', { status: 404 })) as never, logger: noopLogger(), maxRetries: 0 });
    const e = await proxy.getDeployment('d1').catch((x: unknown) => x);
    expect((e as { serverMessage?: string }).serverMessage).toBeUndefined();
  });
});

describe('--out', () => {
  it('replaces the target with a new 0600 file: an open reader keeps the old content, a hard link is untouched', async () => {
    const target = join(dir, 'compose.yml');
    const link = join(dir, 'other-name.yml');
    writeFileSync(target, 'old content\n', { mode: 0o644 });
    linkSync(target, link);
    await defaultWriteFile(target, 'services:\n  app:\n    environment:\n      PASSWORD: secret\n');
    expect(readFileSync(target, 'utf8')).toContain('PASSWORD: secret');
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readFileSync(link, 'utf8')).toBe('old content\n');
  });

  it('a missing directory is a usage error, and leaves no temporary file behind', async () => {
    await expect(defaultWriteFile(join(dir, 'nope', 'x.yml'), 'x')).rejects.toBeInstanceOf(UsageError);
  });
});
