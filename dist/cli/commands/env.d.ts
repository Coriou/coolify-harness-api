import type { ParsedArgs } from '../args.js';
import type { CoolifyClient } from '../../client/coolify.js';
import type { ResolvedTarget } from '../../config/schema.js';
import type { AuditRecord } from '../../client/safe-write.js';
export interface EnvCmdDeps {
    resolveTargetFor: (args: ParsedArgs) => ResolvedTarget;
    clientFactory: (target: ResolvedTarget) => Pick<CoolifyClient, 'listEnvs' | 'upsertEnvs' | 'deploy' | 'restart'>;
    actor: string;
    auditSink: (record: AuditRecord) => Promise<void>;
    now?: () => Date;
    readFile?: (path: string) => Promise<string>;
}
/** Parse dotenv-style KEY=VALUE text into a record. Ignores blank lines and comments (#). */
export declare function parseDotenv(text: string): Record<string, string>;
export declare function envDiff(args: ParsedArgs, deps: EnvCmdDeps): Promise<number>;
export declare function envApply(args: ParsedArgs, deps: EnvCmdDeps): Promise<number>;
