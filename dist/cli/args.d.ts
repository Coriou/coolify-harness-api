export interface ParsedArgs {
    command: 'catalog-gen' | 'catalog-check' | 'env-diff' | 'env-apply' | 'flag-set' | 'deploy' | 'config-doctor' | 'status' | 'logs' | 'deployments' | 'deployment';
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
    lines?: number;
    build: boolean;
    runtime: boolean;
    deployment?: string;
    wait: boolean;
    take?: number;
    skip?: number;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
