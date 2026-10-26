import { writeFile as nodeWriteFile } from 'node:fs/promises';
import type { ParsedArgs } from './args.js';
import type { CoolifyClient } from '../client/coolify.js';
import type { CoolifyInstanceClient } from '../client/instance.js';
import type { ResolvedTarget } from '../config/schema.js';
import { buildAuditRecord, type AuditRecord } from '../client/safe-write.js';
import { redactDeep } from '../client/redact.js';

export type TargetClient = Pick<
  CoolifyClient,
  | 'listEnvs' | 'upsertEnvs' | 'deleteEnv'
  | 'deploy' | 'restart'
  | 'get' | 'getService' | 'getDatabase' | 'updateServiceCompose'
  | 'getRuntimeLogs'
  | 'listDeployments' | 'getDeployment' | 'getLatestDeployment' | 'getLatestBuildLogs'
  | 'waitForDeployment' | 'cancelDeployment'
>;

export type InstanceClient = Pick<
  CoolifyInstanceClient,
  | 'instanceUrl' | 'getVersion' | 'getHealth'
  | 'listRunningDeployments' | 'getDeployment' | 'cancelDeployment'
  | 'listServers' | 'getServer' | 'getServerResources'
  | 'getServerProxy' | 'saveServerProxyConfiguration' | 'restartServerProxy'
  | 'listDatabases' | 'getDatabase' | 'updateDatabase' | 'listDatabaseBackups' | 'runDatabaseBackup'
>;

/** Everything a command needs from the outside world; injected so tests never touch the network. */
export interface CmdDeps {
  resolveTargetFor: (args: ParsedArgs) => ResolvedTarget;
  clientFactory: (target: ResolvedTarget) => TargetClient;
  /** Instance named by --instance, else the instance of --app's target. */
  instanceFor?: (args: ParsedArgs) => { name: string; client: InstanceClient };
  actor: string;
  auditSink: (record: AuditRecord) => Promise<void>;
  now?: () => Date;
  readFile?: (path: string) => Promise<string>;
  /** Writes an unredacted document for --out (mode 0600). */
  writeFile?: (path: string, content: string) => Promise<void>;
}

export const defaultWriteFile = (path: string, content: string): Promise<void> =>
  nodeWriteFile(path, content, { encoding: 'utf8', mode: 0o600 });

export function requireInstance(args: ParsedArgs, deps: CmdDeps): { name: string; client: InstanceClient } {
  if (!deps.instanceFor) throw new Error('instance-scoped commands are not wired in this context');
  return deps.instanceFor(args);
}

export const print = (line = ''): void => { process.stdout.write(`${line}\n`); };
export const warn = (line: string): void => { process.stderr.write(`${line}\n`); };

/** JSON output for agents: always redacted, never prose. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(redactDeep(value), null, 2)}\n`);
}

export async function audit(
  deps: CmdDeps,
  record: {
    instanceUrl: string;
    kind: AuditRecord['resourceKind'];
    uuid: string;
    action: AuditRecord['action'];
    keysAffected?: string[];
    options?: Record<string, string | number | boolean>;
    outcome?: AuditRecord['outcome'];
    error?: string;
  },
): Promise<void> {
  const now = (deps.now ?? ((): Date => new Date()))();
  await deps.auditSink(buildAuditRecord({
    now,
    actor: deps.actor,
    target: { instanceUrl: record.instanceUrl, kind: record.kind, uuid: record.uuid },
    action: record.action,
    keysAffected: record.keysAffected ?? [],
    ...(record.options !== undefined ? { options: record.options } : {}),
    outcome: record.outcome ?? 'success',
    ...(record.error !== undefined ? { error: record.error } : {}),
  }));
}

/**
 * Run a mutation and audit it whatever happens (keys/options only). A failed mutation is recorded
 * with outcome=failure and the error message, then rethrown.
 */
export async function audited<T>(
  deps: CmdDeps,
  record: Omit<Parameters<typeof audit>[1], 'outcome' | 'error'>,
  op: () => Promise<T>,
): Promise<T> {
  try {
    const result = await op();
    await audit(deps, record);
    return result;
  } catch (err) {
    await audit(deps, { ...record, outcome: 'failure', error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
