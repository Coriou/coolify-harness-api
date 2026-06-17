import { z } from 'zod';
export interface CatalogEntry {
    key: string;
    services: string[];
    type: string;
    enumValues?: string[];
    required: boolean;
    default?: string;
    description?: string;
    coerced: boolean;
    transformed: boolean;
    multiline: boolean;
    conflict?: string;
}
export type CatalogModel = CatalogEntry[];
export declare function walkEnvSchema(schema: z.ZodTypeAny, opts: {
    service: string;
}): CatalogEntry[];
export declare function mergeCatalogs(perService: CatalogEntry[][]): CatalogModel;
