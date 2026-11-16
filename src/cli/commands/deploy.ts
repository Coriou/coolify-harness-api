import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
import { audited, emitError, print, printJson, warn, usageFail } from '../deps.js';
import { EXIT } from '../exit.js';
import { withScope } from '../scope.js';
import { CoolifyDeployNotQueuedError, CoolifyNotFoundError, CoolifyWaitTimeoutError } from '../../errors/index.js';
import { isTerminalDeploymentStatus } from '../../client/deployment-status.js';
import type { CoolifyClient } from '../../client/coolify.js';
import type { Deployment } from '../../client/schemas.js';
import { withoutLogs } from './deployments.js';

export interface DeployOutcome {
  code: number;
  /** The run's single JSON document. */
  doc: Record<string, unknown>;
}

/**
 * Deploy switches that do not fit the target, as a message — or undefined when they do. Checked
 * before anything is sent (and by `flag set --redeploy` before it writes the env).
 */
export function deployFlagProblem(args: Pick<ParsedArgs, 'force' | 'latest' | 'restart' | 'app'>, kind: string): string | undefined {
  const app = args.app ?? '<target>';
  if (args.force && (args.restart || kind !== 'application')) {
    return kind === 'service'
      ? `--force (no-cache rebuild) only exists for applications. For a service, pull fresh images with: coolify-harness deploy --app ${app} --restart --latest`
      : '--force (no-cache rebuild) only applies to an application deploy, not to --restart or a database.';
  }
  if (args.latest && (!args.restart || kind !== 'service')) {
    return kind === 'application'
      ? `--latest only applies to a service restart. To rebuild an application from scratch use: coolify-harness deploy --app ${app} --force`
      : '--latest only applies to a service restart: deploy --app <service> --restart --latest';
  }
  return undefined;
}

const isProduction = (d: Deployment): boolean => (d.pull_request_id ?? 0) === 0;
const isRunning = (d: Deployment): boolean => !isTerminalDeploymentStatus(d.status);

/**
 * Coolify answers an application deploy / restart with "queued" and a deployment uuid even when
 * the server's deployment queue is full and no deployment was created. One read tells: a 404 on
 * the uuid it just returned means nothing was queued. Any other failure of that read (a token
 * without `read`, a network blip) leaves the acknowledgement standing.
 */
async function assertQueued(client: Pick<CoolifyClient, 'getDeployment'>, uuid: string, action: string, app: string): Promise<void> {
  try {
    await client.getDeployment(uuid);
  } catch (err) {
    if (!(err instanceof CoolifyNotFoundError)) return;
    throw new CoolifyDeployNotQueuedError(
      `Coolify acknowledged the ${action} but created no deployment ${uuid}: the server's deployment queue is full (its deployment_queue_limit). Nothing was queued. Retry once it has drained: coolify-harness deployments --app ${app}`,
    );
  }
}

/**
 * The production deployment Coolify means when it skips a request with "already queued for this
 * commit" (it does not say which). Preview (pull request) deployments share the list and are never
 * it. `running: false` means it ended between Coolify's answer and this read.
 */
async function findExistingDeployment(client: Pick<CoolifyClient, 'listDeployments' | 'get'>): Promise<{ deployment: Deployment; running: boolean } | undefined> {
  let production: Deployment[] = [];
  // Newest first, each row with its build log. A burst of preview builds can fill the first page.
  for (const page of [{ skip: 0, take: 10 }, { skip: 10, take: 20 }]) {
    const rows = await client.listDeployments(page);
    production = production.concat(rows.filter(isProduction));
    if (production.length > 0 || rows.length < page.take) break;
  }
  const running = production.filter(isRunning);
  if (running.length === 1) return { deployment: running[0]!, running: true }; // reason: length checked
  if (running.length > 1) {
    // Several are queued or building (a webhook push next to a manual deploy): Coolify skipped
    // because of the one for the commit a plain deploy asks for.
    let wanted = 'HEAD';
    try {
      wanted = (await client.get()).git_commit_sha || 'HEAD';
    } catch {
      // fall back to the default ref
    }
    return { deployment: running.find((d) => d.commit === wanted) ?? running[0]!, running: true }; // reason: length checked
  }
  // Nothing is running any more: the one that made Coolify skip has just ended, and it is the
  // production deployment that changed last.
  const last = [...production].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
  return last ? { deployment: last, running: false } : undefined;
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
  const problem = deployFlagProblem(args, target.kind);
  if (problem !== undefined) return { code: usageFail(args, problem), doc: {} };
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
  }, async () => {
    const answer = await withScope('deploy', () => (args.restart
      ? client.restart(args.latest ? { latest: true } : {})
      : client.deploy(args.force ? { force: true } : {})));
    // Inside the audited step: a deploy that was not queued is recorded as a failure.
    if (target.kind === 'application' && answer.deploymentUuid) await assertQueued(client, answer.deploymentUuid, action, app);
    return answer;
  });

  const ackInfo = { action, ...options, message: ack.message, deploymentUuid: ack.deploymentUuid ?? null };

  if (!args.json) {
    print(`${action}: ${ack.message}${ack.deploymentUuid ? ` (${ack.deploymentUuid})` : ''}`);
  }

  // Coolify answers without a deployment uuid when it SKIPPED the request because the same commit
  // is already queued or building. `--wait` then reports on THAT deployment: saying "done" here
  // would mean "deployed" while the build is still running, or after it failed.
  let waitUuid = ack.deploymentUuid;
  let followed = false;
  let ended: Deployment | undefined;
  if (args.wait && !waitUuid && target.kind === 'application') {
    let existing;
    try {
      existing = await withScope('read', () => findExistingDeployment(client));
      if (!existing) {
        throw new CoolifyNotFoundError(
          `Coolify queued nothing new (${ack.message}) and none of the application's recent deployments is a production one, so there is nothing to follow. Check: coolify-harness deployments --app ${app}`,
        );
      }
    } catch (err) {
      // Not knowing is not "nothing to wait for": say what was acknowledged, then fail.
      if (err && typeof err === 'object') Object.assign(err, { partialDoc: { ...ackInfo, finalStatus: null, waitFailed: true } });
      throw err;
    }
    followed = true;
    if (existing.running) {
      waitUuid = existing.deployment.deployment_uuid;
      if (!args.json) warn(`--wait: Coolify queued nothing new (${ack.message}); following the deployment already in progress: ${waitUuid}`);
    } else {
      ended = existing.deployment;
      if (!args.json) warn(`--wait: Coolify queued nothing new (${ack.message}); the deployment it was busy with has just ended: ${ended.deployment_uuid}`);
    }
  } else if (args.wait && !waitUuid) {
    // Said in the document too: an exit 0 must not read as "waited and it finished".
    const note = `--wait: a ${target.kind} ${action} creates no deployment record, so there was nothing to wait for; check \`coolify-harness status --app ${app}\`.`;
    if (!args.json) warn(note);
    return { code: EXIT.ok, doc: { ...ackInfo, waited: false, note } };
  }

  const uuid = waitUuid ?? ended?.deployment_uuid;
  if (args.wait && uuid) {
    const info = followed ? { ...ackInfo, deploymentUuid: uuid, followedExisting: true } : ackInfo;
    let final = ended;
    if (!final) {
      if (!args.json) print(`--wait: polling deployment ${uuid} until terminal status...`);
      // Ctrl-C — or the SIGTERM of a caller whose own timeout ran out — stops the WAIT, not the
      // deployment: say so, with the uuid, and how to pick it up again.
      const abort = new AbortController();
      const onSigint = (): void => { abort.abort(new Error('interrupted')); };
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigint);
      try {
        final = await withScope('read', () => client.waitForDeployment(uuid, {
          ...(args.timeout !== undefined ? { timeoutMs: args.timeout * 1000 } : {}),
          onStatus: (s) => { if (!args.json) warn(`  status: ${s}`); },
          signal: abort.signal,
        }));
      } catch (err) {
        if (abort.signal.aborted) {
          const message = `--wait interrupted. Deployment ${uuid} keeps running in Coolify. Follow it: coolify-harness deployment ${uuid} --app ${app} — or stop it: coolify-harness deployment cancel ${uuid} --app ${app} --apply`;
          return { code: emitError(args, 'INTERRUPTED', message, 130, { deploymentUuid: uuid }), doc: { ...info, finalStatus: null, interrupted: true } };
        }
        // Whatever went wrong while waiting, the deployment was queued: the error must carry its uuid.
        const failure = err instanceof CoolifyNotFoundError && !followed
          ? new CoolifyDeployNotQueuedError(`${err.message}. Coolify acknowledged the ${action} but has no deployment ${uuid}: it was not queued (its deployment queue is full). Check \`coolify-harness deployments --app ${app}\`.`)
          : err;
        if (failure instanceof CoolifyWaitTimeoutError) {
          failure.message = `--wait gave up after ${Math.round(failure.timeoutMs / 1000)}s: deployment ${uuid} is still ${failure.lastStatus ?? 'not answering'} in Coolify, where it keeps running. Follow it: coolify-harness deployment ${uuid} --app ${app} --no-logs (a longer wait: --timeout <seconds>)`;
        }
        // `partialDoc` is what did happen; the caller prints it before reporting the error.
        if (failure && typeof failure === 'object') {
          Object.assign(failure, { deploymentUuid: uuid, partialDoc: { ...info, finalStatus: null, waitFailed: true } });
        }
        if (!args.json) warn(`--wait failed; deployment ${uuid} may still be running: coolify-harness deployment ${uuid} --app ${app}`);
        throw failure;
      } finally {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigint);
      }
    }
    const ok = final.status === 'finished';
    const doc = { ...info, finalStatus: final.status, finalDeployment: args.noLogs ? withoutLogs(final) : final };
    if (!args.json) {
      print(`${action} ${ok ? 'finished' : 'did NOT finish'}: status=${final.status}`);
      if (!ok) print(`build logs: coolify-harness logs --app ${app} --build --deployment ${uuid}`);
    }
    if (ok) return { code: EXIT.ok, doc };
    // The document on stdout has the detail; the error document on stderr states the failure.
    if (args.json) emitError(args, 'DEPLOY_FAILED', `Deployment ${uuid} ended with status ${final.status}`, EXIT.deployFailed, { deploymentUuid: uuid, finalStatus: final.status });
    return { code: EXIT.deployFailed, doc };
  }

  return { code: EXIT.ok, doc: ackInfo };
}

/** What a failed step had already achieved (attached to the error it threw), if anything. */
export function partialDocOf(err: unknown): Record<string, unknown> | undefined {
  const doc = err && typeof err === 'object' ? (err as { partialDoc?: unknown }).partialDoc : undefined; // reason: probing an optional property set by runDeploy
  return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : undefined; // reason: narrowed to a non-null object just above
}

export async function deployCmd(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  let outcome: DeployOutcome;
  try {
    outcome = await runDeploy(args, deps);
  } catch (err) {
    // A deployment that was queued before the failure must still be reported.
    const partial = partialDocOf(err);
    if (args.json && partial) printJson(partial);
    throw err;
  }
  if (args.json && Object.keys(outcome.doc).length > 0) printJson(outcome.doc);
  return outcome.code;
}
