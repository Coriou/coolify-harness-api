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
/**
 * Any Zod schema object, from whichever zod the CONSUMER uses: zod 3 (`_def.typeName`), zod 4 and
 * zod mini (`_zod.def.type`). The walker reads the schema's own structure and never calls into a
 * zod library, so the consumer's zod version does not have to match the harness's.
 */
export type AnyZodSchema = {
    readonly _def: unknown;
} | {
    readonly _zod: unknown;
};
export declare function walkEnvSchema(schema: AnyZodSchema, opts: {
    service: string;
}): CatalogEntry[];
export declare function mergeCatalogs(perService: CatalogEntry[][]): CatalogModel;
