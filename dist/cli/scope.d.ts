/**
 * Wraps a Coolify API call with scope-error surfacing.
 * If `op` rejects with a CoolifyAuthError whose status is 403, this throws CoolifyAuthScopeError
 * naming the token abilities the command needs AND Coolify's own reason, which says exactly what
 * is missing (`Missing required permissions: delete`) or that the token is limited to some
 * projects. All other errors pass through unchanged.
 */
export declare function withScope<T>(requiredScope: string, op: () => Promise<T>): Promise<T>;
