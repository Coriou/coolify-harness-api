import { describe, it, expect } from 'vitest';
import { checkCatalogFresh } from '../src/catalog/stale-check.js';
import { buildArtifacts } from '../src/catalog/generate.js';
import { RepresentativeSchema } from './fixtures/schemas/representative.js';

const schemas = [{ service: 'api', schema: RepresentativeSchema }];

describe('checkCatalogFresh', () => {
  it('reports fresh when committed files match generated output', async () => {
    const a = buildArtifacts(schemas);
    const res = await checkCatalogFresh({
      schemas,
      files: { markdown: 'cat.md', json: 'cat.json' },
      readFile: async (p) => (p === 'cat.md' ? a.markdown : a.json),
    });
    expect(res.fresh).toBe(true);
    expect(res.staleFiles).toEqual([]);
  });

  it('reports stale and names the drifted file', async () => {
    const a = buildArtifacts(schemas);
    const res = await checkCatalogFresh({
      schemas,
      files: { markdown: 'cat.md', json: 'cat.json' },
      readFile: async (p) => (p === 'cat.md' ? 'OUTDATED' : a.json),
    });
    expect(res.fresh).toBe(false);
    expect(res.staleFiles).toEqual(['cat.md']);
  });
});
