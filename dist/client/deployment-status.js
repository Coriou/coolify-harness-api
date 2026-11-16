/** Every status Coolify's ApplicationDeploymentStatus enum defines (unchanged from 4.5.0 to 4.7.5). */
export const DEPLOYMENT_STATUSES = ['queued', 'in_progress', 'finished', 'failed', 'cancelled-by-user'];
/** Statuses after which a deployment never changes again. */
export const TERMINAL_DEPLOYMENT_STATUSES = ['finished', 'failed', 'cancelled-by-user'];
export function isTerminalDeploymentStatus(status) {
    return TERMINAL_DEPLOYMENT_STATUSES.includes(status);
}
