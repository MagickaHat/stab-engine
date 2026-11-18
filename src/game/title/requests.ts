/**
 * @file requests.ts
 * @brief What the title scenes ask the React UI for: the opening movie and the
 *        New Game / Continue menu.
 *
 * Like the dialogue requests (src/world/dialogue.ts), each request goes over
 * the `EventBus` with a callback the UI calls when it is done, and resolves at
 * once when no UI is listening (tests, tools), so the game never waits forever.
 */
import {EventBus, GameEvents} from '../../bus/EventBus.ts';
import type {SlotInfo} from '../../state/SaveManager.ts';

/** @brief Payload of `GameEvents.TITLE_MOVIE`. */
export interface MovieRequest {
    /** URL of the movie file. */
    src: string;
    /** Whether a button press or tap may end it early. */
    skippable: boolean;
    /** Call once the movie has ended, was skipped or could not play. */
    done: () => void;
}

/** @brief What the player picked in the New Game / Continue menu. */
export type LoadMenuChoice =|
{
    kind: 'continue';
    slot: number
}
|{ kind: 'newGame' } /** B: back to the title screen. */
|{ kind: 'back' };

/** @brief Payload of `GameEvents.TITLE_LOAD_MENU`. */
export interface LoadMenuRequest {
    /** Every save slot (`SaveManager.list()`). */
    slots: SlotInfo[];
    /** Call once with what the player picked. */
    pick: (choice: LoadMenuChoice) => void;
}

/**
 * @brief Play a movie over the game and wait for it to end.
 * @param src URL of the movie.
 * @param skippable Whether the player may skip it.
 * @return Resolves when it has ended (at once if no UI is listening).
 */
export function playMovie(src: string, skippable: boolean): Promise<void>
{
    return new Promise((resolve) => {
        if (EventBus.listenerCount(GameEvents.TITLE_MOVIE) === 0)
        {
            resolve();
            return;
        }
        let ended = false;
        EventBus.emit(GameEvents.TITLE_MOVIE, {
            src,
            skippable,
            done: () => {
                if (ended) return;
                ended = true;
                resolve();
            },
        } satisfies MovieRequest);
    });
}

/**
 * @brief The slots the Continue menu offers, most recently saved first.
 * @param slots Every slot (`SaveManager.list()`).
 * @return Slots holding a save, readable or not; empty slots are left out.
 */
export function continueSlots(slots: readonly SlotInfo[]): SlotInfo[]
{
    const savedAt = (info: SlotInfo) => (info.status === 'ok' ? Date.parse(info.summary.savedAt) || 0 : -Infinity);
    return slots.filter((info) => info.status !== 'empty').sort((a, b) => savedAt(b) - savedAt(a) || a.slot - b.slot);
}

/**
 * @brief Show the New Game / Continue menu and wait for the player's pick.
 *
 * Without a UI listening, the most recent readable save is continued, or a
 * new game is started when there is none.
 *
 * @param slots Every slot (`SaveManager.list()`).
 * @return What the player picked.
 */
export function showLoadMenu(slots: SlotInfo[]): Promise<LoadMenuChoice>
{
    return new Promise((resolve) => {
        if (EventBus.listenerCount(GameEvents.TITLE_LOAD_MENU) === 0)
        {
            const latest = continueSlots(slots).find((info) => info.status === 'ok');
            resolve(latest ? { kind: 'continue', slot: latest.slot } : { kind: 'newGame' });
            return;
        }
        let picked = false;
        EventBus.emit(GameEvents.TITLE_LOAD_MENU, {
            slots,
            pick: (choice) => {
                if (picked) return;
                picked = true;
                resolve(choice);
            },
        } satisfies LoadMenuRequest);
    });
}
