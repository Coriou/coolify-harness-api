/** Every status Coolify's ApplicationDeploymentStatus enum defines (unchanged from 4.5.0 to 4.7.5). */
export const DEPLOYMENT_STATUSES = ['queued', 'in_progress', 'finished', 'failed', 'cancelled-by-user'] as const;
export type KnownDeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
/** Statuses after which a deployment never changes again. */
export const TERMINAL_DEPLOYMENT_STATUSES: readonly string[] = ['finished', 'failed', 'cancelled-by-user'];
export function isTerminalDeploymentStatus(status: string): boolean {
  return TERMINAL_DEPLOYMENT_STATUSES.includes(status);
}
