/**
 * @file schema.ts
 * @brief CLI: writes `content/events/schema.json` from the Zod schemas.
 *
 * @code
 * npm run events:schema
 * @endcode
 *
 * Event files point at it with `"$schema": "./schema.json"`, so editors
 * such as VS Code autocomplete commands and conditions and underline
 * mistakes while typing.
 */
import path from 'node:path';
import { z } from 'zod';
import { EventFile } from '../../src/events/schema.ts';
import { writeJson } from '../pbs/io.ts';
import { ROOT } from './content.ts';

/** @brief Where the schema is written. */
export const SCHEMA_FILE = path.join(ROOT, 'content/events/schema.json');

writeJson(SCHEMA_FILE, {
    title: 'STAB event file',
    ...(z.toJSONSchema(EventFile, { unrepresentable: 'any', io: 'input', cycles: 'ref' }) as object),
});
console.log(`✓ Wrote ${path.relative(process.cwd(), SCHEMA_FILE)}`);
