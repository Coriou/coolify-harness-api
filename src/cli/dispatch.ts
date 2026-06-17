import { resolve } from 'node:path';
import type { ParsedArgs } from './args.js';
import { catalogGen, catalogCheck } from './commands/catalog.js';
import { configDoctor } from './commands/config-doctor.js';
import { CoolifyClient } from '../client/coolify.js';
import { createLogger } from '../logging/index.js';
import { loadConfigModule, resolveTarget } from '../config/load.js';
import { makeAuditSink } from './audit-sink.js';
import { envDiff, envApply, type EnvCmdDeps } from './commands/env.js';
import { deployCmd } from './commands/deploy.js';
import { EXIT } from './main.js';

async function buildEnvDeps(configPath: string): Promise<EnvCmdDeps> {
  const mod = await loadConfigModule(configPath);
  const logger = createLogger({ sink: () => {} });
  return {
    resolveTargetFor: (a) => {
      if (!a.app) throw new Error('--app is required for this command');
      return resolveTarget(mod.registry, a.app, process.env);
    },
    clientFactory: (target) =>
      new CoolifyClient(target, { fetchImpl: (url, init) => globalThis.fetch(url, init), logger }),
    actor: process.env['USER'] ?? process.env['GITHUB_ACTOR'] ?? 'unknown',
    auditSink: makeAuditSink('.coolify-harness/audit.jsonl'),
  };
}

export async function dispatch(args: ParsedArgs): Promise<number> {
  switch (args.command) {
    case 'catalog-gen': return catalogGen(args);
    case 'catalog-check': return catalogCheck(args);
    case 'config-doctor': return configDoctor(args);
    case 'env-diff': {
      const deps = await buildEnvDeps(resolve(args.config));
      return envDiff(args, deps);
    }
    case 'env-apply': {
      const deps = await buildEnvDeps(resolve(args.config));
      return envApply(args, deps);
    }
    case 'flag-set': {
      const deps = await buildEnvDeps(resolve(args.config));
      const code = await envApply(args, deps);
      if (args.redeploy && code === EXIT.ok) {
        return deployCmd(args, deps);
      }
      return code;
    }
    case 'deploy': {
      const deps = await buildEnvDeps(resolve(args.config));
      return deployCmd(args, deps);
    }
  }
}
