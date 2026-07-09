import { buildAuditRecord } from '../../client/safe-write.js';
import { EXIT } from '../main.js';
import { withScope } from '../scope.js';
const EMPTY_PLAN = { creates: [], updates: [], unchanged: [], duplicateKeyDrift: [], lockedSkips: [], warnings: [] };
export async function deployCmd(args, deps) {
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    const now = (deps.now ?? (() => new Date()))();
    const action = args.restart ? 'restart' : 'deploy';
    const ack = await withScope('deploy', () => args.restart ? client.restart() : client.deploy());
    await deps.auditSink(buildAuditRecord({
        now, actor: deps.actor,
        target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
        action, plan: EMPTY_PLAN, keysAffected: [], outcome: 'success',
    }));
    const ackInfo = { action, message: ack.message, deploymentUuid: ack.deploymentUuid ?? null };
    if (!args.json) {
        process.stdout.write(`${action}: ${ack.message}${ack.deploymentUuid ? ` (${ack.deploymentUuid})` : ''}\n`);
    }
    if (args.wait && ack.deploymentUuid) {
        if (!args.json) {
            process.stdout.write(`--wait: polling deployment ${ack.deploymentUuid} until terminal status...\n`);
        }
        try {
            const final = await withScope('read:sensitive', () => client.waitForDeployment(ack.deploymentUuid));
            if (args.json) {
                process.stdout.write(JSON.stringify({ ...ackInfo, finalStatus: final.status, finalDeployment: final }, null, 2) + '\n');
            }
            else {
                process.stdout.write(`deploy finished: status=${final.status}\n`);
                if (final.logs) {
                    // For --json callers they can re-query; for human show a hint only
                    process.stdout.write('(build logs available via: deployment ' + ack.deploymentUuid + ' --app ' + args.app + ' --json)\n');
                }
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stderr.write(`wait error: ${msg}\n`);
            return EXIT.internal;
        }
        return EXIT.ok;
    }
    if (args.json) {
        process.stdout.write(JSON.stringify(ackInfo, null, 2) + '\n');
    }
    return EXIT.ok;
}
