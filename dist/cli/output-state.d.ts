/** Called by `main` at the start of each run. */
export declare function beginRun(json: boolean): void;
/** True when the run prints JSON: then stderr carries nothing but the error document. */
export declare const isJsonRun: () => boolean;
/** An audit record that could not be written. With `--json` it is reported inside the document. */
export declare function noteAuditFailure(message: string): void;
/** The audit failures noted so far, handed over once (the document that reports them). */
export declare function takeAuditFailures(): string[];
