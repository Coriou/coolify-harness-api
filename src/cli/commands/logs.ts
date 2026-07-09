import type { ParsedArgs } from '../args.js';
import type { EnvCmdDeps } from './env.js';
import { withScope } from '../scope.js';
import { EXIT } from '../main.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';

export async function logsCmd(args: ParsedArgs, deps: EnvCmdDeps): Promise<number> {
  if (!args.app) {
    process.stderr.write('logs: --app <name> is required\n');
    return EXIT.usage;
  }
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);

  const wantBuild = args.build || !!args.deployment;
  const wantRuntime = args.runtime || (!args.build && !args.deployment);

  if (wantBuild && wantRuntime && !args.json) {
    // allow both? but default behavior: if deployment or --build prefer build logs
  }

  try {
    if (wantBuild) {
      let depUuid = args.deployment;
      if (!depUuid) {
        const latest = await withScope('read:sensitive', () => client.getLatestDeployment());
        if (!latest) {
          process.stderr.write('logs: no deployments found for build logs\n');
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
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      } else {
        process.stdout.write(`build logs for ${depUuid} [${dep.status}]\n`);
        process.stdout.write('---\n');
        process.stdout.write((dep.logs ?? '') + (dep.logs ? '\n' : ''));
        process.stdout.write('---\n');
        process.stdout.write('NOTE: use --json for full machine-readable output.\n');
      }
      return EXIT.ok;
    }

    // runtime (default)
    const lines = args.lines;
    const r = await withScope('read:sensitive', () => client.getRuntimeLogs(lines));
    if (args.json) {
      process.stdout.write(JSON.stringify({ type: 'runtime', lines: lines ?? null, logs: r.logs }, null, 2) + '\n');
    } else {
      process.stdout.write(`runtime logs${lines ? ` (last ${lines})` : ''}\n`);
      process.stdout.write('---\n');
      process.stdout.write(r.logs + (r.logs ? '\n' : ''));
      process.stdout.write('---\n');
      process.stdout.write('NOTE: use --json for full machine-readable output.\n');
    }
    return EXIT.ok;
  } catch (err) {
    if (err instanceof CoolifyFeatureNotSupportedError) {
      process.stderr.write(`${err.message}\n`);
      return EXIT.usage;
    }
    throw err;
  }
}
