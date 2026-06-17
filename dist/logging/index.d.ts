export interface Logger {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
}
type Level = 'debug' | 'info' | 'warn' | 'error';
export declare function redactSecrets(fields: Record<string, unknown>): Record<string, unknown>;
export declare function createLogger(opts?: {
    level?: Level;
    sink?: (line: string) => void;
}): Logger;
export declare function noopLogger(): Logger;
export {};
