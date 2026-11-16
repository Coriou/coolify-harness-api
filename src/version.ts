/** Version of this package. Kept in sync with package.json by test/version.test.ts. */
export const HARNESS_VERSION = '0.5.0';

/**
 * Coolify versions this release's API contract is verified against: recorded fixtures for both
 * ends (`test/fixtures/coolify/v4.5`, `v4.7`) and a live read-only check on `max`. A live instance
 * outside the range still works as long as Coolify kept the contract; `instance info` and
 * `config doctor` warn so an agent knows contract drift is possible.
 */
export const TESTED_COOLIFY = { min: '4.5.0', max: '4.7.5' } as const;

export type CoolifyCompatibility = 'tested' | 'older' | 'newer' | 'unknown';

function parseVersion(version: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** -1 / 0 / 1 on the numeric `major.minor.patch` prefix; undefined when either is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | undefined {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return undefined;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return 0;
}

/** Where a live Coolify version sits relative to TESTED_COOLIFY. Pre-releases count as their base version. */
export function coolifyCompatibility(version: string): CoolifyCompatibility {
  const lo = compareVersions(version, TESTED_COOLIFY.min);
  const hi = compareVersions(version, TESTED_COOLIFY.max);
  if (lo === undefined || hi === undefined) return 'unknown';
  if (lo < 0) return 'older';
  if (hi > 0) return 'newer';
  return 'tested';
}

/** One-line warning for a version outside the tested range; undefined when it is inside. */
export function compatibilityWarning(version: string): string | undefined {
  const range = `${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max}`;
  switch (coolifyCompatibility(version)) {
    case 'tested': return undefined;
    case 'newer':
      return `Coolify ${version} is newer than the range coolify-harness ${HARNESS_VERSION} is tested against (${range}). Commands may fail with a contract error if the API changed; check for a newer coolify-harness release.`;
    case 'older':
      return `Coolify ${version} is older than the range coolify-harness ${HARNESS_VERSION} is tested against (${range}). Some commands may fail or behave differently; upgrade Coolify or pin an older coolify-harness.`;
    default:
      return `Could not read a Coolify version from '${version.slice(0, 40)}'; coolify-harness ${HARNESS_VERSION} is tested against ${range}.`;
  }
}
