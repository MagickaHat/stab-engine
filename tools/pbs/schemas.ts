/**
 * @file schemas.ts
 * @brief CLI: writes JSON Schema files to `content/pbs/schemas` from the Zod schemas,
 *        so editors (VS Code etc.) autocomplete and check `content/pbs/custom/*.json`.
 *
 * @code
 * npm run pbs:schemas
 * @endcode
 *
 * Two schemas per table:
 * - `<table>.schema.json`: a complete table (generated data);
 * - `<table>.patch.schema.json`: a custom override file, where every field is
 *   optional and `null` is allowed (it deletes, see `src/data/merge.ts`).
 *
 * Reference one from a custom file with a `"$schema"` key (ignored by the loader):
 * `{ "$schema": "../schemas/moves.patch.schema.json", "tackle": { "basePower": 50 } }`
 */
import path from 'node:path';
import { z } from 'zod';
import { TABLES, TABLE_NAMES } from '../../src/data/tables.ts';
import { SCHEMAS_DIR } from '../pokeapi/config.ts';
import { writeJson } from './io.ts';

/**
 * @brief Turn a JSON Schema into its "patch" form: nothing required, `null` allowed.
 * @param schema JSON Schema node.
 * @return Patched copy.
 */
function toPatch (schema: unknown): unknown
{
    if (Array.isArray(schema)) return schema.map(toPatch);
    if (!schema || typeof schema !== 'object') return schema;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema))
    {
        if (key === 'required') continue;
        out[key] = key === 'properties' || key === 'patternProperties'
            ? Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, { anyOf: [toPatch(v), { type: 'null' }] }]))
            : toPatch(value);
    }
    if (out.additionalProperties && typeof out.additionalProperties === 'object')
    {
        out.additionalProperties = { anyOf: [out.additionalProperties, { type: 'null' }] };
    }
    return out;
}

for (const name of TABLE_NAMES)
{
    const { file, schema } = TABLES[name];
    const base = file.replace(/\.json$/, '');
    const json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
    // Allow "$schema"/"$comment" keys in the files themselves (IDs are otherwise lowercase alphanumeric).
    const withMeta = {
        ...json,
        propertyNames: { type: 'string', pattern: '^([a-z0-9]+|\\$[A-Za-z]+)$' },
        properties: { $schema: { type: 'string' }, $comment: { type: 'string' } },
    };
    writeJson(path.join(SCHEMAS_DIR, `${base}.schema.json`), { title: `PBS ${file}`, ...withMeta });
    writeJson(path.join(SCHEMAS_DIR, `${base}.patch.schema.json`), {
        title: `PBS custom override for ${file}`,
        ...(toPatch(withMeta) as object),
        properties: withMeta.properties,
    });
}
console.log(`✓ Wrote ${TABLE_NAMES.length * 2} schemas to ${path.relative(process.cwd(), SCHEMAS_DIR)}`);
