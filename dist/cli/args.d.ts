export interface ParsedArgs {
    command: 'catalog-gen' | 'catalog-check' | 'env-diff' | 'env-apply' | 'flag-set' | 'deploy' | 'config-doctor';
    config: string;
    app?: string;
    apply: boolean;
    yes: boolean;
    redeploy: boolean;
    restart: boolean;
    json: boolean;
    failOnDrift: boolean;
    set: Record<string, string>;
    fromFile?: string;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
