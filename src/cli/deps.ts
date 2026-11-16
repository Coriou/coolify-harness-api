import { chmod, writeFile as nodeWriteFile } from 'node:fs/promises';
import type { ParsedArgs } from './args.js';
import type { CoolifyClient } from '../client/coolify.js';
import type { CoolifyInstanceClient } from '../client/instance.js';
import type { ResolvedTarget } from '../config/schema.js';
import { buildAuditRecord, type AuditRecord } from '../client/safe-write.js';
import { redactDeep } from '../client/redact.js';
import { sanitizeErrorMessage } from './errors-out.js';
import { EXIT } from './exit.js';

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

/**
 * Write an unredacted document for `--out`, readable by the owner only. `mode` on writeFile only
 * applies when the file is created, so an existing world-readable file is chmod-ed as well.
 */
export const defaultWriteFile = async (path: string, content: string): Promise<void> => {
  await nodeWriteFile(path, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
};

export function requireInstance(args: ParsedArgs, deps: CmdDeps): { name: string; client: InstanceClient } {
  if (!deps.instanceFor) throw new Error('instance-scoped commands are not wired in this context');
  return deps.instanceFor(args);
}

export const print = (line = ''): void => { process.stdout.write(`${line}\n`); };
export const warn = (line: string): void => { process.stderr.write(`${line}\n`); };

/**
 * Report a usage problem the way the rest of the CLI reports errors — prose on stderr, or with
 * `--json` the `{ "error": { code, message, exitCode } }` document — and return exit code 2.
 */
export function usageFail(args: Pick<ParsedArgs, 'json'>, message: string): number {
  if (args.json) process.stderr.write(`${JSON.stringify({ error: { code: 'USAGE', message, exitCode: EXIT.usage } })}\n`);
  else warn(message);
  return EXIT.usage;
}

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
  await writeAuditSafely(deps, buildAuditRecord({
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
 * Append an audit record without ever letting the audit log decide the command's outcome: by the
 * time it is written the mutation has happened (or failed) in Coolify. A read-only checkout or a
 * full disk is reported loudly on stderr instead of turning a successful deploy into exit 1 —
 * which an agent would answer by deploying again.
 */
export async function writeAuditSafely(deps: Pick<CmdDeps, 'auditSink'>, record: AuditRecord): Promise<void> {
  try {
    await deps.auditSink(record);
  } catch (err) {
    warn(`WARNING: audit record for ${record.action} (${record.outcome}) could not be written: ${sanitizeErrorMessage(err)}`);
  }
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
  let result: T;
  try {
    result = await op();
  } catch (err) {
    await audit(deps, { ...record, outcome: 'failure', error: sanitizeErrorMessage(err) });
    throw err;
  }
  await audit(deps, record);
  return result;
}
