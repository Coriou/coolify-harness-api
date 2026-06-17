import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildArtifacts } from '../src/catalog/generate.js';
import { RepresentativeSchema, WebLikeSchema } from './fixtures/schemas/representative.js';

const golden = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./golden/${name}`, import.meta.url)), 'utf8');

describe('catalog golden output', () => {
  const a = buildArtifacts([
    { service: 'api', schema: RepresentativeSchema },
    { service: 'web', schema: WebLikeSchema },
  ]);
  it('matches the golden markdown', () => expect(a.markdown).toBe(golden('catalog.md')));
  it('matches the golden json', () => expect(a.json).toBe(golden('catalog.json')));
  it('matches the golden .env.example', () => expect(a.dotenv).toBe(golden('.env.example')));
});
