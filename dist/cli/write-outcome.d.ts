export type StoredState = 'new' | 'old' | 'changed' | 'unknown';
/**
 * A document write (service compose, proxy configuration) that failed WITHOUT a definite "no" — a
 * 5xx or a lost connection — says nothing about what Coolify holds now: it saves the document
 * first and re-parses it afterwards, so a failure in that second step answers 500 with the new
 * document already stored. Re-read once and put the answer on the error (`stored`, and a sentence
 * in the message), so nobody re-sends or rolls back blindly. A 4xx is a refusal: nothing to check.
 */
export declare function noteStoredState(err: unknown, read: () => Promise<string | null | undefined>, before: string, after: string, review: string, 
/** What "stored: new" means for this document (Coolify does different things after recording it). */
whenNew?: string): Promise<void>;
