export declare class CoolifyHarnessError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare class CoolifyAuthError extends CoolifyHarnessError {
    readonly status?: number;
    constructor(message: string, opts?: {
        status?: number;
    });
}
export declare class CoolifyAuthScopeError extends CoolifyHarnessError {
    readonly requiredScope: string;
    constructor(message: string, opts: {
        requiredScope: string;
    });
}
export declare class CoolifyNotFoundError extends CoolifyHarnessError {
    constructor(message: string);
}
export declare class CoolifyContractError extends CoolifyHarnessError {
    readonly zodIssues: string;
    constructor(message: string, opts: {
        zodIssues: string;
    });
}
export declare class CoolifyBulkUnmarshalError extends CoolifyHarnessError {
    constructor(message: string);
}
export declare class LockedVarError extends CoolifyHarnessError {
    readonly key: string;
    constructor(message: string, opts: {
        key: string;
    });
}
export declare class DuplicateKeyDriftError extends CoolifyHarnessError {
    readonly keys: string[];
    constructor(message: string, opts: {
        keys: string[];
    });
}
export declare class ConfigError extends CoolifyHarnessError {
    constructor(message: string);
}
export declare class MissingTokenError extends CoolifyHarnessError {
    readonly tokenEnv: string;
    constructor(message: string, opts: {
        tokenEnv: string;
    });
}
export declare class CatalogStaleError extends CoolifyHarnessError {
    readonly staleFiles: string[];
    constructor(message: string, opts: {
        staleFiles: string[];
    });
}
export declare class CoolifyFeatureNotSupportedError extends CoolifyHarnessError {
    constructor(message: string);
}
export declare class CoolifyWaitTimeoutError extends CoolifyHarnessError {
    readonly deploymentUuid: string;
    readonly timeoutMs: number;
    readonly lastStatus: string | undefined;
    constructor(deploymentUuid: string, timeoutMs: number, lastStatus?: string);
}
