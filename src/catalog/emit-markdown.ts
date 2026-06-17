import type { CatalogModel } from './walk.js';

export function emitMarkdown(model: CatalogModel): string {
  const lines: string[] = ['# Environment Variable Catalog', ''];
  lines.push('| Key | Type | Required | Default | Services | Description |');
  lines.push('| --- | ---- | -------- | ------- | -------- | ----------- |');
  for (const e of model) {
    const type = e.enumValues ? `enum(${e.enumValues.join('|')})` : e.type;
    lines.push(
      `| ${e.key} | ${type} | ${e.required ? 'yes' : 'no'} | ${e.default ?? ''} | ${e.services.join(', ')} | ${e.description ?? ''} |`,
    );
  }

  const missing = model.filter((e) => e.description === undefined).map((e) => e.key);
  if (missing.length > 0) {
    lines.push('', '## Keys missing a description', '');
    for (const k of missing) lines.push(`- ${k}`);
  }

  const conflicts = model.filter((e) => e.conflict !== undefined);
  if (conflicts.length > 0) {
    lines.push('', '## Conflicts', '');
    for (const e of conflicts) lines.push(`- ${e.conflict ?? ''}`);
  }

  return `${lines.join('\n')}\n`;
}
