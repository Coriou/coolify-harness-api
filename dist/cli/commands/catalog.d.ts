import type { ParsedArgs } from '../args.js';
export declare function catalogGen(args: ParsedArgs): Promise<number>;
/** Exit 3 (CatalogStaleError) when a committed artifact differs from what the schemas generate. */
export declare function catalogCheck(args: ParsedArgs): Promise<number>;
