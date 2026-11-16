/**
 * What the current CLI run knows about its own output. A tiny module on purpose: `main` reads it
 * on every start, including the `help` fast path.
 */
let jsonMode = false;
let auditFailures: string[] = [];

/** Called by `main` at the start of each run. */
export function beginRun(json: boolean): void {
  jsonMode = json;
  auditFailures = [];
}

/** True when the run prints JSON: then stderr carries nothing but the error document. */
export const isJsonRun = (): boolean => jsonMode;

/** An audit record that could not be written. With `--json` it is reported inside the document. */
export function noteAuditFailure(message: string): void {
  auditFailures.push(message);
}

/** The audit failures noted so far, handed over once (the document that reports them). */
export function takeAuditFailures(): string[] {
  const taken = auditFailures;
  auditFailures = [];
  return taken;
}
