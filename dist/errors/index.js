export class CoolifyHarnessError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = new.target.name;
        this.code = code;
    }
}
export class CoolifyAuthError extends CoolifyHarnessError {
    status;
    /** Coolify's own explanation, e.g. `Missing required permissions: delete` (never a secret). */
    serverMessage;
    constructor(message, opts) {
        super(message, 'COOLIFY_AUTH');
        if (opts?.status !== undefined) {
            this.status = opts.status;
        }
        if (opts?.serverMessage !== undefined) {
            this.serverMessage = opts.serverMessage;
        }
    }
}
export class CoolifyAuthScopeError extends CoolifyHarnessError {
    requiredScope;
    /** Coolify's own explanation of the 403, when it sent one. */
    serverMessage;
    constructor(message, opts) {
        super(message, 'COOLIFY_AUTH_SCOPE');
        this.requiredScope = opts.requiredScope;
        if (opts.serverMessage !== undefined) {
            this.serverMessage = opts.serverMessage;
        }
    }
}
/**
 * Coolify could not be reached: DNS / connection / TLS failure, a request that timed out, or the
 * circuit breaker refusing after repeated failures. Distinct from an HTTP error answer.
 */
export class CoolifyNetworkError extends CoolifyHarnessError {
    /** `timeout`, `circuit-open`, or the underlying system code (`ENOTFOUND`, `ECONNREFUSED`, ...). */
    reason;
    /**
     * True when a WRITE failed after it may have been sent (a timeout, a connection reset): Coolify
     * may have carried it out. Absent for reads and for failures before anything left.
     */
    outcomeUnknown;
    constructor(message, opts) {
        super(message, 'COOLIFY_NETWORK');
        this.reason = opts.reason;
        if (opts.outcomeUnknown)
            this.outcomeUnknown = true;
    }
}
/** Bad command line: unknown command/flag, missing or malformed value. CLI exit 2. */
export class UsageError extends CoolifyHarnessError {
    constructor(message) { super(message, 'USAGE'); }
}
/**
 * A value handed to the library is not something the Coolify API accepts (an empty env key, a
 * field the endpoint does not take, ...). Raised before any request is sent. CLI exit 2.
 */
export class InvalidInputError extends CoolifyHarnessError {
    /** `path: problem` per rejected field. Never contains the rejected values. */
    issues;
    constructor(message, opts) {
        super(message, 'INVALID_INPUT');
        this.issues = opts.issues;
    }
}
export class CoolifyNotFoundError extends CoolifyHarnessError {
    constructor(message) { super(message, 'COOLIFY_NOT_FOUND'); }
}
/**
 * Coolify acknowledged a deploy or restart with a deployment uuid, but created no such deployment:
 * the server's deployment queue was full (`POST /applications/{uuid}/start` and `/restart` answer
 * "queued" all the same). Nothing was queued. CLI exit 1.
 */
export class CoolifyDeployNotQueuedError extends CoolifyHarnessError {
    constructor(message) { super(message, 'DEPLOY_NOT_QUEUED'); }
}
export class CoolifyContractError extends CoolifyHarnessError {
    zodIssues;
    constructor(message, opts) {
        super(message, 'COOLIFY_CONTRACT');
        this.zodIssues = opts.zodIssues;
    }
}
export class CoolifyBulkUnmarshalError extends CoolifyHarnessError {
    constructor(message) { super(message, 'COOLIFY_BULK_UNMARSHAL'); }
}
export class LockedVarError extends CoolifyHarnessError {
    key;
    constructor(message, opts) {
        super(message, 'LOCKED_VAR');
        this.key = opts.key;
    }
}
export class DuplicateKeyDriftError extends CoolifyHarnessError {
    keys;
    constructor(message, opts) {
        super(message, 'DUPLICATE_KEY_DRIFT');
        this.keys = opts.keys;
    }
}
export class ConfigError extends CoolifyHarnessError {
    constructor(message) { super(message, 'CONFIG'); }
}
export class MissingTokenError extends CoolifyHarnessError {
    tokenEnv;
    constructor(message, opts) {
        super(message, 'MISSING_TOKEN');
        this.tokenEnv = opts.tokenEnv;
    }
}
export class CatalogStaleError extends CoolifyHarnessError {
    staleFiles;
    constructor(message, opts) {
        super(message, 'CATALOG_STALE');
        this.staleFiles = opts.staleFiles;
    }
}
export class CoolifyFeatureNotSupportedError extends CoolifyHarnessError {
    constructor(message) {
        super(message, 'COOLIFY_FEATURE_NOT_SUPPORTED');
    }
}
export class CoolifyWaitTimeoutError extends CoolifyHarnessError {
    deploymentUuid;
    timeoutMs;
    lastStatus;
    constructor(deploymentUuid, timeoutMs, lastStatus) {
        const last = lastStatus ?? 'unknown';
        super(`waitForDeployment(${deploymentUuid}) timed out after ${timeoutMs}ms; last status was ${last}`, 'COOLIFY_WAIT_TIMEOUT');
        this.deploymentUuid = deploymentUuid;
        this.timeoutMs = timeoutMs;
        this.lastStatus = lastStatus;
    }
}
/**
 * A non-auth, non-404 HTTP error from Coolify (400 / 409 / 422 / 5xx after retries). Carries the
 * server's own `message` and, for 422, the names of the rejected fields (never their values).
 */
export class CoolifyRequestError extends CoolifyHarnessError {
    status;
    fields;
    constructor(message, opts) {
        super(message, 'COOLIFY_REQUEST');
        this.status = opts.status;
        this.fields = opts.fields ?? [];
    }
}
/** `env diff --fail-on-changes`: the live env differs from the desired values. CLI exit 4. */
export class EnvChangesPendingError extends CoolifyHarnessError {
    keys;
    constructor(message, opts) {
        super(message, 'ENV_CHANGES_PENDING');
        this.keys = opts.keys;
    }
}
