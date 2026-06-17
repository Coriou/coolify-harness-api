import { type SchemaInput } from './generate.js';
export interface StaleCheckResult {
    fresh: boolean;
    staleFiles: string[];
    diff: string;
}
export interface StaleCheckOptions {
    schemas: SchemaInput[];
    files: {
        markdown?: string;
        json?: string;
        dotenvExample?: string;
    };
    readFile?: (path: string) => Promise<string>;
}
export declare function checkCatalogFresh(opts: StaleCheckOptions): Promise<StaleCheckResult>;
