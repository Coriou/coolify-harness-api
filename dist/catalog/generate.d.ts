import { type AnyZodSchema, type CatalogModel } from './walk.js';
export interface SchemaInput {
    service: string;
    /** A zod 3, zod 4 or zod mini object schema (possibly refined, intersected or wrapped). */
    schema: AnyZodSchema;
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
