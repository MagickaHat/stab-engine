/**
 * @file graphics.ts
 * @brief `npm run locales:graphics`: prints which file each locale shows for
 *        each translated graphic (the same decision the build makes).
 *
 * Translated images go in `public/assets/img/locales/<locale>/`, at the same
 * path as the original under `public/assets/img/`. A locale without its own
 * copy uses its sister locale's (`es-mx` → `es-es`), else the original.
 * `--json` prints the map as JSON.
 */
import { buildLocaleGraphicsMap } from '../../src/i18n/graphics.ts';
import { UI_LOCALES } from '../../src/i18n/languages.ts';
import { isMain } from '../events/content.ts';
import { listLocaleGraphics } from './content.ts';

if (isMain(import.meta.url))
{
    const map = buildLocaleGraphicsMap(listLocaleGraphics(), UI_LOCALES);
    if (process.argv.includes('--json')) console.log(JSON.stringify(map, null, 2));
    else if (!Object.keys(map).length) console.log('No translated graphics (public/assets/img/locales/<locale>/...): every locale shows the originals.');
    else
    {
        for (const [locale, entries] of Object.entries(map))
        {
            console.log(`${locale}:`);
            for (const [graphic, file] of Object.entries(entries)) console.log(`  img/${graphic}.png → img/${file}.png`);
        }
    }
}
