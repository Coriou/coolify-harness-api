import type { ParsedArgs } from '../args.js';
import { CoolifyInstanceClient } from '../../client/instance.js';
import { loadConfigModule, resolveInstance } from '../../config/load.js';
import { configPathFor } from '../config-path.js';
import { ConfigError, CoolifyAuthError, CoolifyHarnessError, MissingTokenError } from '../../errors/index.js';
import { noopLogger } from '../../logging/index.js';
import { HARNESS_VERSION, TESTED_COOLIFY, compatibilityWarning, coolifyCompatibility } from '../../version.js';
import { print, printJson, warn } from '../deps.js';
import { sanitizeErrorMessage } from '../errors-out.js';
import { EXIT, errorToExitCode } from '../exit.js';

interface InstanceReport {
  name: string;
  url: string;
  tokenEnv: string;
  tokenPresent: boolean;
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
 * `config doctor`: is this project wired up? Validates the config, says which tokens are present
 * (never their value), and — unless `--offline` — calls `GET /version` on every instance that has
 * a token to prove the URL and token work and to compare the live Coolify version with the range
 * this release is tested against (a warning, not a failure).
 *
 * Exit code: a problem with the target/instance you NAMED (`--app` / `--instance`) fails the
 * command (5 missing or rejected token, 1 unreachable). Without a name it reports every instance
 * and exits 0 as long as the config itself is valid, so a machine holding only one of several
 * tokens is not an error.
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
  let focusError: unknown;
  const reports = await Promise.all(names.map(async (name): Promise<InstanceReport> => {
    const inst = instances[name]!;
    const token = env[inst.tokenEnv];
    const report: InstanceReport = {
      name, url: inst.url, tokenEnv: inst.tokenEnv, tokenPresent: token !== undefined && token !== '', warnings: [],
    };
    if (!inst.url.startsWith('https://')) report.warnings.push('URL is not https: the API token would travel in clear text');
    if (!report.tokenPresent) {
      if (name === focus) focusError = new MissingTokenError(`Env var '${inst.tokenEnv}' (token for instance '${name}') is not set`, { tokenEnv: inst.tokenEnv });
      return report;
    }
    if (args.offline) return report;
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
      if (name === focus) focusError = err;
    }
    return report;
  }));

  const ok = focusError === undefined;
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
    print(`Config OK. Instances: ${Object.keys(instances).join(', ')}`);
    print(`Targets: ${Object.keys(targets).join(', ')}`);
    print(`coolify-harness ${HARNESS_VERSION} (Coolify API tested on ${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})`);
    for (const r of reports) {
      const live = r.version !== undefined
        ? `Coolify ${r.version} (${r.compatibility === 'tested' ? 'tested' : 'OUTSIDE the tested range'})`
        : r.error ? `FAILED: ${r.error.message}`
          : !r.tokenPresent ? 'not checked (no token)' : 'not checked (--offline)';
      print(`  ${r.name}  ${r.url}  token ${r.tokenEnv}: ${r.tokenPresent ? 'set' : 'MISSING'}  —  ${live}`);
    }
    if (args.app && ok) print(`Target '${args.app}' resolves and its token is present.`);
  }
  for (const r of reports) for (const w of r.warnings) warn(`WARNING [${r.name}]: ${w}`);
  if (focusError !== undefined) {
    if (!args.json) warn(sanitizeErrorMessage(focusError));
    return errorToExitCode(focusError);
  }
  return EXIT.ok;
}
