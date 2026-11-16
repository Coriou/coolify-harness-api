import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as zm from 'zod/mini';
import { z as z3 } from 'zod/v3';
import { walkEnvSchema, type CatalogEntry } from '../src/catalog/walk.js';
import { buildArtifacts, type SchemaInput } from '../src/catalog/generate.js';
import { RepresentativeSchema, WebLikeSchema, IntersectionSchema } from './fixtures/schemas/representative.js';
import { RepresentativeSchemaV3, WebLikeSchemaV3, IntersectionSchemaV3 } from './fixtures/schemas/representative-zod3.js';

const golden = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./golden/${name}`, import.meta.url)), 'utf8');
const byKey = (entries: CatalogEntry[]): Map<string, CatalogEntry> => new Map(entries.map((e) => [e.key, e]));

describe('catalog walker: the consumer picks the zod version', () => {
  it('the two fixture files really are different zod majors', () => {
    expect('_zod' in RepresentativeSchema).toBe(true); // zod 4
    expect('_zod' in RepresentativeSchemaV3).toBe(false); // zod 3
    expect((RepresentativeSchemaV3 as unknown as { _def: { typeName: string } })._def.typeName).toBe('ZodEffects');
  });

  it('a zod 4 schema and the same schema in zod 3 produce the same catalog entries', () => {
    expect(walkEnvSchema(RepresentativeSchema, { service: 'api' })).toEqual(walkEnvSchema(RepresentativeSchemaV3, { service: 'api' }));
    expect(walkEnvSchema(WebLikeSchema, { service: 'web' })).toEqual(walkEnvSchema(WebLikeSchemaV3, { service: 'web' }));
    expect(walkEnvSchema(IntersectionSchema, { service: 'api' })).toEqual(walkEnvSchema(IntersectionSchemaV3, { service: 'api' }));
  });

  it('both majors reproduce the committed golden artifacts byte for byte', () => {
    const inputs: Array<[string, SchemaInput[]]> = [
      ['zod 4', [{ service: 'api', schema: RepresentativeSchema }, { service: 'web', schema: WebLikeSchema }]],
      ['zod 3', [{ service: 'api', schema: RepresentativeSchemaV3 }, { service: 'web', schema: WebLikeSchemaV3 }]],
    ];
    for (const [label, schemas] of inputs) {
      const out = buildArtifacts(schemas);
      expect(out.markdown, label).toBe(golden('catalog.md'));
      expect(out.json, label).toBe(golden('catalog.json'));
      expect(out.dotenv, label).toBe(golden('.env.example'));
    }
  });

  it('accepts one zod 3 and one zod 4 schema in the same catalog', () => {
    const out = buildArtifacts([{ service: 'api', schema: RepresentativeSchemaV3 }, { service: 'web', schema: WebLikeSchema }]);
    expect(out.markdown).toBe(golden('catalog.md'));
  });
});

describe('catalog walker: zod 4 constructs', () => {
  const Schema = z.object({
    DATABASE_URL: z.url().describe('Postgres connection string'),
    ADMIN_EMAIL: z.email().optional().describe('Where alerts go'),
    DEBUG: z.stringbool().default(false).describe('Verbose logging'),
    WORKERS: z.coerce.number().int().min(1).default(2).describe('Worker count'),
    REGION: z.enum(['eu', 'us']).prefault('eu').describe('Deployment region'),
    TAGS: z.string().transform((s) => s.split(',')).describe('Comma-separated tags'),
    RETRIES: z.preprocess((v) => Number(v), z.number()).describe('Retry budget'),
    TIMEOUT_MS: z.string().pipe(z.coerce.number()).describe('Request timeout'),
    LEVEL: z.literal('info').describe('Fixed level'),
    META_ONLY: z.string().meta({ description: 'Described with .meta()' }),
    DESCRIBED_INSIDE: z.string().describe('described before wrapping').optional().default('d'),
    READONLY: z.string().readonly().describe('Read-only string'),
    NULLABLE: z.string().nullable(),
    NON_OPTIONAL: z.string().optional().nonoptional(),
    CAUGHT: z.number().catch(7),
  });
  const entries = byKey(walkEnvSchema(Schema, { service: 'api' }));

  it('reads string formats, coercion, defaults and required-ness', () => {
    expect(entries.get('DATABASE_URL')).toMatchObject({ type: 'string', required: true, description: 'Postgres connection string' });
    expect(entries.get('ADMIN_EMAIL')).toMatchObject({ type: 'string', required: false });
    expect(entries.get('WORKERS')).toMatchObject({ type: 'number', coerced: true, required: false, default: '2' });
    expect(entries.get('NULLABLE')).toMatchObject({ type: 'string', required: false });
    expect(entries.get('NON_OPTIONAL')).toMatchObject({ type: 'string', required: true });
    expect(entries.get('CAUGHT')).toMatchObject({ type: 'number', required: true });
    expect(entries.get('READONLY')).toMatchObject({ type: 'string', description: 'Read-only string' });
    expect(entries.get('LEVEL')).toMatchObject({ type: 'literal' });
  });

  it('documents the result type of stringbool / pipe and flags the conversion', () => {
    expect(entries.get('DEBUG')).toMatchObject({ type: 'boolean', transformed: true, required: false, default: 'false' });
    expect(entries.get('TIMEOUT_MS')).toMatchObject({ type: 'number', transformed: true, coerced: true });
  });

  it('treats .transform() as a transformed string and z.preprocess() as its target type', () => {
    expect(entries.get('TAGS')).toMatchObject({ type: 'string', transformed: true, required: true });
    expect(entries.get('RETRIES')).toMatchObject({ type: 'number', transformed: false });
  });

  it('reads enum values and a prefault as the default', () => {
    expect(entries.get('REGION')).toMatchObject({ type: 'enum', enumValues: ['eu', 'us'], required: false, default: 'eu' });
  });

  it('finds a description wherever it was attached (zod 4 does not copy it onto wrappers)', () => {
    expect(entries.get('META_ONLY')!.description).toBe('Described with .meta()');
    expect(entries.get('DESCRIBED_INSIDE')).toMatchObject({ description: 'described before wrapping', required: false, default: 'd' });
  });

  it('walks a TypeScript-style enum object', () => {
    const Level = { Debug: 'debug', Info: 'info' } as const;
    const [e] = walkEnvSchema(z.object({ LEVEL: z.enum(Level) }), { service: 'api' });
    expect(e).toMatchObject({ type: 'enum', enumValues: ['debug', 'info'] });
  });

  it('walks refined, extended, intersected and lazily wrapped object schemas', () => {
    const A = z.object({ A: z.string() }).refine(() => true);
    const B = z.object({ B: z.string().default('b') });
    expect(walkEnvSchema(A.and(B), { service: 's' }).map((e) => e.key)).toEqual(['A', 'B']);
    expect(walkEnvSchema(z.object({ A: z.string() }).extend({ C: z.number() }), { service: 's' }).map((e) => e.key)).toEqual(['A', 'C']);
    expect(walkEnvSchema(z.lazy(() => B), { service: 's' })[0]).toMatchObject({ key: 'B', default: 'b' });
    expect(walkEnvSchema(z.object({ A: z.string() }).transform((v) => v), { service: 's' }).map((e) => e.key)).toEqual(['A']);
  });
});

describe('catalog walker: zod mini', () => {
  it('walks a zod/mini schema, including a description from the shared registry', () => {
    const Schema = zm.object({
      PORT: zm._default(zm.coerce.number(), 3000).register(zm.globalRegistry, { description: 'HTTP port' }),
      MODE: zm.optional(zm.enum(['a', 'b'])),
      NAME: zm.string(),
    });
    const entries = byKey(walkEnvSchema(Schema, { service: 'api' }));
    expect(entries.get('PORT')).toMatchObject({ type: 'number', coerced: true, required: false, default: '3000', description: 'HTTP port' });
    expect(entries.get('MODE')).toMatchObject({ type: 'enum', enumValues: ['a', 'b'], required: false });
    expect(entries.get('NAME')).toMatchObject({ type: 'string', required: true });
  });
});

describe('catalog walker: zod 3 output is unchanged', () => {
  it('keeps the historical type names for constructs it never unwrapped', () => {
    enum Color { Red = 'red' }
    const entries = byKey(walkEnvSchema(z3.object({
      PIPED: z3.string().pipe(z3.coerce.number()),
      NATIVE: z3.nativeEnum(Color),
      BRANDED: z3.string().brand('x'),
      PRE: z3.preprocess((v) => v, z3.number()),
    }), { service: 'api' }));
    expect(entries.get('PIPED')!.type).toBe('pipeline');
    expect(entries.get('NATIVE')).toMatchObject({ type: 'nativeenum' });
    expect(entries.get('NATIVE')!.enumValues).toBeUndefined();
    expect(entries.get('BRANDED')!.type).toBe('branded');
    expect(entries.get('PRE')).toMatchObject({ type: 'number', transformed: false });
  });
});

describe('catalog walker: bad input', () => {
  it('says what it got when the top-level schema is not an object', () => {
    expect(() => walkEnvSchema(z.string(), { service: 'api' })).toThrow(/top-level schema is a Zod string, not an object schema/);
    expect(() => walkEnvSchema(z3.string(), { service: 'api' })).toThrow(/top-level schema is a Zod string, not an object schema/);
    expect(() => walkEnvSchema({ _def: {} }, { service: 'api' })).toThrow(/not a Zod schema/);
  });
});
