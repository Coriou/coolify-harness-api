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
    constructor(message, opts) {
        super(message, 'COOLIFY_AUTH');
        if (opts?.status !== undefined) {
            this.status = opts.status;
        }
    }
}
export class CoolifyAuthScopeError extends CoolifyHarnessError {
    requiredScope;
    constructor(message, opts) {
        super(message, 'COOLIFY_AUTH_SCOPE');
        this.requiredScope = opts.requiredScope;
    }
}
export class CoolifyNotFoundError extends CoolifyHarnessError {
    constructor(message) { super(message, 'COOLIFY_NOT_FOUND'); }
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
