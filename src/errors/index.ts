export class CoolifyHarnessError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class CoolifyAuthError extends CoolifyHarnessError {
  readonly status?: number;
  constructor(message: string, opts?: { status?: number }) {
    super(message, 'COOLIFY_AUTH');
    if (opts?.status !== undefined) {
      this.status = opts.status;
    }
  }
}

export class CoolifyAuthScopeError extends CoolifyHarnessError {
  readonly requiredScope: string;
  constructor(message: string, opts: { requiredScope: string }) {
    super(message, 'COOLIFY_AUTH_SCOPE');
    this.requiredScope = opts.requiredScope;
  }
}

export class CoolifyNotFoundError extends CoolifyHarnessError {
  constructor(message: string) { super(message, 'COOLIFY_NOT_FOUND'); }
}

export class CoolifyContractError extends CoolifyHarnessError {
  readonly zodIssues: string;
  constructor(message: string, opts: { zodIssues: string }) {
    super(message, 'COOLIFY_CONTRACT');
    this.zodIssues = opts.zodIssues;
  }
}

export class CoolifyBulkUnmarshalError extends CoolifyHarnessError {
  constructor(message: string) { super(message, 'COOLIFY_BULK_UNMARSHAL'); }
}

export class LockedVarError extends CoolifyHarnessError {
  readonly key: string;
  constructor(message: string, opts: { key: string }) {
    super(message, 'LOCKED_VAR');
    this.key = opts.key;
  }
}

export class DuplicateKeyDriftError extends CoolifyHarnessError {
  readonly keys: string[];
  constructor(message: string, opts: { keys: string[] }) {
    super(message, 'DUPLICATE_KEY_DRIFT');
    this.keys = opts.keys;
  }
}

export class ConfigError extends CoolifyHarnessError {
  constructor(message: string) { super(message, 'CONFIG'); }
}

export class MissingTokenError extends CoolifyHarnessError {
  readonly tokenEnv: string;
  constructor(message: string, opts: { tokenEnv: string }) {
    super(message, 'MISSING_TOKEN');
    this.tokenEnv = opts.tokenEnv;
  }
}

export class CatalogStaleError extends CoolifyHarnessError {
  readonly staleFiles: string[];
  constructor(message: string, opts: { staleFiles: string[] }) {
    super(message, 'CATALOG_STALE');
    this.staleFiles = opts.staleFiles;
  }
}

export class CoolifyFeatureNotSupportedError extends CoolifyHarnessError {
  constructor(message: string) {
    super(message, 'COOLIFY_FEATURE_NOT_SUPPORTED');
  }
}

export class CoolifyWaitTimeoutError extends CoolifyHarnessError {
  readonly deploymentUuid: string;
  readonly timeoutMs: number;
  readonly lastStatus: string | undefined;
  constructor(deploymentUuid: string, timeoutMs: number, lastStatus?: string) {
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
  readonly status: number;
  readonly fields: string[];
  constructor(message: string, opts: { status: number; fields?: string[] }) {
    super(message, 'COOLIFY_REQUEST');
    this.status = opts.status;
    this.fields = opts.fields ?? [];
  }
}
