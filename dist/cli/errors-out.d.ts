/**
 * The text of an error as it may be printed or audited: URL credentials and bearer tokens
 * stripped, length bounded. Harness errors are built from keys, paths and Coolify's own (already
 * sanitised) messages, never from env values — this is the last line of defence for errors raised
 * by the runtime (a failed `import()`, a filesystem error) that quote whatever they were given.
 */
export declare function sanitizeErrorMessage(err: unknown): string;
