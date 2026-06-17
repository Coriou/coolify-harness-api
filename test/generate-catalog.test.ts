import { describe, it, expect, vi } from 'vitest';
import { generateCatalog, buildArtifacts } from '../src/catalog/generate.js';
import { RepresentativeSchema, WebLikeSchema } from './fixtures/schemas/representative.js';

describe('generateCatalog', () => {
  it('builds all three artifacts deterministically', () => {
    const a = buildArtifacts([
      { service: 'api', schema: RepresentativeSchema },
      { service: 'web', schema: WebLikeSchema },
    ]);
    const b = buildArtifacts([
      { service: 'api', schema: RepresentativeSchema },
      { service: 'web', schema: WebLikeSchema },
    ]);
    expect(a.markdown).toBe(b.markdown);
    expect(a.json).toBe(b.json);
    expect(a.dotenv).toBe(b.dotenv);
    expect(a.model.find((e) => e.key === 'LOG_LEVEL')!.services.sort()).toEqual(['api', 'web']);
  });

  it('writes only the provided out paths', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    await generateCatalog({
      schemas: [{ service: 'api', schema: RepresentativeSchema }],
      out: { markdown: 'docs/cat.md', json: 'docs/cat.json' },
      writeFile,
    });
    const paths = writeFile.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(['docs/cat.md', 'docs/cat.json']);
  });
});
