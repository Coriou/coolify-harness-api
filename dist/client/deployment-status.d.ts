/** Every status Coolify's ApplicationDeploymentStatus enum defines (unchanged from 4.5.0 to 4.7.5). */
export declare const DEPLOYMENT_STATUSES: readonly ["queued", "in_progress", "finished", "failed", "cancelled-by-user"];
export type KnownDeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
/** Statuses after which a deployment never changes again. */
export declare const TERMINAL_DEPLOYMENT_STATUSES: readonly string[];
export declare function isTerminalDeploymentStatus(status: string): boolean;
