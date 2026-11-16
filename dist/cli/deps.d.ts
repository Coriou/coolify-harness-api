import type { ParsedArgs } from './args.js';
import type { CoolifyClient } from '../client/coolify.js';
import type { CoolifyInstanceClient } from '../client/instance.js';
import type { ResolvedTarget } from '../config/schema.js';
import { type AuditRecord } from '../client/safe-write.js';
export type TargetClient = Pick<CoolifyClient, 'listEnvs' | 'upsertEnvs' | 'deleteEnv' | 'deploy' | 'restart' | 'get' | 'getService' | 'getDatabase' | 'updateServiceCompose' | 'getRuntimeLogs' | 'listDeployments' | 'getDeployment' | 'getLatestDeployment' | 'getLatestBuildLogs' | 'waitForDeployment' | 'cancelDeployment'>;
export type InstanceClient = Pick<CoolifyInstanceClient, 'instanceUrl' | 'getVersion' | 'getHealth' | 'listRunningDeployments' | 'getDeployment' | 'cancelDeployment' | 'listServers' | 'getServer' | 'getServerResources' | 'getServerProxy' | 'saveServerProxyConfiguration' | 'restartServerProxy' | 'listDatabases' | 'getDatabase' | 'updateDatabase' | 'listDatabaseBackups' | 'runDatabaseBackup'>;
/** Everything a command needs from the outside world; injected so tests never touch the network. */
export interface CmdDeps {
    resolveTargetFor: (args: ParsedArgs) => ResolvedTarget;
    clientFactory: (target: ResolvedTarget) => TargetClient;
    /** Instance named by --instance, else the instance of --app's target. */
    instanceFor?: (args: ParsedArgs) => {
        name: string;
        client: InstanceClient;
    };
    actor: string;
    auditSink: (record: AuditRecord) => Promise<void>;
    now?: () => Date;
    readFile?: (path: string) => Promise<string>;
    /** Writes an unredacted document for --out (mode 0600). */
    writeFile?: (path: string, content: string) => Promise<void>;
}
/**
 * Write an unredacted document for `--out`, readable by the owner only. The content goes to a new
 * 0600 file beside the target, which then takes the target's place: an existing world-readable
 * file is never written into (a reader that already had it open keeps the OLD content), another
 * hard link to it is left alone, and a symbolic link is refused rather than followed.
 */
export declare const defaultWriteFile: (path: string, content: string) => Promise<void>;
export declare function requireInstance(args: ParsedArgs, deps: CmdDeps): {
    name: string;
    client: InstanceClient;
};
export declare const print: (line?: string) => void;
export declare const warn: (line: string) => void;
/**
 * Report a failure that is returned as an exit code rather than thrown, the way thrown errors are
 * reported: prose on stderr, or with `--json` the `{ "error": { code, message, exitCode, … } }`
 * document. Returns the exit code.
 */
export declare function emitError(args: Pick<ParsedArgs, 'json'>, code: string, message: string, exitCode: number, extra?: Record<string, unknown>): number;
/** A usage problem (exit 2). */
export declare function usageFail(args: Pick<ParsedArgs, 'json'>, message: string): number;
/**
 * JSON output for agents: always redacted, never prose. An audit record that could not be written
 * is reported here (`auditError`), since with `--json` stderr stays empty on success.
 */
export declare function printJson(value: unknown): void;
export declare function audit(deps: CmdDeps, record: {
    instanceUrl: string;
    kind: AuditRecord['resourceKind'];
    uuid: string;
    action: AuditRecord['action'];
    keysAffected?: string[];
    options?: Record<string, string | number | boolean>;
    outcome?: AuditRecord['outcome'];
    error?: string;
}): Promise<void>;
/**
 * Append an audit record without ever letting the audit log decide the command's outcome: by the
 * time it is written the mutation has happened (or failed) in Coolify. A read-only checkout or a
 * full disk is reported loudly on stderr instead of turning a successful deploy into exit 1 —
 * which an agent would answer by deploying again.
 */
export declare function writeAuditSafely(deps: Pick<CmdDeps, 'auditSink'>, record: AuditRecord): Promise<void>;
/**
 * Run a mutation and audit it whatever happens (keys/options only). A failed mutation is recorded
 * with outcome=failure and the error message, then rethrown.
 */
export declare function audited<T>(deps: CmdDeps, record: Omit<Parameters<typeof audit>[1], 'outcome' | 'error'>, op: () => Promise<T>): Promise<T>;
