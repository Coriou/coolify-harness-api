import type { ParsedArgs } from '../args.js';
import type { EnvCmdDeps } from './env.js';
import { buildAuditRecord, type EnvWritePlan } from '../../client/safe-write.js';
import { EXIT } from '../main.js';

const EMPTY_PLAN: EnvWritePlan = { creates: [], updates: [], unchanged: [], duplicateKeyDrift: [], lockedSkips: [], warnings: [] };

export async function deployCmd(args: ParsedArgs, deps: EnvCmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  const now = (deps.now ?? ((): Date => new Date()))();
  const action = args.restart ? 'restart' : 'deploy';
  const ack = args.restart ? await client.restart() : await client.deploy();
  await deps.auditSink(
    buildAuditRecord({
      now, actor: deps.actor,
      target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
      action, plan: EMPTY_PLAN, keysAffected: [], outcome: 'success',
    }),
  );
  process.stdout.write(`${action}: ${ack.message}${ack.deploymentUuid ? ` (${ack.deploymentUuid})` : ''}\n`);
  return EXIT.ok;
}
