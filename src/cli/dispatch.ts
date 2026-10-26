import { resolve } from 'node:path';
import type { ParsedArgs } from './args.js';
import { catalogGen, catalogCheck } from './commands/catalog.js';
import { configDoctor } from './commands/config-doctor.js';
import { CoolifyClient } from '../client/coolify.js';
import { CoolifyInstanceClient } from '../client/instance.js';
import { createLogger } from '../logging/index.js';
import { loadConfigModule, resolveInstance, resolveTarget } from '../config/load.js';
import { ConfigError } from '../errors/index.js';
import { makeAuditSink } from './audit-sink.js';
import type { CmdDeps } from './deps.js';
import { envDiff, envApply, envList, envDelete } from './commands/env.js';
import { deployCmd } from './commands/deploy.js';
import { statusCmd } from './commands/status.js';
import { logsCmd } from './commands/logs.js';
import { deploymentsCmd, deploymentCancelCmd } from './commands/deployments.js';
import { composeGet, composeSet } from './commands/compose.js';
import { instanceInfo, serversCmd, serverGet, notInApi } from './commands/instance.js';
import { proxyGet, proxySet, proxyRestart } from './commands/proxy.js';
import { databasesCmd, databaseGet, databaseSet, databaseBackups, databaseBackup } from './commands/database.js';
import { helpCmd } from './commands/help.js';
import { EXIT } from './main.js';

async function buildDeps(configPath: string): Promise<CmdDeps> {
  const mod = await loadConfigModule(configPath);
  const logger = createLogger({ sink: () => {} });
  const clientDeps = { fetchImpl: (url: string, init: RequestInit) => globalThis.fetch(url, init), logger };
  return {
    resolveTargetFor: (a) => {
      if (!a.app) throw new ConfigError('--app <target> is required for this command');
      return resolveTarget(mod.registry, a.app, process.env);
    },
    clientFactory: (target) => new CoolifyClient(target, clientDeps),
    instanceFor: (a) => {
      const name = a.instance ?? (a.app ? mod.registry.targets[a.app]?.instance : undefined);
      if (!name) {
        throw new ConfigError(`--instance <name> is required (known instances: ${Object.keys(mod.registry.instances).join(', ')})`);
      }
      return { name, client: new CoolifyInstanceClient(resolveInstance(mod.registry, name, process.env), clientDeps) };
    },
    actor: process.env['USER'] ?? process.env['GITHUB_ACTOR'] ?? 'unknown',
    auditSink: makeAuditSink('.coolify-harness/audit.jsonl'),
  };
}

export async function dispatch(args: ParsedArgs): Promise<number> {
  switch (args.command) {
    case 'help': return helpCmd();
    case 'catalog-gen': return catalogGen(args);
    case 'catalog-check': return catalogCheck(args);
    case 'config-doctor': return configDoctor(args);
    case 'server-patch':
    case 'server-reboot':
    case 'instance-upgrade':
      return notInApi(args);
    default:
      break;
  }
  const deps = await buildDeps(resolve(args.config));
  switch (args.command) {
    case 'env-diff': return envDiff(args, deps);
    case 'env-apply': return envApply(args, deps);
    case 'env-list': return envList(args, deps);
    case 'env-delete': return envDelete(args, deps);
    case 'flag-set': {
      const code = await envApply(args, deps);
      if (args.redeploy && code === EXIT.ok) {
        return deployCmd(args, deps);
      }
      return code;
    }
    case 'deploy': return deployCmd(args, deps);
    case 'status': return statusCmd(args, deps);
    case 'logs': return logsCmd(args, deps);
    case 'deployments':
    case 'deployment':
      return deploymentsCmd(args, deps);
    case 'deployment-cancel': return deploymentCancelCmd(args, deps);
    case 'compose-get': return composeGet(args, deps);
    case 'compose-set': return composeSet(args, deps);
    case 'instance-info': return instanceInfo(args, deps);
    case 'servers': return serversCmd(args, deps);
    case 'server-get': return serverGet(args, deps);
    case 'proxy-get': return proxyGet(args, deps);
    case 'proxy-set': return proxySet(args, deps);
    case 'proxy-restart': return proxyRestart(args, deps);
    case 'databases': return databasesCmd(args, deps);
    case 'database-get': return databaseGet(args, deps);
    case 'database-set': return databaseSet(args, deps);
    case 'database-backups': return databaseBackups(args, deps);
    case 'database-backup': return databaseBackup(args, deps);
    default:
      return EXIT.usage;
  }
}
