export declare class CoolifyHarnessError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare class CoolifyAuthError extends CoolifyHarnessError {
    readonly status?: number;
    /** Coolify's own explanation, e.g. `Missing required permissions: delete` (never a secret). */
    readonly serverMessage?: string;
    constructor(message: string, opts?: {
        status?: number;
        serverMessage?: string;
    });
}
export declare class CoolifyAuthScopeError extends CoolifyHarnessError {
    readonly requiredScope: string;
    /** Coolify's own explanation of the 403, when it sent one. */
    readonly serverMessage?: string;
    constructor(message: string, opts: {
        requiredScope: string;
        serverMessage?: string;
    });
}
/**
 * Coolify could not be reached: DNS / connection / TLS failure, a request that timed out, or the
 * circuit breaker refusing after repeated failures. Distinct from an HTTP error answer.
 */
export declare class CoolifyNetworkError extends CoolifyHarnessError {
    /** `timeout`, `circuit-open`, or the underlying system code (`ENOTFOUND`, `ECONNREFUSED`, ...). */
    readonly reason: string;
    constructor(message: string, opts: {
        reason: string;
    });
}
/** Bad command line: unknown command/flag, missing or malformed value. CLI exit 2. */
export declare class UsageError extends CoolifyHarnessError {
    constructor(message: string);
}
/**
 * A value handed to the library is not something the Coolify API accepts (an empty env key, a
 * field the endpoint does not take, ...). Raised before any request is sent. CLI exit 2.
 */
export declare class InvalidInputError extends CoolifyHarnessError {
    /** `path: problem` per rejected field. Never contains the rejected values. */
    readonly issues: string[];
    constructor(message: string, opts: {
        issues: string[];
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
/**
 * A non-auth, non-404 HTTP error from Coolify (400 / 409 / 422 / 5xx after retries). Carries the
 * server's own `message` and, for 422, the names of the rejected fields (never their values).
 */
export declare class CoolifyRequestError extends CoolifyHarnessError {
    readonly status: number;
    readonly fields: string[];
    constructor(message: string, opts: {
        status: number;
        fields?: string[];
    });
}
/** `env diff --fail-on-changes`: the live env differs from the desired values. CLI exit 4. */
export declare class EnvChangesPendingError extends CoolifyHarnessError {
    readonly keys: string[];
    constructor(message: string, opts: {
        keys: string[];
    });
}
