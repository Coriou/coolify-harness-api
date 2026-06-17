import { describe, it, expect, vi } from 'vitest';
import { dispatch } from '../src/cli/dispatch.js';
import type { ParsedArgs } from '../src/cli/args.js';

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
  it('catalog check returns exit 3 when stale', async () => {
    const code = await dispatch(baseArgs({ command: 'catalog-check' }));
    expect(code).toBe(3); // committed docs/cat.md does not exist → stale
  });
});
