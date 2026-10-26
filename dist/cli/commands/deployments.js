import { isTerminalDeploymentStatus } from '../../client/schemas.js';
import { audited, print, printJson, requireInstance, warn } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../main.js';
/** Deployment lookups work with --app (its instance) or --instance; the uuid is instance-global. */
function deploymentReader(args, deps) {
    if (args.app && !args.instance) {
        const target = deps.resolveTargetFor(args);
        const client = deps.clientFactory(target);
        return { instanceUrl: target.instanceUrl, get: (u) => client.getDeployment(u), cancel: (u) => client.cancelDeployment(u) };
    }
    const { client } = requireInstance(args, deps);
    return { instanceUrl: client.instanceUrl, get: (u) => client.getDeployment(u), cancel: (u) => client.cancelDeployment(u) };
}
function printDeploymentLine(d) {
    print(`  ${d.deployment_uuid}  [${d.status}]  ${d.application_name ?? ''}  ${d.commit ?? ''}  ${d.updated_at ?? d.created_at ?? ''}`);
}
export async function deploymentsCmd(args, deps) {
    if (!args.app && !args.instance) {
        const label = args.command === 'deployment' ? 'deployment <uuid>' : 'deployments';
        warn(`${label}: --app <name> or --instance <name> is required`);
        return EXIT.usage;
    }
    // Single deployment: "deployment <uuid>" or --deployment
    const singleUuid = args.deployment;
    if (singleUuid) {
        const reader = deploymentReader(args, deps);
        const d = await withScope('read', () => reader.get(singleUuid));
        if (args.json) {
            printJson(d);
        }
        else {
            print(`deployment ${d.deployment_uuid} [${d.status}]`);
            if (d.application_name)
                print(`application: ${d.application_name}`);
            if (d.commit)
                print(`commit: ${d.commit} ${d.commit_message ?? ''}`);
            if (d.created_at)
                print(`created: ${d.created_at}`);
            if (d.finished_at)
                print(`finished: ${d.finished_at}`);
            print('logs:');
            print(d.logs ?? '(none — needs read:sensitive, or not written yet)');
            print('NOTE: use --json for full machine-readable output.');
        }
        return EXIT.ok;
    }
    // Team-wide queue: --instance without --app, or --running
    if (!args.app || args.running) {
        const { name, client } = requireInstance(args, deps);
        const list = await withScope('read', () => client.listRunningDeployments());
        if (args.json) {
            printJson(list);
            return EXIT.ok;
        }
        print(`queued / in-progress deployments on ${name}: ${list.length}`);
        for (const d of list)
            printDeploymentLine(d);
        return EXIT.ok;
    }
    // History for one application
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    const listOpts = { take: args.take ?? 10 };
    if (args.skip !== undefined)
        listOpts.skip = args.skip;
    const list = await withScope('read', () => client.listDeployments(listOpts));
    if (args.json) {
        printJson(list);
        return EXIT.ok;
    }
    if (target.kind !== 'application') {
        print(`${args.app} is a ${target.kind}: ${target.kind}s are started/restarted directly and have no deployment history.`);
        return EXIT.ok;
    }
    print(`recent deployments for ${args.app} (showing ${list.length})`);
    for (const d of list)
        printDeploymentLine(d);
    print('NOTE: use --json for full machine-readable output. Use "deployment <UUID> --app X" for full logs.');
    return EXIT.ok;
}
/** `deployment cancel <uuid>`: dry-run unless --apply; a finished deployment is reported, not an error. */
export async function deploymentCancelCmd(args, deps) {
    const uuid = args.deployment;
    if (!uuid || (!args.app && !args.instance)) {
        warn('deployment cancel <uuid>: the deployment uuid and --app <name> or --instance <name> are required');
        return EXIT.usage;
    }
    const reader = deploymentReader(args, deps);
    const current = await withScope('read', () => reader.get(uuid));
    if (isTerminalDeploymentStatus(current.status)) {
        if (args.json)
            printJson({ deployment_uuid: uuid, status: current.status, cancelled: false, reason: 'already terminal' });
        else
            print(`deployment ${uuid} is already ${current.status}; nothing to cancel.`);
        return EXIT.ok;
    }
    if (!args.apply) {
        if (args.json)
            printJson({ dryRun: true, deployment_uuid: uuid, status: current.status, application: current.application_name ?? null });
        else
            print(`would cancel deployment ${uuid} [${current.status}] of ${current.application_name ?? '?'}. Re-run with --apply.`);
        return EXIT.ok;
    }
    const res = await audited(deps, { instanceUrl: reader.instanceUrl, kind: 'deployment', uuid, action: 'deployment.cancel' }, () => withScope('deploy', () => reader.cancel(uuid)));
    if (args.json)
        printJson(res);
    else
        print(`${res.message} (status: ${res.status ?? '?'})`);
    return EXIT.ok;
}
