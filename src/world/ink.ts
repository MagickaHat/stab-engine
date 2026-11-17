/**
 * @file ink.ts
 * @brief Runs an ink story from an event (`{ "cmd": "ink", "story": ..., "knot": ... }`).
 *
 * Lines go to the same message box as event messages, choices to the same
 * choice box. A line's `# speaker: name` tag names the speaker. The story's
 * state is kept in the save (`GameState.setDialogueState()`), so visit counts
 * and ink variables persist.
 *
 * These ink functions are bound to the game, so declare the ones a story
 * uses as `EXTERNAL`:
 *
 * | Function                 | Does                                   |
 * |--------------------------|----------------------------------------|
 * | `get_flag(name)`         | Read a flag.                           |
 * | `set_flag(name, value)`  | Set a flag.                            |
 * | `get_var(name)`          | Read a variable (0 if unset).          |
 * | `set_var(name, value)`   | Set a variable.                        |
 * | `give_item(item, n)`     | Give items; returns whether they fit.  |
 * | `player_name()`          | The player's name.                     |
 */
import { DialogueEngine } from '../dialogue';
import type { GameState } from '../state';

const STORIES = import.meta.glob<Record<string, unknown>>('../../content/dialogue/*.ink', { import: 'default' });

/** @brief What a story needs from the game. */
export interface InkDependencies
{
    state: GameState;
    message: (text: string, speaker?: string) => Promise<void>;
    choose: (prompt: string | null, options: string[], cancel: number) => Promise<number>;
    giveItem: (item: string, quantity: number) => boolean;
}

/**
 * @brief Run a story (or one knot) to its end.
 * @param story File name in content/dialogue, without `.ink`.
 * @param knot Knot (or `knot.stitch`) to start at. Default: the start of the story.
 * @param deps The game.
 * @throws Error if the story does not exist.
 */
export async function runInk (story: string, knot: string | undefined, deps: InkDependencies): Promise<void>
{
    const load = STORIES[`../../content/dialogue/${story}.ink`];
    if (!load) throw new Error(`ink story "${story}" not found in content/dialogue`);
    const engine = new DialogueEngine(await load());
    const { state } = deps;
    const saved = state.getDialogueState(story);
    if (saved) engine.load(saved);

    const bind = (name: string, fn: (...args: never[]) => string | number | boolean | void) =>
    {
        try
        {
            engine.bindFunction(name, fn as (...args: unknown[]) => string | number | boolean | void);
        }
        catch
        {
            //  Already bound, or not declared by this story: nothing to do.
        }
    };
    bind('get_flag', (name: string) => state.getFlag(name));
    bind('set_flag', (name: string, value: boolean) => state.setFlag(name, value ?? true));
    bind('get_var', (name: string) => state.getVar(name) ?? 0);
    bind('set_var', (name: string, value: number | string) => state.setVar(name, value));
    bind('give_item', (item: string, amount: number) => deps.giveItem(item, amount ?? 1));
    bind('player_name', () => state.getSnapshot().player.name);

    if (knot) engine.goTo(knot);
    for (;;)
    {
        const line = engine.continue();
        if (line)
        {
            if (line.text.trim()) await deps.message(line.text, typeof line.tagMap.speaker === 'string' ? line.tagMap.speaker : undefined);
            continue;
        }
        const choices = engine.choices;
        if (!choices.length) break;
        const picked = await deps.choose(null, choices.map((choice) => choice.text), -1);
        engine.choose(choices[Math.max(0, Math.min(picked, choices.length - 1))].index);
    }
    state.setDialogueState(story, engine.save());
}
