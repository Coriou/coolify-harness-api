import { CoolifyNetworkError, CoolifyRequestError } from '../errors/index.js';

export type StoredState = 'new' | 'old' | 'changed' | 'unknown';

/**
 * A document write (service compose, proxy configuration) that failed WITHOUT a definite "no" — a
 * 5xx or a lost connection — says nothing about what Coolify holds now: it saves the document
 * first and re-parses it afterwards, so a failure in that second step answers 500 with the new
 * document already stored. Re-read once and put the answer on the error (`stored`, and a sentence
 * in the message), so nobody re-sends or rolls back blindly. A 4xx is a refusal: nothing to check.
 */
export async function noteStoredState(
  err: unknown, read: () => Promise<string | null | undefined>, before: string, after: string, review: string,
): Promise<void> {
  if (!(err instanceof CoolifyNetworkError) && !(err instanceof CoolifyRequestError && err.status >= 500)) return;
  let stored: StoredState = 'unknown';
  try {
    const now = await read();
    if (now != null) stored = now === after ? 'new' : now === before ? 'old' : 'changed';
  } catch {
    // still unknown
  }
  const note = {
    new: 'Coolify DID store the new document all the same (it saves before it re-parses): do not send it again.',
    changed: 'The stored document is no longer the previous one: the write landed at least in part.',
    old: 'The stored document is unchanged: nothing was saved.',
    unknown: 'Whether the document was stored could not be checked.',
  }[stored];
  err.message = `${err.message} — ${note} Review with \`${review}\`.`;
  Object.assign(err, { stored });
}
