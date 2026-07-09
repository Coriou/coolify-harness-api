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
    process.stdout.write(`${action}: ${ack.message}${ack.deploymentUuid ? ` (${ack.deploymentUuid})` : ''}\n`);
    if (args.wait && ack.deploymentUuid) {
        process.stdout.write(`--wait: polling deployment ${ack.deploymentUuid} until terminal status...\n`);
        try {
            const final = await withScope('read:sensitive', () => client.waitForDeployment(ack.deploymentUuid));
            process.stdout.write(`deploy finished: status=${final.status}\n`);
            if (final.logs) {
                // For --json callers they can re-query; for human show a hint only
                if (!args.json) {
                    process.stdout.write('(build logs available via: deployment ' + ack.deploymentUuid + ' --app ' + args.app + ' --json)\n');
                }
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stdout.write(`wait error: ${msg}\n`);
            return EXIT.internal;
        }
    }
    return EXIT.ok;
}
