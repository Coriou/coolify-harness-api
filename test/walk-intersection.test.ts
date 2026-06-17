import { describe, it, expect } from 'vitest';
import { walkEnvSchema } from '../src/catalog/walk.js';
import { IntersectionSchema } from './fixtures/schemas/representative.js';

// Real consumers compose env schemas with `.and(...)` (e.g. example-consumer's apps/api joins a JWT-key
// object onto the base via `BaseEnvSchema.extend(...).superRefine(...).and(JwtKeySchema)`). That makes
// the TOP-LEVEL schema a ZodIntersection; the walker must merge the shapes from both sides.
describe('walkEnvSchema on a ZodIntersection top-level (.and())', () => {
  const entries = walkEnvSchema(IntersectionSchema, { service: 'api' });
  const byKey = new Map(entries.map((e) => [e.key, e]));

  it('reaches fields from BOTH sides of the intersection', () => {
    // left side (the superRefine-wrapped Base) keys
    expect(byKey.has('NODE_ENV')).toBe(true);
    expect(byKey.has('CORS_ORIGINS')).toBe(true);
    // right side (JwtKeySchema) keys
    expect(byKey.has('JWT_SIGNING_KEY')).toBe(true);
    expect(byKey.has('JWT_KEY_ID')).toBe(true);
  });

  it('resolves left-side field metadata correctly (enum + default)', () => {
    const nodeEnv = byKey.get('NODE_ENV')!;
    expect(nodeEnv.type).toBe('enum');
    expect(nodeEnv.enumValues).toEqual(['development', 'production', 'test']);
    expect(nodeEnv.default).toBe('development');
  });

  it('resolves right-side field metadata correctly (required string + default)', () => {
    expect(byKey.get('JWT_SIGNING_KEY')!.required).toBe(true);
    expect(byKey.get('JWT_SIGNING_KEY')!.description).toBe('Ed25519 signing key (PEM)');
    const keyId = byKey.get('JWT_KEY_ID')!;
    expect(keyId.required).toBe(false);
    expect(keyId.default).toBe('default');
  });
});
