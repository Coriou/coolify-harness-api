import { audited, emitError, print, printJson, warn, usageFail } from '../deps.js';
import { EXIT } from '../exit.js';
import { withScope } from '../scope.js';
import { CoolifyNotFoundError } from '../../errors/index.js';
import { isTerminalDeploymentStatus } from '../../client/deployment-status.js';
import { withoutLogs } from './deployments.js';
/**
 * `deploy`: explicit redeploy (applications) / start (services, databases), or `--restart`.
 * `--force` rebuilds an application without the Docker cache (needed to pick up a patched base
 * image — a plain redeploy of an unchanged commit reuses the old image). `--restart --latest`
 * pulls fresh images for a service. `--wait` polls an application deployment to its terminal
 * status and exits 7 if it failed or was cancelled. `--dry-run` sends nothing.
 */
export async function runDeploy(args, deps) {
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
    const options = {
        ...(args.force ? { force: true } : {}),
        ...(args.latest ? { latest: true } : {}),
    };
    if (args.dryRun) {
        const doc = { dryRun: true, action, ...options, target: { name: args.app ?? null, kind: target.kind, uuid: target.uuid } };
        if (!args.json)
            print(`would ${action} ${app} (${target.kind} ${target.uuid})${args.force ? ' with --force (no cache)' : ''}${args.latest ? ' pulling latest images' : ''}. Nothing was sent; drop --dry-run to run it.`);
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
    // Coolify answers without a deployment uuid when it SKIPPED the request because the same commit
    // is already queued or building. `--wait` then follows that deployment: reporting success here
    // would say "deployed" while the build is still running.
    let waitUuid = ack.deploymentUuid;
    let followed = false;
    let skipped = false;
    if (args.wait && !waitUuid && target.kind === 'application') {
        let recent;
        try {
            recent = await withScope('read', () => client.listDeployments({ take: 10 }));
        }
        catch (err) {
            // Not knowing is not "nothing to wait for": say what was acknowledged, then fail.
            if (err && typeof err === 'object')
                Object.assign(err, { partialDoc: { ...ackInfo, finalStatus: null, waitFailed: true } });
            throw err;
        }
        // The list is newest first and holds preview (pull request) deployments too: follow the
        // newest PRODUCTION deployment that is still running.
        const running = recent.find((d) => !isTerminalDeploymentStatus(d.status) && (d.pull_request_id ?? 0) === 0);
        if (running) {
            waitUuid = running.deployment_uuid;
            followed = true;
            if (!args.json)
                warn(`--wait: Coolify queued nothing new (${ack.message}); following the deployment already in progress: ${waitUuid}`);
        }
        else {
            skipped = true;
            if (!args.json)
                warn('--wait: Coolify returned no deployment uuid and nothing is queued or building; nothing to wait for.');
        }
    }
    else if (args.wait && !waitUuid && !args.json) {
        warn(`--wait: a ${target.kind} ${action} creates no deployment record; check \`status\` instead.`);
    }
    if (args.wait && waitUuid) {
        const uuid = waitUuid;
        const info = followed ? { ...ackInfo, deploymentUuid: uuid, followedExisting: true } : ackInfo;
        if (!args.json)
            print(`--wait: polling deployment ${uuid} until terminal status...`);
        // Ctrl-C stops the WAIT, not the deployment: say so, and how to pick it up again.
        const abort = new AbortController();
        const onSigint = () => { abort.abort(new Error('interrupted')); };
        process.once('SIGINT', onSigint);
        let final;
        try {
            final = await withScope('read', () => client.waitForDeployment(uuid, {
                ...(args.timeout !== undefined ? { timeoutMs: args.timeout * 1000 } : {}),
                onStatus: (s) => { if (!args.json)
                    warn(`  status: ${s}`); },
                signal: abort.signal,
            }));
        }
        catch (err) {
            if (abort.signal.aborted) {
                const message = `--wait interrupted. Deployment ${uuid} keeps running in Coolify. Follow it: coolify-harness deployment ${uuid} --app ${app} — or stop it: coolify-harness deployment cancel ${uuid} --app ${app} --apply`;
                return { code: emitError(args, 'INTERRUPTED', message, 130, { deploymentUuid: uuid }), doc: { ...info, finalStatus: null, interrupted: true } };
            }
            // Whatever went wrong while waiting, the deployment was queued: the error must carry its uuid.
            const failure = err instanceof CoolifyNotFoundError
                ? new CoolifyNotFoundError(`${err.message}. Coolify acknowledged the ${action} but has no deployment ${uuid}: it was not queued (queue full, or skipped). Check \`coolify-harness deployments --app ${app}\`.`)
                : err;
            // `partialDoc` is what did happen; the caller prints it before reporting the error.
            if (failure && typeof failure === 'object') {
                Object.assign(failure, { deploymentUuid: uuid, partialDoc: { ...info, finalStatus: null, waitFailed: true } });
            }
            if (!args.json)
                warn(`--wait failed; deployment ${uuid} may still be running: coolify-harness deployment ${uuid} --app ${app}`);
            throw failure;
        }
        finally {
            process.removeListener('SIGINT', onSigint);
        }
        const ok = final.status === 'finished';
        const doc = { ...info, finalStatus: final.status, finalDeployment: args.noLogs ? withoutLogs(final) : final };
        if (!args.json) {
            print(`${action} ${ok ? 'finished' : 'did NOT finish'}: status=${final.status}`);
            if (!ok)
                print(`build logs: coolify-harness logs --app ${app} --build --deployment ${uuid}`);
        }
        if (ok)
            return { code: EXIT.ok, doc };
        // The document on stdout has the detail; the error document on stderr states the failure.
        if (args.json)
            emitError(args, 'DEPLOY_FAILED', `Deployment ${uuid} ended with status ${final.status}`, EXIT.deployFailed, { deploymentUuid: uuid, finalStatus: final.status });
        return { code: EXIT.deployFailed, doc };
    }
    if (skipped)
        return { code: EXIT.ok, doc: { ...ackInfo, skipped: true } };
    return { code: EXIT.ok, doc: ackInfo };
}
/** What a failed step had already achieved (attached to the error it threw), if anything. */
export function partialDocOf(err) {
    const doc = err && typeof err === 'object' ? err.partialDoc : undefined; // reason: probing an optional property set by runDeploy
    return doc && typeof doc === 'object' ? doc : undefined; // reason: narrowed to a non-null object just above
}
export async function deployCmd(args, deps) {
    let outcome;
    try {
        outcome = await runDeploy(args, deps);
    }
    catch (err) {
        // A deployment that was queued before the failure must still be reported.
        const partial = partialDocOf(err);
        if (args.json && partial)
            printJson(partial);
        throw err;
    }
    if (args.json && Object.keys(outcome.doc).length > 0)
        printJson(outcome.doc);
    return outcome.code;
}
