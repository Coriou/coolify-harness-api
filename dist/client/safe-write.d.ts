import type { EnvVar, EnvWriteItem } from './schemas.js';
import type { Logger } from '../logging/index.js';
import type { CoolifyClient } from './coolify.js';
export interface EnvFlags {
    is_preview: boolean;
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
export type AuditResourceKind = 'application' | 'service' | 'database' | 'server' | 'deployment';
export type AuditAction = 'env.apply' | 'env.delete' | 'deploy' | 'restart' | 'compose.update' | 'proxy.configuration' | 'proxy.restart' | 'database.update' | 'database.backup' | 'deployment.cancel';
export interface AuditRecord {
    ts: string;
    actor: string;
    instanceUrl: string;
    resourceKind: AuditResourceKind;
    resourceUuid: string;
    action: AuditAction;
    planSummary: {
        creates: number;
        updates: number;
        unchanged: number;
        duplicateKeyDrift: number;
    };
    /** Env keys or field names touched — never their values. */
    keysAffected: string[];
    /** Non-secret switches of the call (e.g. force, latest, an image reference). Never env/compose values. */
    options?: Record<string, string | number | boolean>;
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
        kind: AuditResourceKind;
        uuid: string;
    };
    actor: string;
    writeAudit: (record: AuditRecord) => Promise<void>;
    now?: () => Date;
}
export declare const EMPTY_PLAN: EnvWritePlan;
export declare function buildAuditRecord(args: {
    now: Date;
    actor: string;
    target: ApplyDeps['target'];
    action: AuditRecord['action'];
    plan?: EnvWritePlan;
    keysAffected: string[];
    options?: Record<string, string | number | boolean>;
    outcome: AuditRecord['outcome'];
    error?: string;
}): AuditRecord;
export declare function applyEnvWrite(plan: EnvWritePlan, deps: ApplyDeps): Promise<EnvWriteResult>;
