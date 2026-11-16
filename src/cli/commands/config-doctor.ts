import type { ParsedArgs } from '../args.js';
import { CoolifyInstanceClient } from '../../client/instance.js';
import { loadConfigModule, resolveInstance } from '../../config/load.js';
import { configPathFor } from '../config-path.js';
import { ConfigError, CoolifyAuthError, CoolifyHarnessError, MissingTokenError } from '../../errors/index.js';
import { noopLogger } from '../../logging/index.js';
import { HARNESS_VERSION, TESTED_COOLIFY, compatibilityWarning, coolifyCompatibility } from '../../version.js';
import { emitError, print, printJson, warn } from '../deps.js';
import { sanitizeErrorMessage } from '../errors-out.js';
import { EXIT, errorCode, errorToExitCode } from '../exit.js';

interface InstanceReport {
  name: string;
  url: string;
  /** NAME of the environment variable that must hold the API token (never its value). */
  envVar: string;
  /** Whether that variable is set. */
  envVarSet: boolean;
  /** Set when the instance was contacted. */
  reachable?: boolean;
  version?: string;
  compatibility?: string;
  warnings: string[];
  error?: { code: string; message: string };
}

export interface DoctorDeps {
  env?: Record<string, string | undefined>;
  /** Injected in tests; the real one calls `GET /version` with the instance token. */
  getVersion?: (instance: { instanceUrl: string; token: string }) => Promise<string>;
}

const liveVersion = (instance: { instanceUrl: string; token: string }): Promise<string> =>
  new CoolifyInstanceClient(instance, {
    fetchImpl: (url: string, init: RequestInit) => globalThis.fetch(url, init),
    logger: noopLogger(),
    maxRetries: 1,
    timeoutMs: 10_000,
  }).getVersion();

/**
 * `config doctor`: is this project wired up? Validates the config, says which token variables are
 * set (never their value), and — unless `--offline` — calls `GET /version` on every instance that
 * has a token to prove the URL and token work and to compare the live Coolify version with the
 * range this release is tested against (outside the range is a warning, not a failure).
 *
 * Exit code (0 means "you can use what was checked"):
 * - an instance whose token is set but which cannot be reached, or rejects the token → 1 / 5;
 * - the instance you named (`--app` / `--instance`) has no token → 5;
 * - no instance at all has a token → 5 (nothing is usable);
 * - otherwise 0: an instance without a token is only reported when another one works, so a
 *   machine that holds one of several tokens is not an error.
 */
export async function configDoctor(args: ParsedArgs, deps: DoctorDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const getVersion = deps.getVersion ?? liveVersion;
  const path = configPathFor(args);
  const mod = await loadConfigModule(path);
  const { instances, targets } = mod.registry;

  const dangling = Object.entries(targets).filter(([, t]) => !instances[t.instance]).map(([n, t]) => `${n} → ${t.instance}`);
  if (dangling.length > 0) {
    throw new ConfigError(`Target(s) reference an unknown instance: ${dangling.join(', ')}. Known instances: ${Object.keys(instances).join(', ')}`);
  }
  if (args.app && !targets[args.app]) {
    throw new ConfigError(`Unknown target '${args.app}'. Known targets: ${Object.keys(targets).join(', ')}`);
  }
  const focus = args.instance ?? (args.app ? targets[args.app]?.instance : undefined);
  if (focus !== undefined && !instances[focus]) {
    throw new ConfigError(`Unknown instance '${focus}'. Known instances: ${Object.keys(instances).join(', ')}`);
  }

  const names = focus !== undefined ? [focus] : Object.keys(instances);
  const failures: unknown[] = [];
  const reports = await Promise.all(names.map(async (name): Promise<InstanceReport> => {
    const inst = instances[name]!;
    const token = env[inst.tokenEnv];
    const report: InstanceReport = {
      name, url: inst.url, envVar: inst.tokenEnv, envVarSet: token !== undefined && token !== '', warnings: [],
    };
    if (!inst.url.startsWith('https://')) report.warnings.push('URL is not https: the API token would travel in clear text');
    if (!report.envVarSet || args.offline) return report;
    try {
      const version = await getVersion(resolveInstance(mod.registry, name, env));
      report.reachable = true;
      report.version = version;
      report.compatibility = coolifyCompatibility(version);
      const w = compatibilityWarning(version);
      if (w !== undefined) report.warnings.push(w);
    } catch (err) {
      // A 401/403 is an answer: the instance is reachable, the token is the problem.
      report.reachable = err instanceof CoolifyAuthError;
      report.error = { code: err instanceof CoolifyHarnessError ? err.code : 'INTERNAL', message: sanitizeErrorMessage(err) };
      failures.push(err);
    }
    return report;
  }));

  const missing = reports.filter((r) => !r.envVarSet);
  if (missing.length > 0 && (focus !== undefined || missing.length === reports.length)) {
    const m = missing[0]!;
    failures.push(new MissingTokenError(
      missing.length === 1
        ? `Env var '${m.envVar}' (token for instance '${m.name}') is not set`
        : `No API token is set: ${missing.map((r) => `'${r.envVar}' (${r.name})`).join(', ')}`,
      { tokenEnv: m.envVar },
    ));
  }
  const failure = failures[0];
  const ok = failure === undefined;

  if (args.json) {
    printJson({
      ok,
      harness: HARNESS_VERSION,
      testedCoolify: TESTED_COOLIFY,
      config: path,
      offline: args.offline === true,
      instances: reports,
      targets: Object.entries(targets).map(([name, t]) => ({ name, instance: t.instance, kind: t.kind, uuid: t.uuid })),
      ...(args.app ? { target: args.app } : {}),
    });
  } else {
    print(`Config ${ok ? 'OK' : 'loaded, with problems'}. Instances: ${Object.keys(instances).join(', ')}`);
    print(`Targets: ${Object.keys(targets).join(', ')}`);
    print(`coolify-harness ${HARNESS_VERSION} (Coolify API tested on ${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})`);
    for (const r of reports) {
      const live = r.version !== undefined
        ? `Coolify ${r.version} (${r.compatibility === 'tested' ? 'tested' : 'OUTSIDE the tested range'})`
        : r.error ? `FAILED: ${r.error.message}`
          : !r.envVarSet ? 'not checked (no token)' : 'not checked (--offline)';
      print(`  ${r.name}  ${r.url}  token ${r.envVar}: ${r.envVarSet ? 'set' : 'MISSING'}  —  ${live}`);
    }
    if (args.app && ok) print(`Target '${args.app}' resolves and its token is present.`);
    // With --json the warnings are in the document; stderr stays empty on success.
    for (const r of reports) for (const w of r.warnings) warn(`WARNING [${r.name}]: ${w}`);
  }
  if (failure === undefined) return EXIT.ok;
  return emitError(args, errorCode(failure), sanitizeErrorMessage(failure), errorToExitCode(failure));
}
