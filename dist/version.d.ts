/** Version of this package. Kept in sync with package.json by test/version.test.ts. */
export declare const HARNESS_VERSION = "0.5.0";
/**
 * Coolify versions this release's API contract is verified against: recorded fixtures for both
 * ends (`test/fixtures/coolify/v4.5`, `v4.7`) and a live read-only check on `max`. A live instance
 * outside the range still works as long as Coolify kept the contract; `instance info` and
 * `config doctor` warn so an agent knows contract drift is possible.
 */
export declare const TESTED_COOLIFY: {
    readonly min: "4.5.0";
    readonly max: "4.7.5";
};
export type CoolifyCompatibility = 'tested' | 'older' | 'newer' | 'unknown';
/** -1 / 0 / 1 on the numeric `major.minor.patch` prefix; undefined when either is not a version. */
export declare function compareVersions(a: string, b: string): -1 | 0 | 1 | undefined;
/** Where a live Coolify version sits relative to TESTED_COOLIFY. Pre-releases count as their base version. */
export declare function coolifyCompatibility(version: string): CoolifyCompatibility;
/** One-line warning for a version outside the tested range; undefined when it is inside. */
export declare function compatibilityWarning(version: string): string | undefined;
