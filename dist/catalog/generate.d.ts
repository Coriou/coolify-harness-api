import { z } from 'zod';
import { type CatalogModel } from './walk.js';
export interface SchemaInput {
    service: string;
    schema: z.ZodTypeAny;
}
export interface CatalogArtifacts {
    markdown: string;
    json: string;
    dotenv: string;
    model: CatalogModel;
}
export interface GenerateOptions {
    schemas: SchemaInput[];
    out?: {
        markdown?: string;
        json?: string;
        dotenvExample?: string;
    };
    writeFile?: (path: string, content: string) => Promise<void>;
}
export declare function buildArtifacts(schemas: SchemaInput[]): CatalogArtifacts;
export declare function generateCatalog(opts: GenerateOptions): Promise<CatalogArtifacts>;
