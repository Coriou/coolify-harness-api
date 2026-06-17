import { CoolifyAuthError, CoolifyAuthScopeError } from '../errors/index.js';
/**
 * Wraps a Coolify API call with scope-error surfacing.
 * If `op` rejects with a CoolifyAuthError whose status is 403, this throws
 * CoolifyAuthScopeError so the CLI can surface a clearer message and exit 5.
 * All other errors pass through unchanged.
 */
export async function withScope(requiredScope, op) {
    try {
        return await op();
    }
    catch (err) {
        if (err instanceof CoolifyAuthError && err.status === 403) {
            throw new CoolifyAuthScopeError(`Coolify token lacks '${requiredScope}' scope (403)`, { requiredScope });
        }
        throw err;
    }
}
