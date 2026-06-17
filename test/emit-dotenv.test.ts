import { describe, it, expect } from 'vitest';
import { emitDotenv } from '../src/catalog/emit-dotenv.js';
import type { CatalogModel } from '../src/catalog/walk.js';

const model: CatalogModel = [
  { key: 'PORT', services: ['api'], type: 'number', required: false, default: '3001',
    description: 'HTTP listen port', coerced: true, transformed: false, multiline: false },
  { key: 'SECRET', services: ['api'], type: 'string', required: true,
    coerced: false, transformed: false, multiline: false },
];

describe('emitDotenv', () => {
  it('emits a documented .env.example', () => {
    const out = emitDotenv(model);
    expect(out).toContain('# HTTP listen port');
    expect(out).toContain('# type: number | required: no | services: api');
    expect(out).toContain('PORT=3001');
    expect(out).toContain('SECRET=');
  });
});
