import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
import { audit, audited, emitError, print, printJson, warn, usageFail } from '../deps.js';
import { EXIT } from '../exit.js';
import { withScope } from '../scope.js';
import { CoolifyContractError, CoolifyDeployNotQueuedError, CoolifyNotFoundError, CoolifyWaitTimeoutError } from '../../errors/index.js';
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

/** Coolify's own "no such deployment" — not the bare 404 of the proxy in front of it while it restarts. */
const isCoolify404 = (err: unknown): boolean => err instanceof CoolifyNotFoundError && err.serverMessage !== undefined;

/** How long the "was it really queued?" read may take before the acknowledgement is left to stand. */
const VERIFY_TIMEOUT_MS = 10_000;
/** A deployment that ended this recently is "the one Coolify was busy with a moment ago". */
const JUST_ENDED_MS = 120_000;

/**
 * Coolify answers an application deploy / restart with "queued" and a deployment uuid even when
 * the server's deployment queue is full and no deployment was created. One bounded read tells:
 * `missing` when Coolify itself says it has no such deployment. Anything else that goes wrong
 * with that read (a token without `read`, a network blip, a proxy's 404, no answer in time) is
 * `unknown`, and the acknowledgement stands.
 */
async function queuedState(client: Pick<CoolifyClient, 'getDeployment'>, uuid: string, signal: AbortSignal): Promise<'queued' | 'missing' | 'unknown'> {
  try {
    await client.getDeployment(uuid, { signal: AbortSignal.any([signal, AbortSignal.timeout(VERIFY_TIMEOUT_MS)]) });
    return 'queued';
  } catch (err) {
    return isCoolify404(err) ? 'missing' : 'unknown';
  }
}

/**
 * The production deployment Coolify means when it skips a request with "already queued for this
 * commit" (it does not say which). It skipped because a deployment of the commit a plain deploy
 * asks for — the application's pinned sha, else `HEAD` — was queued or building at that moment:
 * - one of that commit is still running → that one;
 * - none is, but one of that commit ended moments ago → that one, with `running: false`;
 * - no row carries that commit (the deployment job replaces `HEAD` by the sha it resolved) →
 *   the newest production deployment still running.
 * Otherwise undefined: an older deployment is never passed off as this one. Preview (pull
 * request) deployments share the list and are never it.
 */
async function findExistingDeployment(client: Pick<CoolifyClient, 'listDeployments' | 'get'>, nowMs: number): Promise<{ deployment: Deployment; running: boolean } | undefined> {
  let production: Deployment[] = [];
  // Newest first, each row with its build log. A burst of preview builds can fill the first page.
  for (const page of [{ skip: 0, take: 10 }, { skip: 10, take: 20 }]) {
    const rows = await client.listDeployments(page);
    production = production.concat(rows.filter(isProduction));
    if (production.length > 0 || rows.length < page.take) break;
  }
  if (production.length === 0) return undefined;
  let wanted = 'HEAD';
  try {
    wanted = (await client.get()).git_commit_sha || 'HEAD';
  } catch {
    // fall back to the default ref
  }
  const sameCommit = production.filter((d) => d.commit === wanted);
  const running = sameCommit.find(isRunning);
  if (running) return { deployment: running, running: true };
  const endedAt = (d: Deployment): number => Date.parse(d.finished_at ?? d.updated_at ?? '');
  const last = [...sameCommit].sort((x, y) => (y.updated_at ?? '').localeCompare(x.updated_at ?? ''))[0];
  if (last && Math.abs(nowMs - endedAt(last)) <= JUST_ENDED_MS) return { deployment: last, running: false };
  const anyRunning = production.find(isRunning);
  return anyRunning ? { deployment: anyRunning, running: true } : undefined;
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
  const action: 'restart' | 'deploy' = args.restart ? 'restart' : 'deploy';
  const options: Record<string, boolean> = {
    ...(args.force ? { force: true } : {}),
    ...(args.latest ? { latest: true } : {}),
  };

  if (args.dryRun) {
    const doc = { dryRun: true, action, ...options, target: { name: args.app ?? null, kind: target.kind, uuid: target.uuid } };
    if (!args.json) print(`would ${action} ${app} (${target.kind} ${target.uuid})${args.force ? ' with --force (no cache)' : ''}${args.latest ? ' pulling latest images' : ''}. Nothing was sent; drop --dry-run to run it.`);
    return { code: EXIT.ok, doc };
  }

  const auditRecord = {
    instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid, action,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
  // Audited and shown as soon as Coolify has answered: whatever is checked or waited for next
  // can hang or be interrupted, and the request that was made must not go unrecorded.
  const ack = await audited(deps, auditRecord, () => withScope('deploy', () => (args.restart
    ? client.restart(args.latest ? { latest: true } : {})
    : client.deploy(args.force ? { force: true } : {}))));

  const ackInfo: Record<string, unknown> = {
    action, ...options, message: ack.message, deploymentUuid: ack.deploymentUuid ?? null,
    ...(ack.unrecognised ? { unrecognised: true } : {}),
  };
  if (!args.json) {
    print(`${action}: ${ack.message}${ack.deploymentUuid ? ` (${ack.deploymentUuid})` : ''}`);
  }

  if (target.kind !== 'application') {
    if (!args.wait) return { code: EXIT.ok, doc: ackInfo };
    // Said in the document too: an exit 0 must not read as "waited and it finished".
    const note = `--wait: a ${target.kind} ${action} creates no deployment record, so there was nothing to wait for; check \`coolify-harness status --app ${app}\`.`;
    if (!args.json) warn(note);
    return { code: EXIT.ok, doc: { ...ackInfo, waited: false, note } };
  }

  /** Coolify said "queued" for a deployment it does not have: a second audit record says so. */
  const notQueued = async (uuid: string): Promise<CoolifyDeployNotQueuedError> => {
    const error = new CoolifyDeployNotQueuedError(
      `Coolify acknowledged the ${action} but has no deployment ${uuid}: the server's deployment queue is full (its deployment_queue_limit). Nothing was queued. Retry once it has drained: coolify-harness deployments --app ${app}`,
    );
    await audit(deps, { ...auditRecord, outcome: 'failure', error: error.message });
    return error;
  };

  // Ctrl-C — or the SIGTERM of a caller whose own timeout ran out — stops the CHECK or the WAIT,
  // not the deployment: say so, with the uuid, and how to pick it up again.
  const abort = new AbortController();
  const onSignal = (): void => { abort.abort(new Error('interrupted')); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const interrupted = (uuid: string | undefined, info: Record<string, unknown>): DeployOutcome => {
    const message = uuid
      ? `${args.wait ? '--wait interrupted' : 'Interrupted'}. Deployment ${uuid} keeps running in Coolify. Follow it: coolify-harness deployment ${uuid} --app ${app} — or stop it: coolify-harness deployment cancel ${uuid} --app ${app} --apply`
      : `Interrupted after Coolify acknowledged the ${action} (${ack.message}). Check: coolify-harness deployments --app ${app}`;
    return { code: emitError(args, 'INTERRUPTED', message, 130, uuid ? { deploymentUuid: uuid } : {}), doc: { ...info, finalStatus: null, interrupted: true } };
  };

  try {
    let waitUuid = ack.deploymentUuid;
    if (!args.wait) {
      if (!waitUuid) return { code: EXIT.ok, doc: ackInfo };
      const state = await queuedState(client, waitUuid, abort.signal);
      if (abort.signal.aborted) return interrupted(waitUuid, ackInfo);
      if (state === 'missing') throw await notQueued(waitUuid);
      return { code: EXIT.ok, doc: ackInfo };
    }

    // Coolify answers without a deployment uuid when it SKIPPED the request because the same
    // commit is already queued or building. `--wait` then reports on THAT deployment: saying
    // "done" here would mean "deployed" while the build is still running, or after it failed.
    let followed = false;
    let ended: Deployment | undefined;
    if (!waitUuid) {
      let existing;
      try {
        // An acknowledgement that could not be read is not "skipped": which deployment it
        // queued, if any, is unknown — and an older one must not be reported in its place.
        if (ack.unrecognised) {
          throw new CoolifyContractError(
            `Coolify accepted the ${action}, but its acknowledgement could not be read, so the deployment to wait for is unknown. One may have been queued: check \`coolify-harness deployments --app ${app}\` before deploying again.`,
            { zodIssues: 'unrecognised acknowledgement' },
          );
        }
        existing = await withScope('read', () => findExistingDeployment(client, (deps.now ?? ((): Date => new Date()))().getTime()));
        if (!existing) {
          throw new CoolifyNotFoundError(
            `Coolify queued nothing new (${ack.message}), and the deployment it refers to could not be identified among the application's recent ones. Check: coolify-harness deployments --app ${app}`,
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
    }

    const uuid = waitUuid ?? ended?.deployment_uuid ?? '';
    const info = followed ? { ...ackInfo, deploymentUuid: uuid, followedExisting: true } : ackInfo;
    let final = ended;
    if (!final) {
      if (!args.json) print(`--wait: polling deployment ${uuid} until terminal status...`);
      try {
        final = await withScope('read', () => client.waitForDeployment(uuid, {
          ...(args.timeout !== undefined ? { timeoutMs: args.timeout * 1000 } : {}),
          onStatus: (s) => { if (!args.json) warn(`  status: ${s}`); },
          signal: abort.signal,
        }));
      } catch (err) {
        if (abort.signal.aborted) return interrupted(uuid, info);
        // The first poll doubles as the "was it really queued?" check (see queuedState).
        const failure = isCoolify404(err) && !followed ? await notQueued(uuid) : err;
        if (failure instanceof CoolifyWaitTimeoutError) {
          failure.message = `--wait gave up after ${Math.round(failure.timeoutMs / 1000)}s: deployment ${uuid} is still ${failure.lastStatus ?? 'not answering'} in Coolify, where it keeps running. Follow it: coolify-harness deployment ${uuid} --app ${app} --no-logs (a longer wait: --timeout <seconds>)`;
        }
        // `partialDoc` is what did happen; the caller prints it before reporting the error.
        if (failure && typeof failure === 'object') {
          Object.assign(failure, { deploymentUuid: uuid, partialDoc: { ...info, finalStatus: null, waitFailed: true } });
        }
        if (!args.json && !(failure instanceof CoolifyDeployNotQueuedError)) warn(`--wait failed; deployment ${uuid} may still be running: coolify-harness deployment ${uuid} --app ${app}`);
        throw failure;
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
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
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
