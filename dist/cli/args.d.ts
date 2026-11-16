declare const COMMANDS: {
    readonly 'catalog gen': "catalog-gen";
    readonly 'catalog check': "catalog-check";
    readonly 'env diff': "env-diff";
    readonly 'env apply': "env-apply";
    readonly 'env list': "env-list";
    readonly 'env delete': "env-delete";
    readonly 'flag set': "flag-set";
    readonly deploy: "deploy";
    readonly 'config doctor': "config-doctor";
    readonly status: "status";
    readonly logs: "logs";
    readonly deployments: "deployments";
    readonly deployment: "deployment";
    readonly 'deployment cancel': "deployment-cancel";
    readonly 'compose get': "compose-get";
    readonly 'compose set': "compose-set";
    readonly 'instance info': "instance-info";
    readonly version: "instance-info";
    readonly 'instance upgrade': "instance-upgrade";
    readonly servers: "servers";
    readonly 'server get': "server-get";
    readonly 'server patch': "server-patch";
    readonly 'server reboot': "server-reboot";
    readonly 'proxy get': "proxy-get";
    readonly 'proxy set': "proxy-set";
    readonly 'proxy restart': "proxy-restart";
    readonly databases: "databases";
    readonly 'database get': "database-get";
    readonly 'database set': "database-set";
    readonly 'database backups': "database-backups";
    readonly 'database backup': "database-backup";
    readonly help: "help";
};
/** Every command as typed on the command line (`env diff`, `deploy`, …). */
export declare const COMMAND_NAMES: readonly string[];
export type Command = (typeof COMMANDS)[keyof typeof COMMANDS];
export interface ParsedArgs {
    command: Command;
    config: string;
    /** True when `--config` was passed (otherwise the default config names are looked up). */
    configExplicit?: boolean;
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
    instance?: string;
    server?: string;
    database?: string;
    backup?: string;
    force: boolean;
    latest: boolean;
    timeout?: number;
    keys: string[];
    preview: boolean;
    out?: string;
    images: string[];
    service?: string;
    timestamps: boolean;
    public?: boolean;
    publicPort?: number;
    running: boolean;
    /** `--version` / `-v`: print the harness version and the tested Coolify range. */
    version?: boolean;
    /** `--dry-run`: never mutate, even for `deploy` (which otherwise acts immediately). */
    dryRun?: boolean;
    /** `--fail-on-changes`: `env diff` exits 4 when the plan has creates or updates. */
    failOnChanges?: boolean;
    /** `--no-logs`: leave build logs out of deployment JSON (they are hundreds of kB each). */
    noLogs?: boolean;
    /** `--offline`: `config doctor` checks the config and tokens only, without calling Coolify. */
    offline?: boolean;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export {};
