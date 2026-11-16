import { CoolifyAuthError, CoolifyAuthScopeError } from '../errors/index.js';

/**
 * Wraps a Coolify API call with scope-error surfacing.
 * If `op` rejects with a CoolifyAuthError whose status is 403, this throws CoolifyAuthScopeError
 * naming the token abilities the command needs AND Coolify's own reason, which says exactly what
 * is missing (`Missing required permissions: delete`) or that the token is limited to some
 * projects. All other errors pass through unchanged.
 */
export async function withScope<T>(requiredScope: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof CoolifyAuthError && err.status === 403) {
      const reason = err.serverMessage ? ` Coolify says: ${err.serverMessage}` : '';
      throw new CoolifyAuthScopeError(
        `Coolify refused the request (403): this command needs a token with '${requiredScope}'.${reason}`,
        { requiredScope, ...(err.serverMessage !== undefined ? { serverMessage: err.serverMessage } : {}) },
      );
    }
    throw err;
  }
}
