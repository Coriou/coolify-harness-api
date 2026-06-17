/**
 * Wraps a Coolify API call with scope-error surfacing.
 * If `op` rejects with a CoolifyAuthError whose status is 403, this throws
 * CoolifyAuthScopeError so the CLI can surface a clearer message and exit 5.
 * All other errors pass through unchanged.
 */
export declare function withScope<T>(requiredScope: string, op: () => Promise<T>): Promise<T>;
