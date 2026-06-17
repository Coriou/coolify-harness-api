import { describe, it, expect } from 'vitest';
import { emitMarkdown } from '../src/catalog/emit-markdown.js';
import { emitJson } from '../src/catalog/emit-json.js';
import type { CatalogModel } from '../src/catalog/walk.js';

const model: CatalogModel = [
  { key: 'A_FLAG', services: ['api'], type: 'boolean', required: false, default: 'false',
    description: 'Toggle A', coerced: true, transformed: false, multiline: false },
  { key: 'NO_DESC', services: ['api', 'web'], type: 'string', required: true,
    coerced: false, transformed: false, multiline: false },
];

describe('emitters', () => {
  it('emits a markdown table + missing-description section', () => {
    const md = emitMarkdown(model);
    expect(md).toContain('| Key | Type | Required | Default | Services | Description |');
    expect(md).toContain('| A_FLAG | boolean | no | false | api | Toggle A |');
    expect(md).toContain('## Keys missing a description');
    expect(md).toContain('NO_DESC');
  });

  it('emits deterministic pretty JSON ending in a newline', () => {
    const json = emitJson(model);
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(model);
  });
});
