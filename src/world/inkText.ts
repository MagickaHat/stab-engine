/**
 * @file inkText.ts
 * @brief Translation of ink lines and speakers (used by src/world/ink.ts).
 *
 * A line or choice with `#id:` tags shows `ink.<id>` from the game's locale
 * when that locale (or its sister) has it; English is ink's own text. See
 * `npm run locales:ink-ids` (tools/locales/inkIds.ts).
 */
import { toID } from '../data/integrity.ts';
import type { DialogueEngine } from '../dialogue/DialogueEngine.ts';
import type { DialogueChoice, DialogueLine } from '../dialogue/types.ts';
import type { Localizer } from '../i18n/Localizer.ts';
import type { GameState } from '../state/GameState.ts';

/**
 * @brief The translated text of a line or choice, if the game's locale has one.
 * @param item The line or choice, with its `#id:` tags.
 * @param text The localizer.
 * @param engine The story, for `{ink:...}` placeholders.
 * @param state The game, for `{player}`, `{var:...}`.
 * @return The translation, or `null` to show ink's own text.
 */
export function translateInk (item: DialogueLine | DialogueChoice, text: Localizer | undefined, engine: Pick<DialogueEngine, 'getVariable'>, state: GameState): string | null
{
    if (!text) return null;
    const ids = item.tags.map((tag) => /^id:\s*(.+)$/.exec(tag.trim())?.[1]).filter((id): id is string => !!id);
    if (!ids.length) return null;
    const parts: string[] = [];
    for (const id of ids)
    {
        const found = text.lookup(`ink.${id}`);
        //  English is ink's own text: only use translations.
        if (!found || found.locale === 'en') return null;
        const data = state.getSnapshot();
        parts.push(text.formatText(found.text, {}, {
            player: data.player.name,
            money: data.player.money,
            variable: (name) => String(state.getVar(name) ?? ''),
            ink: (name) =>
            {
                const value = engine.getVariable(name);
                return typeof value === 'number' || typeof value === 'string' ? value : String(value ?? '');
            },
        }));
    }
    return parts.join(' ');
}

/**
 * @brief The translated name of a speaker (`# speaker: Professor` → `ink.speaker.professor`).
 * @param speaker Speaker tag value.
 * @param text The localizer.
 */
export function translateSpeaker (speaker: string, text: Localizer | undefined): string
{
    if (!text) return speaker;
    const found = text.lookup(`ink.speaker.${toID(speaker)}`);
    return found && found.locale !== 'en' ? found.text : speaker;
}

