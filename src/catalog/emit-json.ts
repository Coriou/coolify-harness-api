import type { CatalogModel } from './walk.js';

export function emitJson(model: CatalogModel): string {
  return `${JSON.stringify(model, null, 2)}\n`;
}
