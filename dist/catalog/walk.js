import { z } from 'zod';
const PEM_KEY_RE = /_KEY$|_PEM$|PRIVATE_KEY/i;
function def(schema) {
    // reason: accessing the documented Zod runtime `_def` shape requires an unknown cast.
    return schema._def;
}
function typeNameOf(schema) {
    return def(schema).typeName;
}
function unwrapField(schema) {
    let current = schema;
    let required = true;
    let defaultValue;
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
            if (d.effect?.type === 'transform')
                transformed = true;
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
    const result = { base: current, required, transformed, coerced };
    return defaultValue === undefined ? result : { ...result, defaultValue };
}
function baseType(schema) {
    const tn = typeNameOf(schema);
    switch (tn) {
        case 'ZodNumber': return { type: 'number' };
        case 'ZodBoolean': return { type: 'boolean' };
        case 'ZodEnum': return { type: 'enum', enumValues: [...(def(schema).values ?? [])] };
        case 'ZodString': return { type: 'string' };
        default: return { type: tn ? tn.replace(/^Zod/, '').toLowerCase() : 'unknown' };
    }
}
function serializeDefault(value) {
    if (value === undefined)
        return undefined;
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return JSON.stringify(value);
}
function descriptionOf(schema) {
    // reason: `.describe()` writes to `_def.description`, untyped in the runtime def.
    const d = schema._def;
    return d.description;
}
function unwrapToObject(schema) {
    let current = schema;
    for (;;) {
        const tn = typeNameOf(current);
        if (tn === 'ZodObject') {
            const shapeFn = def(current).shape;
            return shapeFn ? shapeFn() : {};
        }
        if (tn === 'ZodEffects') {
            current = def(current).schema;
            continue;
        }
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
export function walkEnvSchema(schema, opts) {
    const shape = unwrapToObject(schema);
    const entries = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
        // .describe() may live on any wrapper level; check the field then its unwrapped base.
        const topDescription = descriptionOf(fieldSchema);
        const u = unwrapField(fieldSchema);
        const baseDescription = descriptionOf(u.base);
        const { type, enumValues } = baseType(u.base);
        const description = topDescription ?? baseDescription;
        const entryBase = {
            key,
            services: [opts.service],
            type,
            required: u.required,
            coerced: u.coerced,
            transformed: u.transformed,
            multiline: PEM_KEY_RE.test(key),
        };
        const serializedDefault = serializeDefault(u.defaultValue);
        const entry = {
            ...entryBase,
            ...(enumValues ? { enumValues } : {}),
            ...(serializedDefault !== undefined ? { default: serializedDefault } : {}),
            ...(description !== undefined ? { description } : {}),
        };
        entries.push(entry);
    }
    return entries;
}
export function mergeCatalogs(perService) {
    const byKey = new Map();
    for (const entries of perService) {
        for (const entry of entries) {
            const existing = byKey.get(entry.key);
            if (!existing) {
                byKey.set(entry.key, { ...entry, services: [...entry.services] });
                continue;
            }
            for (const svc of entry.services) {
                if (!existing.services.includes(svc))
                    existing.services.push(svc);
            }
            const notes = [];
            if (existing.type !== entry.type) {
                notes.push(`${entry.key}: type differs across services (${existing.type} vs ${entry.type})`);
            }
            if (existing.default !== entry.default) {
                notes.push(`${entry.key}: default differs across services (${existing.default ?? '∅'} vs ${entry.default ?? '∅'})`);
            }
            if (notes.length > 0) {
                existing.conflict = existing.conflict ? `${existing.conflict}; ${notes.join('; ')}` : notes.join('; ');
            }
        }
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
