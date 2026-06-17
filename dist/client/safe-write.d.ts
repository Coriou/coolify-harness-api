import type { EnvVar, EnvWriteItem } from './schemas.js';
import type { Logger } from '../logging/index.js';
import type { CoolifyClient } from './coolify.js';
export interface EnvFlags {
    is_preview: boolean;
    is_build_time: boolean;
    is_literal: boolean;
    is_multiline: boolean;
    is_shown_once: boolean;
}
export interface DesiredEnv {
    values: Record<string, string>;
    flags?: Record<string, Partial<EnvFlags>>;
}
export interface DuplicateKeyDrift {
    key: string;
    values: string[];
}
export interface LockedVarSkip {
    key: string;
    reason: string;
}
export interface PlanWarning {
    kind: string;
    message: string;
}
export interface EnvWritePlan {
    readonly creates: EnvWriteItem[];
    readonly updates: EnvWriteItem[];
    readonly unchanged: string[];
    readonly duplicateKeyDrift: DuplicateKeyDrift[];
    readonly lockedSkips: LockedVarSkip[];
    readonly warnings: PlanWarning[];
}
export declare function planEnvWrite(current: EnvVar[], desired: DesiredEnv): EnvWritePlan;
export interface AuditRecord {
    ts: string;
    actor: string;
    instanceUrl: string;
    resourceKind: 'application' | 'service';
    resourceUuid: string;
    action: 'env.apply' | 'deploy' | 'restart';
    planSummary: {
        creates: number;
        updates: number;
        unchanged: number;
        duplicateKeyDrift: number;
    };
    keysAffected: string[];
    outcome: 'success' | 'failure';
    error?: string;
}
export interface EnvWriteResult {
    applied: EnvWriteItem[];
    confirmed: boolean;
    audit: AuditRecord;
}
export interface ApplyDeps {
    client: Pick<CoolifyClient, 'upsertEnvs' | 'listEnvs'>;
    logger: Logger;
    target: {
        instanceUrl: string;
        kind: 'application' | 'service';
        uuid: string;
    };
    actor: string;
    writeAudit: (record: AuditRecord) => Promise<void>;
    now?: () => Date;
}
export declare function buildAuditRecord(args: {
    now: Date;
    actor: string;
    target: ApplyDeps['target'];
    action: AuditRecord['action'];
    plan: EnvWritePlan;
    keysAffected: string[];
    outcome: AuditRecord['outcome'];
    error?: string;
}): AuditRecord;
export declare function applyEnvWrite(plan: EnvWritePlan, deps: ApplyDeps): Promise<EnvWriteResult>;
