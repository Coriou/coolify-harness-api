import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
import { audited, print, printJson, warn } from '../deps.js';
import { EXIT } from '../main.js';
import { withScope } from '../scope.js';

/**
 * `deploy`: explicit redeploy (applications) / start (services, databases), or `--restart`.
 * `--force` rebuilds an application without the Docker cache (needed to pick up a patched base
 * image — a plain redeploy of an unchanged commit reuses the old image). `--restart --latest`
 * pulls fresh images for a service. `--wait` polls an application deployment to its terminal
 * status and exits 7 if it failed or was cancelled.
 */
export async function deployCmd(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  // Flag misuse is a usage error, rejected before anything is sent or audited.
  if (args.force && (args.restart || target.kind !== 'application')) {
    warn(target.kind === 'service'
      ? `--force (no-cache rebuild) only exists for applications. For a service, pull fresh images with: coolify-harness deploy --app ${args.app ?? '<target>'} --restart --latest`
      : '--force (no-cache rebuild) only applies to an application deploy, not to --restart or a database.');
    return EXIT.usage;
  }
  if (args.latest && (!args.restart || target.kind !== 'service')) {
    warn(target.kind === 'application'
      ? `--latest only applies to a service restart. To rebuild an application from scratch use: coolify-harness deploy --app ${args.app ?? '<target>'} --force`
      : '--latest only applies to a service restart: deploy --app <service> --restart --latest');
    return EXIT.usage;
  }
  const client = deps.clientFactory(target);
  const action = args.restart ? 'restart' : 'deploy';
  const options: Record<string, boolean> = {
    ...(args.force ? { force: true } : {}),
    ...(args.latest ? { latest: true } : {}),
  };
  const ack = await audited(deps, {
    instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid, action,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  }, () => withScope('deploy', () => (args.restart
    ? client.restart(args.latest ? { latest: true } : {})
    : client.deploy(args.force ? { force: true } : {}))));

  const ackInfo = { action, ...options, message: ack.message, deploymentUuid: ack.deploymentUuid ?? null };

  if (!args.json) {
    print(`${action}: ${ack.message}${ack.deploymentUuid ? ` (${ack.deploymentUuid})` : ''}`);
  }

  if (args.wait && !ack.deploymentUuid) {
    warn(target.kind === 'application'
      ? '--wait: Coolify returned no deployment uuid (the deploy may have been skipped); nothing to wait for.'
      : `--wait: a ${target.kind} ${action} creates no deployment record; check \`status\` instead.`);
  }

  if (args.wait && ack.deploymentUuid) {
    const uuid = ack.deploymentUuid;
    if (!args.json) print(`--wait: polling deployment ${uuid} until terminal status...`);
    const final = await withScope('read', () => client.waitForDeployment(uuid, {
      ...(args.timeout !== undefined ? { timeoutMs: args.timeout * 1000 } : {}),
      onStatus: (s) => { if (!args.json) warn(`  status: ${s}`); },
    }));
    const ok = final.status === 'finished';
    if (args.json) {
      printJson({ ...ackInfo, finalStatus: final.status, finalDeployment: final });
    } else {
      print(`${action} ${ok ? 'finished' : 'did NOT finish'}: status=${final.status}`);
      if (!ok) print(`build logs: coolify-harness logs --app ${args.app ?? '<target>'} --build --deployment ${uuid}`);
    }
    return ok ? EXIT.ok : EXIT.deployFailed;
  }

  if (args.json) printJson(ackInfo);
  return EXIT.ok;
}
