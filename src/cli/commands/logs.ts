import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
import { print, printJson, warn } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../main.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';

export async function logsCmd(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  if (!args.app) {
    warn('logs: --app <name> is required');
    return EXIT.usage;
  }
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);

  const wantBuild = args.build || !!args.deployment;

  try {
    if (wantBuild) {
      let depUuid = args.deployment;
      if (!depUuid) {
        const latest = await withScope('read:sensitive', () => client.getLatestDeployment());
        if (!latest) {
          warn(target.kind === 'application'
            ? 'logs: no deployments found for build logs'
            : `logs: a ${target.kind} has no build/deployment logs; use runtime logs (drop --build)`);
          return EXIT.usage;
        }
        depUuid = latest.deployment_uuid;
      }
      const dep = await withScope('read:sensitive', () => client.getDeployment(depUuid!));
      const out = {
        type: 'build',
        deployment_uuid: dep.deployment_uuid,
        status: dep.status,
        commit: dep.commit,
        logs: dep.logs ?? '',
      };
      if (args.json) {
        printJson(out);
      } else {
        print(`build logs for ${depUuid} [${dep.status}]`);
        print('---');
        process.stdout.write((dep.logs ?? '') + (dep.logs ? '\n' : ''));
        print('---');
        print('NOTE: use --json for full machine-readable output.');
      }
      return EXIT.ok;
    }

    // runtime (default)
    const lines = args.lines;
    const r = await withScope('read:sensitive', () => client.getRuntimeLogs(lines, {
      ...(args.service !== undefined ? { service: args.service } : {}),
      ...(args.timestamps ? { timestamps: true } : {}),
    }));
    if (args.json) {
      printJson({ type: 'runtime', lines: lines ?? null, service: args.service ?? null, logs: r.logs });
    } else {
      print(`runtime logs${args.service ? ` for ${args.service}` : ''}${lines ? ` (last ${lines})` : ''}`);
      print('---');
      process.stdout.write(r.logs + (r.logs ? '\n' : ''));
      print('---');
      print('NOTE: use --json for full machine-readable output.');
    }
    return EXIT.ok;
  } catch (err) {
    if (err instanceof CoolifyFeatureNotSupportedError) {
      warn(err.message);
      return EXIT.usage;
    }
    throw err;
  }
}
