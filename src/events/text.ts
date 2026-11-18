/**
 * @file text.ts
 * @brief Translated event text: the event system's view of the localization system.
 *
 * Scripts never contain the words the player reads, only **text keys**
 * (`"events.lab_aide.hello"`). The words live in
 * `content/locales/<category>/<locale>.csv` (see src/i18n/csv.ts and
 * docs/LOCALIZATION.md), so translators work on spreadsheets and never touch scripts.
 *
 * `TextStore` is a `Localizer` (src/i18n/Localizer.ts) that fills the game's
 * placeholders from a `GameState`:
 * - `{player}`: the player's name; `{money}`: their money;
 * - `{var:name}`: a variable;
 * - `{item:id}`, `{species:id}`, `{move:id}`, `{ability:id}`, `{nature:id}`, `{type:id}`: a translated name;
 * - `{text:key}`: another line;
 * - `{name}`: the command's `params.name`. A param whose value is a text
 *   key (e.g. `"items.potion.name"`) is shown translated;
 * - plurals, selects, grammar tags and numbers (src/i18n/message.ts).
 *
 * A key missing in the current locale falls back along the locale's chain
 * (`es-mx → es-es → en`), then to the key itself, so a missing line is
 * visible but never crashes the game.
 */
import { BASE_LOCALE, Localizer } from '../i18n/index.ts';
import type { MessageEnv, MessageParams } from '../i18n/index.ts';
import type { GameState } from '../state/GameState.ts';
import { resolveValue } from './conditions.ts';
import type { TextParams } from './schema.ts';

export { parseCsv, parseLocaleCsv } from '../i18n/index.ts';

/** @brief Locale that every other locale falls back to in the end. */
export const FALLBACK_LOCALE = BASE_LOCALE;

/** @brief What placeholders are filled from. */
export interface TextContext
{
    state: GameState;
    random?: () => number;
}

/**
 * @brief Translated text for every loaded locale, with the game's placeholders.
 *
 * @code
 * const text = new TextStore({ en: parseLocaleCsv(enCsv) }, 'en');
 * text.format('events.lab_aide.hello', { state });
 * @endcode
 */
export class TextStore extends Localizer
{
    /**
     * @brief The text of a key with its placeholders filled.
     * @param key Text key.
     * @param ctx The game, for `{player}`, `{var:...}` and friends.
     * @param params Values for `{name}` placeholders (numbers, text, `{ "var": … }`...).
     * @return The finished text.
     */
    override format (key: string, ctx?: TextContext | MessageParams, params: TextParams | MessageParams = {}): string
    {
        if (isTextContext(ctx)) return super.format(key, resolveParams(params as TextParams, ctx), gameEnv(ctx.state));
        return super.format(key, (ctx ?? {}) as MessageParams, {});
    }
}

/** @brief Whether an argument is a `TextContext`. */
function isTextContext (value: unknown): value is TextContext
{
    return typeof value === 'object' && value !== null && 'state' in value && typeof (value as TextContext).state?.getSnapshot === 'function';
}

/**
 * @brief Resolve event params (`{ "var": "x" }` and friends) to plain values.
 * @param params The command's params.
 * @param ctx The game.
 */
export function resolveParams (params: TextParams, ctx: TextContext): MessageParams
{
    const out: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(params)) out[name] = resolveValue(value, ctx);
    return out;
}

/**
 * @brief Placeholder values that come from the game state.
 * @param state The game.
 */
export function gameEnv (state: GameState): MessageEnv
{
    const data = state.getSnapshot();
    return {
        player: data.player.name,
        money: data.player.money,
        variable: (name) =>
        {
            const value = state.getVar(name);
            return value === undefined ? '' : String(value);
        },
    };
}
