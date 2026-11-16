import { ConfigError } from '../errors/index.js';

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

/**
 * Any Zod schema object, from whichever zod the CONSUMER uses: zod 3 (`_def.typeName`), zod 4 and
 * zod mini (`_zod.def.type`). The walker reads the schema's own structure and never calls into a
 * zod library, so the consumer's zod version does not have to match the harness's.
 */
export type AnyZodSchema = { readonly _def: unknown } | { readonly _zod: unknown };

const PEM_KEY_RE = /_KEY$|_PEM$|PRIVATE_KEY/i;

/** Version-neutral view of one schema node. */
interface Node {
  /** Normalised kind: `object`, `string`, `default`, `optional`, `transform`, `pipe`, … */
  kind: string;
  def: Record<string, unknown>;
  schema: unknown;
  /** True for a zod 3 schema. */
  legacy?: boolean;
}

/**
 * The only zod 3 wrappers the walker has ever looked through. Kept exactly as they were so a
 * catalog generated from zod 3 schemas stays byte-identical across harness versions (anything
 * else, e.g. `ZodPipeline`, is reported by its own type name: `pipeline`).
 */
const ZOD3_FIELD_WRAPPERS = new Set(['default', 'optional', 'nullable', 'effects', 'catch']);
const ZOD3_OBJECT_WRAPPERS = new Set(['object', 'effects', 'default', 'optional', 'catch', 'intersection']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function nodeOf(schema: unknown): Node {
  if (isRecord(schema)) {
    // zod 4 / zod mini: every schema carries `_zod.def` with a string `type`.
    const core = schema['_zod'];
    if (isRecord(core) && isRecord(core['def']) && typeof core['def']['type'] === 'string') {
      return { kind: core['def']['type'], def: core['def'], schema };
    }
    // zod 3: `_def.typeName` is `ZodString`, `ZodObject`, … → `string`, `object`, … flagged legacy.
    const def = schema['_def'];
    if (isRecord(def) && typeof def['typeName'] === 'string') {
      const name = def['typeName'].replace(/^Zod/, '').toLowerCase();
      return { kind: name, def, schema, legacy: true };
    }
  }
  return { kind: 'unknown', def: {}, schema };
}

/** `.describe()` text of this exact node (zod 3: `_def.description`; zod 4: the global registry). */
function descriptionOf(node: Node): string | undefined {
  const own = node.def['description'];
  if (typeof own === 'string') return own;
  if (isRecord(node.schema)) {
    try {
      const viaGetter = node.schema['description']; // zod 4 classic getter → registry lookup
      if (typeof viaGetter === 'string') return viaGetter;
    } catch {
      // a getter on an exotic schema must not break catalog generation
    }
  }
  if (node.legacy) return undefined;
  // zod mini has no `.description` getter: metadata lives only in the shared global registry.
  try {
    const registry = (globalThis as { __zod_globalRegistry?: { get?: (s: unknown) => unknown } }).__zod_globalRegistry; // reason: zod 4 publishes its registry on globalThis so that every zod copy shares it
    const meta = registry?.get?.(node.schema);
    return isRecord(meta) && typeof meta['description'] === 'string' ? meta['description'] : undefined;
  } catch {
    return undefined; // a registry from another zod build must not break catalog generation
  }
}

/** A default is a thunk in zod 3 and a plain (getter-backed) value in zod 4. */
function defaultValueOf(def: Record<string, unknown>): unknown {
  const dv = def['defaultValue'];
  return typeof dv === 'function' ? (dv as () => unknown)() : dv; // reason: zod 3 stores the default as a zero-argument function
}

interface Unwrapped {
  base: Node;
  required: boolean;
  defaultValue?: unknown;
  transformed: boolean;
  coerced: boolean;
  /** First `.describe()` found from the outside in (zod 4 does not copy it onto wrappers). */
  description?: string;
}

function unwrapField(schema: unknown): Unwrapped {
  let current = nodeOf(schema);
  let required = true;
  let requiredForced = false; // an outer `.nonoptional()` wins over whatever it wraps
  let defaultValue: unknown;
  let transformed = false;
  let description: string | undefined;
  for (let depth = 0; depth < 64; depth += 1) {
    // zod 3 copies a description onto the wrappers created after `.describe()`, so only the
    // outermost node (and the base, below) is read there — exactly what 0.4 did. zod 4 does not
    // copy it, so every level is looked at.
    if (!current.legacy || depth === 0) description ??= descriptionOf(current);
    const d = current.def;
    if (current.legacy && !ZOD3_FIELD_WRAPPERS.has(current.kind)) break;
    switch (current.kind) {
      case 'default':
      case 'prefault':
        if (!requiredForced) required = false;
        // zod 4: the outermost default is the effective one. zod 3 keeps 0.4's reading (innermost).
        if (current.legacy) defaultValue = defaultValueOf(d);
        else defaultValue ??= defaultValueOf(d);
        current = nodeOf(d['innerType']);
        continue;
      case 'optional':
      case 'nullable':
        if (!requiredForced) required = false;
        current = nodeOf(d['innerType']);
        continue;
      case 'nonoptional':
        requiredForced = true;
        current = nodeOf(d['innerType']);
        continue;
      case 'catch':
      case 'readonly':
        current = nodeOf(d['innerType']);
        continue;
      case 'lazy': {
        const getter = d['getter'];
        if (typeof getter !== 'function') break;
        current = nodeOf((getter as () => unknown)()); // reason: zod stores the lazy schema as a zero-argument getter
        continue;
      }
      case 'effects': { // zod 3: refine / superRefine / transform / preprocess all wrap
        const effect = d['effect'];
        if (isRecord(effect) && effect['type'] === 'transform') transformed = true;
        current = nodeOf(d['schema']);
        continue;
      }
      case 'pipe': {
        const input = nodeOf(d['in']);
        const output = nodeOf(d['out']);
        if (output.kind === 'transform') { // zod 4 `.transform(fn)`: the env value is the input side
          transformed = true;
          current = input;
        } else if (input.kind === 'transform') { // zod 4 `z.preprocess(fn, schema)`
          current = output;
        } else { // a real pipe / codec (`z.stringbool()`, `.pipe(z.coerce.number())`): document the result
          transformed = true;
          current = output;
        }
        continue;
      }
      default:
        break;
    }
    break;
  }
  const coerced = current.def['coerce'] === true;
  const result: Unwrapped = { base: current, required, transformed, coerced };
  return {
    ...result,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

function enumValuesOf(node: Node): string[] {
  const values = node.def['values']; // zod 3 ZodEnum: string[]
  if (Array.isArray(values)) return values.map(String);
  const entries = node.def['entries']; // zod 4: { KEY: value } for z.enum([...]) and for TS enums
  if (!isRecord(entries)) return [];
  // A numeric TS enum also maps value → name; keep only the real values, as zod does.
  const numeric = new Set(Object.values(entries).filter((v) => typeof v === 'number').map(String));
  return Object.entries(entries).filter(([k]) => !numeric.has(k)).map(([, v]) => String(v));
}

function baseType(node: Node): { type: string; enumValues?: string[] } {
  switch (node.kind) {
    case 'enum': return { type: 'enum', enumValues: enumValuesOf(node) };
    default: return { type: node.kind };
  }
}

function serializeDefault(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function unwrapToObject(schema: unknown): Record<string, unknown> {
  let current = nodeOf(schema);
  for (let depth = 0; depth < 64; depth += 1) {
    const d = current.def;
    if (current.legacy && !ZOD3_OBJECT_WRAPPERS.has(current.kind)) break;
    switch (current.kind) {
      case 'object': {
        const shape = d['shape']; // zod 3: a thunk; zod 4: the shape object itself
        const resolved: unknown = typeof shape === 'function' ? (shape as () => unknown)() : shape; // reason: zod 3 stores the shape as a zero-argument function
        return isRecord(resolved) ? { ...resolved } : {};
      }
      case 'effects':
        current = nodeOf(d['schema']);
        continue;
      case 'default': case 'prefault': case 'optional': case 'nullable': case 'nonoptional': case 'catch': case 'readonly':
        current = nodeOf(d['innerType']);
        continue;
      case 'pipe': {
        const input = nodeOf(d['in']);
        current = input.kind === 'transform' ? nodeOf(d['out']) : input;
        continue;
      }
      case 'lazy': {
        const getter = d['getter'];
        if (typeof getter !== 'function') break;
        current = nodeOf((getter as () => unknown)()); // reason: zod stores the lazy schema as a zero-argument getter
        continue;
      }
      case 'intersection':
        // Merge the shapes from both sides of the intersection. Right-side keys win on collision.
        return { ...unwrapToObject(d['left']), ...unwrapToObject(d['right']) };
      default:
        break;
    }
    break;
  }
  const what = current.kind === 'unknown'
    ? 'not a Zod schema (expected a zod 3 or zod 4 object schema)'
    : `a Zod ${current.kind}, not an object schema`;
  throw new ConfigError(`walkEnvSchema: top-level schema is ${what}`);
}

export function walkEnvSchema(schema: AnyZodSchema, opts: { service: string }): CatalogEntry[] {
  const shape = unwrapToObject(schema);
  const entries: CatalogEntry[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const u = unwrapField(fieldSchema);
    // .describe() may live on any wrapper level (found while unwrapping) or on the base itself.
    const description = u.description ?? descriptionOf(u.base);
    const { type, enumValues } = baseType(u.base);
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
