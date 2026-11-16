import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
import { print, printJson, usageFail } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../exit.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';

export async function logsCmd(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  if (!args.app) {
    return usageFail(args, 'logs: --app <name> is required');
  }
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);

  const wantBuild = args.build || !!args.deployment;

  try {
    if (wantBuild) {
      let depUuid = args.deployment;
      let dep;
      if (!depUuid) {
        const latest = await withScope('read:sensitive', () => client.getLatestDeployment());
        if (!latest) {
          return usageFail(args, target.kind === 'application'
            ? 'logs: no deployments found for build logs'
            : `logs: a ${target.kind} has no build/deployment logs; use runtime logs (drop --build)`);
        }
        depUuid = latest.deployment_uuid;
        // The list row already embeds the log (with read:sensitive): no second request needed.
        if (latest.logs != null) dep = latest;
      }
      const uuid = depUuid;
      dep ??= await withScope('read:sensitive', () => client.getDeployment(uuid));
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
      return usageFail(args, err.message);
    }
    throw err;
  }
}
