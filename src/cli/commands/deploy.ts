import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
import { audited, print, printJson, warn, usageFail } from '../deps.js';
import { EXIT } from '../exit.js';
import { withScope } from '../scope.js';
import { CoolifyNotFoundError } from '../../errors/index.js';
import { withoutLogs } from './deployments.js';

export interface DeployOutcome {
  code: number;
  /** The run's single JSON document. */
  doc: Record<string, unknown>;
}

/**
 * `deploy`: explicit redeploy (applications) / start (services, databases), or `--restart`.
 * `--force` rebuilds an application without the Docker cache (needed to pick up a patched base
 * image — a plain redeploy of an unchanged commit reuses the old image). `--restart --latest`
 * pulls fresh images for a service. `--wait` polls an application deployment to its terminal
 * status and exits 7 if it failed or was cancelled. `--dry-run` sends nothing.
 */
export async function runDeploy(args: ParsedArgs, deps: CmdDeps): Promise<DeployOutcome> {
  const target = deps.resolveTargetFor(args);
  const app = args.app ?? '<target>';
  // Flag misuse is a usage error, rejected before anything is sent or audited.
  if (args.force && (args.restart || target.kind !== 'application')) {
    return { code: usageFail(args, target.kind === 'service'
      ? `--force (no-cache rebuild) only exists for applications. For a service, pull fresh images with: coolify-harness deploy --app ${app} --restart --latest`
      : '--force (no-cache rebuild) only applies to an application deploy, not to --restart or a database.'), doc: {} };
  }
  if (args.latest && (!args.restart || target.kind !== 'service')) {
    return { code: usageFail(args, target.kind === 'application'
      ? `--latest only applies to a service restart. To rebuild an application from scratch use: coolify-harness deploy --app ${app} --force`
      : '--latest only applies to a service restart: deploy --app <service> --restart --latest'), doc: {} };
  }
  const client = deps.clientFactory(target);
  const action = args.restart ? 'restart' : 'deploy';
  const options: Record<string, boolean> = {
    ...(args.force ? { force: true } : {}),
    ...(args.latest ? { latest: true } : {}),
  };

  if (args.dryRun) {
    const doc = { dryRun: true, action, ...options, target: { name: args.app ?? null, kind: target.kind, uuid: target.uuid } };
    if (!args.json) print(`would ${action} ${app} (${target.kind} ${target.uuid})${args.force ? ' with --force (no cache)' : ''}${args.latest ? ' pulling latest images' : ''}. Nothing was sent; drop --dry-run to run it.`);
    return { code: EXIT.ok, doc };
  }

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
    // Ctrl-C stops the WAIT, not the deployment: say so, and how to pick it up again.
    const abort = new AbortController();
    const onSigint = (): void => { abort.abort(new Error('interrupted')); };
    process.once('SIGINT', onSigint);
    let final;
    try {
      final = await withScope('read', () => client.waitForDeployment(uuid, {
        ...(args.timeout !== undefined ? { timeoutMs: args.timeout * 1000 } : {}),
        onStatus: (s) => { if (!args.json) warn(`  status: ${s}`); },
        signal: abort.signal,
      }));
    } catch (err) {
      if (abort.signal.aborted) {
        warn(`--wait interrupted. Deployment ${uuid} keeps running in Coolify. Follow it: coolify-harness deployment ${uuid} --app ${app} — or stop it: coolify-harness deployment cancel ${uuid} --app ${app} --apply`);
        return { code: 130, doc: { ...ackInfo, finalStatus: null, interrupted: true } };
      }
      if (err instanceof CoolifyNotFoundError) {
        throw new CoolifyNotFoundError(`${err.message}. Coolify acknowledged the ${action} but has no deployment ${uuid}: it was not queued (queue full, or skipped). Check \`coolify-harness deployments --app ${app}\`.`);
      }
      throw err;
    } finally {
      process.removeListener('SIGINT', onSigint);
    }
    const ok = final.status === 'finished';
    if (!args.json) {
      print(`${action} ${ok ? 'finished' : 'did NOT finish'}: status=${final.status}`);
      if (!ok) print(`build logs: coolify-harness logs --app ${app} --build --deployment ${uuid}`);
    }
    return {
      code: ok ? EXIT.ok : EXIT.deployFailed,
      doc: { ...ackInfo, finalStatus: final.status, finalDeployment: args.noLogs ? withoutLogs(final) : final },
    };
  }

  return { code: EXIT.ok, doc: ackInfo };
}

export async function deployCmd(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const outcome = await runDeploy(args, deps);
  if (args.json && Object.keys(outcome.doc).length > 0) printJson(outcome.doc);
  return outcome.code;
}
