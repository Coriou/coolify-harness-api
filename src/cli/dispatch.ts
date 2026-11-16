import type { ParsedArgs } from './args.js';
import { CoolifyClient } from '../client/coolify.js';
import { CoolifyInstanceClient } from '../client/instance.js';
import { createLogger } from '../logging/index.js';
import { loadConfigModule, resolveInstance, resolveTarget, type ConfigModule } from '../config/load.js';
import { configPathFor } from './config-path.js';
import { ConfigError, MissingTokenError, UsageError } from '../errors/index.js';
import { describePath, readTokenFiles } from './dotenv.js';
import { makeAuditSink } from './audit-sink.js';
import { printJson, type CmdDeps } from './deps.js';
import { EXIT } from './exit.js';


export interface TokenEnv {
  env: Record<string, string | undefined>;
  /** `--token-file` files that do not exist, to mention when a token turns out to be missing. */
  missingFiles: string[];
}

/**
 * Where API tokens are looked up: the real environment, then the `--token-file` files. A variable
 * that is set (and not blank) in the environment wins; the files are never copied into
 * `process.env`.
 */
export async function tokenEnv(args: Pick<ParsedArgs, 'tokenFiles'>): Promise<TokenEnv> {
  if (!args.tokenFiles || args.tokenFiles.length === 0) return { env: process.env, missingFiles: [] };
  const { vars, missing } = await readTokenFiles(args.tokenFiles);
  const env: Record<string, string | undefined> = { ...vars };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== '') env[k] = v;
  return { env, missingFiles: missing };
}

/** A missing token is easier to fix when the error says the token file was not there. */
function withTokenFileHint<T>(missingFiles: readonly string[], fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof MissingTokenError && missingFiles.length > 0) {
      throw new MissingTokenError(`${err.message} (and --token-file ${missingFiles.map(describePath).join(', ')} does not exist)`, { tokenEnv: err.tokenEnv });
    }
    throw err;
  }
}

export function buildDepsFrom(mod: ConfigModule, tokens: TokenEnv = { env: process.env, missingFiles: [] }): CmdDeps {
  const { env, missingFiles } = tokens;
  const logger = createLogger({ sink: () => {} });
  const clientDeps = { fetchImpl: (url: string, init: RequestInit) => globalThis.fetch(url, init), logger };
  return {
    resolveTargetFor: (a) => {
      if (!a.app) {
        throw new UsageError(`--app <target> is required for this command (known targets: ${Object.keys(mod.registry.targets).join(', ') || 'none'})`);
      }
      const app = a.app;
      return withTokenFileHint(missingFiles, () => resolveTarget(mod.registry, app, env));
    },
    clientFactory: (target) => new CoolifyClient(target, clientDeps),
    instanceFor: (a) => {
      const target = a.app && Object.hasOwn(mod.registry.targets, a.app) ? mod.registry.targets[a.app] : undefined;
      if (a.app && !a.instance && !target) {
        throw new ConfigError(`Unknown target '${a.app}'. Known targets: ${Object.keys(mod.registry.targets).join(', ')}`);
      }
      const name = a.instance ?? target?.instance;
      if (!name) {
        throw new UsageError(`--instance <name> is required (known instances: ${Object.keys(mod.registry.instances).join(', ')})`);
      }
      return { name, client: new CoolifyInstanceClient(withTokenFileHint(missingFiles, () => resolveInstance(mod.registry, name, env)), clientDeps) };
    },
    actor: process.env['USER'] ?? process.env['GITHUB_ACTOR'] ?? 'unknown',
    auditSink: makeAuditSink('.coolify-harness/audit.jsonl'),
  };
}

/**
 * Route a parsed command. Each command module is imported only when it runs, so `status` does not
 * pay for the catalog walker or the compose differ.
 */
export async function dispatch(args: ParsedArgs): Promise<number> {
  switch (args.command) {
    case 'help': return (await import('./commands/help.js')).helpCmd(args);
    case 'catalog-gen': return (await import('./commands/catalog.js')).catalogGen(args);
    case 'catalog-check': return (await import('./commands/catalog.js')).catalogCheck(args);
    case 'config-doctor': {
      const tokens = await tokenEnv(args);
      return (await import('./commands/config-doctor.js')).configDoctor(args, { env: tokens.env, missingTokenFiles: tokens.missingFiles });
    }
    case 'server-patch':
    case 'server-reboot':
    case 'instance-upgrade':
      return (await import('./commands/instance.js')).notInApi(args);
    default:
      break;
  }
  const deps = buildDepsFrom(await loadConfigModule(configPathFor(args)), await tokenEnv(args));
  switch (args.command) {
    case 'env-diff': return (await import('./commands/env.js')).envDiff(args, deps);
    case 'env-apply': return (await import('./commands/env.js')).envApply(args, deps);
    case 'env-list': return (await import('./commands/env.js')).envList(args, deps);
    case 'env-delete': return (await import('./commands/env.js')).envDelete(args, deps);
    case 'flag-set': return flagSet(args, deps);
    case 'deploy': return (await import('./commands/deploy.js')).deployCmd(args, deps);
    case 'status': return (await import('./commands/status.js')).statusCmd(args, deps);
    case 'logs': return (await import('./commands/logs.js')).logsCmd(args, deps);
    case 'deployments':
    case 'deployment':
      return (await import('./commands/deployments.js')).deploymentsCmd(args, deps);
    case 'deployment-cancel': return (await import('./commands/deployments.js')).deploymentCancelCmd(args, deps);
    case 'compose-get': return (await import('./commands/compose.js')).composeGet(args, deps);
    case 'compose-set': return (await import('./commands/compose.js')).composeSet(args, deps);
    case 'instance-info': return (await import('./commands/instance.js')).instanceInfo(args, deps);
    case 'servers': return (await import('./commands/instance.js')).serversCmd(args, deps);
    case 'server-get': return (await import('./commands/instance.js')).serverGet(args, deps);
    case 'proxy-get': return (await import('./commands/proxy.js')).proxyGet(args, deps);
    case 'proxy-set': return (await import('./commands/proxy.js')).proxySet(args, deps);
    case 'proxy-restart': return (await import('./commands/proxy.js')).proxyRestart(args, deps);
    case 'databases': return (await import('./commands/database.js')).databasesCmd(args, deps);
    case 'database-get': return (await import('./commands/database.js')).databaseGet(args, deps);
    case 'database-set': return (await import('./commands/database.js')).databaseSet(args, deps);
    case 'database-backups': return (await import('./commands/database.js')).databaseBackups(args, deps);
    case 'database-backup': return (await import('./commands/database.js')).databaseBackup(args, deps);
    default:
      // Unreachable through parseArgs; a caller that builds ParsedArgs by hand still gets an error.
      throw new UsageError('Unknown command. Run `coolify-harness help`.');
  }
}

/**
 * `flag set`: `env apply` and, with `--redeploy`, a deploy — but ONLY with `--apply`.
 * Without `--apply` the env step is a dry-run, and redeploying then would be a mutation behind a
 * dry-run (it used to do exactly that). With `--apply --redeploy` the deploy runs even when the
 * value was already set: the caller asked for a redeploy. With `--json` both steps share one
 * document.
 */
export async function flagSet(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const { runEnvApply } = await import('./commands/env.js');
  // `flag set --redeploy --apply` with nothing to set used to be a bare deploy.
  if (!args.fromFile && Object.keys(args.set).length === 0) {
    throw new UsageError('flag set: pass --set KEY=VALUE (repeatable) or --from-file <dotenv>. To deploy without changing a variable, use `deploy`.');
  }
  if (args.redeploy) {
    // Everything that could stop the deploy step is checked BEFORE the env write: a usage error
    // after it would leave the flag written and the command reported as "wrong usage".
    const { deployFlagProblem } = await import('./commands/deploy.js');
    const problem = deployFlagProblem(args, deps.resolveTargetFor(args).kind);
    if (problem !== undefined) throw new UsageError(problem);
  }
  const env = await runEnvApply(args, deps);
  if (!args.redeploy || env.code !== EXIT.ok) {
    if (args.json) printJson(env.doc);
    return env.code;
  }
  if (!args.apply) {
    if (args.json) printJson({ ...env.doc, deploy: { dryRun: true, skipped: 'env apply was a dry-run; --redeploy needs --apply' } });
    else process.stdout.write('--redeploy skipped: this was a dry-run. Re-run with --apply to write and redeploy.\n');
    return EXIT.ok;
  }
  const { runDeploy, partialDocOf } = await import('./commands/deploy.js');
  let deploy;
  try {
    deploy = await runDeploy(args, deps);
  } catch (err) {
    // The env write already happened (and maybe the deploy was queued): that must not be lost
    // with the error.
    if (args.json) printJson({ ...env.doc, deploy: partialDocOf(err) ?? null });
    throw err;
  }
  if (args.json) printJson({ ...env.doc, deploy: deploy.doc });
  return deploy.code;
}
