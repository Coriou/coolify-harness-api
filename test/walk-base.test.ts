import { describe, it, expect } from 'vitest';
import { walkEnvSchema } from '../src/catalog/walk.js';
import { RepresentativeSchema } from './fixtures/schemas/representative.js';

describe('walkEnvSchema base traversal', () => {
  const entries = walkEnvSchema(RepresentativeSchema, { service: 'api' });
  const byKey = new Map(entries.map((e) => [e.key, e]));

  it('unwraps a superRefine-wrapped object to reach every field', () => {
    expect(entries.map((e) => e.key).sort()).toEqual(
      ['CORS_ORIGINS', 'FEATURE_X_ENABLED', 'JWT_PRIVATE_KEY', 'LOG_LEVEL', 'NODE_ENV', 'NO_DESCRIPTION_KEY', 'OPTIONAL_FLAG', 'PORT'],
    );
  });

  it('records enum values and default for NODE_ENV', () => {
    const e = byKey.get('NODE_ENV')!;
    expect(e.type).toBe('enum');
    expect(e.enumValues).toEqual(['development', 'production', 'test']);
    expect(e.required).toBe(false);
    expect(e.default).toBe('development');
    expect(e.description).toBe('Runtime mode');
  });

  it('marks coerced number and boolean', () => {
    expect(byKey.get('PORT')!.coerced).toBe(true);
    expect(byKey.get('PORT')!.type).toBe('number');
    expect(byKey.get('FEATURE_X_ENABLED')!.coerced).toBe(true);
    expect(byKey.get('FEATURE_X_ENABLED')!.type).toBe('boolean');
  });

  it('marks transformed for CSV→array', () => {
    expect(byKey.get('CORS_ORIGINS')!.transformed).toBe(true);
  });

  it('marks optional() as not required', () => {
    expect(byKey.get('OPTIONAL_FLAG')!.required).toBe(false);
  });

  it('flags PEM-shaped keys as multiline', () => {
    expect(byKey.get('JWT_PRIVATE_KEY')!.multiline).toBe(true);
    expect(byKey.get('PORT')!.multiline).toBe(false);
  });

  it('leaves description undefined when no .describe()', () => {
    expect(byKey.get('NO_DESCRIPTION_KEY')!.description).toBeUndefined();
  });

  it('attaches the owning service', () => {
    expect(byKey.get('NODE_ENV')!.services).toEqual(['api']);
  });
});
