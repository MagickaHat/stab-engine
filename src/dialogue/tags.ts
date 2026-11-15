/**
 * @file tags.ts
 * @brief Helpers for ink tags (`# speaker: Oak`).
 */
import type { TagMap } from './types';

/**
 * @brief Parses ink tags into a key/value map.
 *
 * Each tag is split on its first colon and both halves are trimmed.
 * A tag without a colon maps to `true`. Later tags win over earlier ones
 * with the same key.
 *
 * @code
 * parseTags(['speaker: Oak', 'portrait:oak_happy', 'shake']);
 * // → { speaker: 'Oak', portrait: 'oak_happy', shake: true }
 * @endcode
 *
 * @param tags Raw tags, as returned by inkjs (may be `null`).
 * @return The parsed tags.
 */
export function parseTags (tags: readonly string[] | null | undefined): TagMap
{
    const map: TagMap = {};
    for (const raw of tags ?? [])
    {
        const tag = raw.trim();
        if (tag.length === 0) continue;
        const colon = tag.indexOf(':');
        if (colon === -1)
        {
            map[tag] = true;
        }
        else
        {
            const key = tag.slice(0, colon).trim();
            if (key.length > 0) map[key] = tag.slice(colon + 1).trim();
        }
    }
    return map;
}
