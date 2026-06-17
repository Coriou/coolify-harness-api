import { z } from 'zod';

export interface CatalogEntry {
  key: string;
  services: string[];
  type: string;
  enumValues?: string[];
  required: boolean;
  default?: string;
  description?: string;
  coerced: boolean;
  transformed: boolean;
  multiline: boolean;
  conflict?: string;
}

export type CatalogModel = CatalogEntry[];

const PEM_KEY_RE = /_KEY$|_PEM$|PRIVATE_KEY/i;

// reason: Zod's internal `_def` is loosely typed; we read documented fields and narrow by typeName.
type AnyDef = { typeName?: string; innerType?: unknown; schema?: unknown; effect?: { type?: string };
  defaultValue?: () => unknown; coerce?: boolean; values?: readonly string[]; shape?: () => Record<string, unknown>;
  left?: unknown; right?: unknown };

function def(schema: unknown): AnyDef {
  // reason: accessing the documented Zod runtime `_def` shape requires an unknown cast.
  return (schema as { _def: AnyDef })._def;
}

function typeNameOf(schema: unknown): string | undefined {
  return def(schema).typeName;
}

interface Unwrapped {
  base: unknown;
  required: boolean;
  defaultValue?: unknown;
  transformed: boolean;
  coerced: boolean;
}

function unwrapField(schema: unknown): Unwrapped {
  let current = schema;
  let required = true;
  let defaultValue: unknown;
  let transformed = false;
  for (;;) {
    const tn = typeNameOf(current);
    const d = def(current);
    if (tn === 'ZodDefault') {
      required = false;
      defaultValue = d.defaultValue ? d.defaultValue() : undefined;
      current = d.innerType;
      continue;
    }
    if (tn === 'ZodOptional' || tn === 'ZodNullable') {
      required = false;
      current = d.innerType;
      continue;
    }
    if (tn === 'ZodEffects') {
      if (d.effect?.type === 'transform') transformed = true;
      current = d.schema;
      continue;
    }
    if (tn === 'ZodCatch') {
      current = d.innerType;
      continue;
    }
    break;
  }
  const coerced = def(current).coerce === true;
  const result: Unwrapped = { base: current, required, transformed, coerced };
  return defaultValue === undefined ? result : { ...result, defaultValue };
}

function baseType(schema: unknown): { type: string; enumValues?: string[] } {
  const tn = typeNameOf(schema);
  switch (tn) {
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'enum', enumValues: [...(def(schema).values ?? [])] };
    case 'ZodString': return { type: 'string' };
    default: return { type: tn ? tn.replace(/^Zod/, '').toLowerCase() : 'unknown' };
  }
}

function serializeDefault(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function descriptionOf(schema: unknown): string | undefined {
  // reason: `.describe()` writes to `_def.description`, untyped in the runtime def.
  const d = (schema as { _def: { description?: string } })._def;
  return d.description;
}

function unwrapToObject(schema: unknown): Record<string, unknown> {
  let current = schema;
  for (;;) {
    const tn = typeNameOf(current);
    if (tn === 'ZodObject') {
      const shapeFn = def(current).shape;
      return shapeFn ? shapeFn() : {};
    }
    if (tn === 'ZodEffects') { current = def(current).schema; continue; }
    if (tn === 'ZodDefault' || tn === 'ZodOptional' || tn === 'ZodCatch') {
      current = def(current).innerType;
      continue;
    }
    if (tn === 'ZodIntersection') {
      // Merge the shapes from both sides of the intersection. Right-side keys win on collision.
      const d = def(current);
      const left = unwrapToObject(d.left);
      const right = unwrapToObject(d.right);
      return { ...left, ...right };
    }
    throw new Error(`walkEnvSchema: top-level schema is not a ZodObject (got ${tn ?? 'unknown'})`);
  }
}

export function walkEnvSchema(schema: z.ZodTypeAny, opts: { service: string }): CatalogEntry[] {
  const shape = unwrapToObject(schema);
  const entries: CatalogEntry[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    // .describe() may live on any wrapper level; check the field then its unwrapped base.
    const topDescription = descriptionOf(fieldSchema);
    const u = unwrapField(fieldSchema);
    const baseDescription = descriptionOf(u.base);
    const { type, enumValues } = baseType(u.base);
    const description = topDescription ?? baseDescription;
    const entryBase: CatalogEntry = {
      key,
      services: [opts.service],
      type,
      required: u.required,
      coerced: u.coerced,
      transformed: u.transformed,
      multiline: PEM_KEY_RE.test(key),
    };
    const serializedDefault = serializeDefault(u.defaultValue);
    const entry: CatalogEntry = {
      ...entryBase,
      ...(enumValues ? { enumValues } : {}),
      ...(serializedDefault !== undefined ? { default: serializedDefault } : {}),
      ...(description !== undefined ? { description } : {}),
    };
    entries.push(entry);
  }
  return entries;
}

export function mergeCatalogs(perService: CatalogEntry[][]): CatalogModel {
  const byKey = new Map<string, CatalogEntry>();
  for (const entries of perService) {
    for (const entry of entries) {
      const existing = byKey.get(entry.key);
      if (!existing) {
        byKey.set(entry.key, { ...entry, services: [...entry.services] });
        continue;
      }
      for (const svc of entry.services) {
        if (!existing.services.includes(svc)) existing.services.push(svc);
      }
      const notes: string[] = [];
      if (existing.type !== entry.type) {
        notes.push(`${entry.key}: type differs across services (${existing.type} vs ${entry.type})`);
      }
      if (existing.default !== entry.default) {
        notes.push(
          `${entry.key}: default differs across services (${existing.default ?? '∅'} vs ${entry.default ?? '∅'})`,
        );
      }
      if (notes.length > 0) {
        existing.conflict = existing.conflict ? `${existing.conflict}; ${notes.join('; ')}` : notes.join('; ');
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
