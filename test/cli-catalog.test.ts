import { describe, it, expect, vi } from 'vitest';
import { dispatch } from '../src/cli/dispatch.js';
import type { ParsedArgs } from '../src/cli/args.js';
import { errorToExitCode } from '../src/cli/main.js';
import { CatalogStaleError } from '../src/errors/index.js';

const baseArgs = (over: Partial<ParsedArgs>): ParsedArgs => ({
  command: 'catalog-gen', config: 'cfg.ts', apply: false, yes: false, redeploy: false,
  restart: false, json: false, failOnDrift: false, set: {}, ...over,
});

vi.mock('../src/config/load.js', async (orig) => {
  const actual = await orig<typeof import('../src/config/load.js')>();
  const { RepresentativeSchema } = await import('./fixtures/schemas/representative.js');
  return {
    ...actual,
    loadConfigModule: vi.fn().mockResolvedValue({
      registry: { instances: {}, targets: {} },
      catalog: {
        schemas: [{ service: 'api', schema: RepresentativeSchema }],
        out: { markdown: 'docs/cat.md' },
      },
    }),
  };
});

describe('catalog CLI', () => {
  it('catalog check fails with exit 3 (CatalogStaleError) when stale', async () => {
    // committed docs/cat.md does not exist → stale
    const err = await dispatch(baseArgs({ command: 'catalog-check' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogStaleError);
    expect(errorToExitCode(err)).toBe(3);
    expect((err as CatalogStaleError).staleFiles).toEqual(['docs/cat.md']);
    expect((err as Error).message).toContain("Run 'coolify-harness catalog gen'");
  });
});
