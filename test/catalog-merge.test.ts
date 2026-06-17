import { describe, it, expect } from 'vitest';
import { walkEnvSchema, mergeCatalogs } from '../src/catalog/walk.js';
import { RepresentativeSchema, WebLikeSchema } from './fixtures/schemas/representative.js';

describe('mergeCatalogs', () => {
  it('unions services for a shared key and flags divergent defaults', () => {
    const api = walkEnvSchema(RepresentativeSchema, { service: 'api' });
    const web = walkEnvSchema(WebLikeSchema, { service: 'web' });
    const merged = mergeCatalogs([api, web]);
    const log = merged.find((e) => e.key === 'LOG_LEVEL')!;
    expect(log.services.sort()).toEqual(['api', 'web']);
    expect(log.conflict).toContain('default differs');
  });

  it('produces key-sorted deterministic output', () => {
    const merged = mergeCatalogs([walkEnvSchema(RepresentativeSchema, { service: 'api' })]);
    const keys = merged.map((e) => e.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });
});
