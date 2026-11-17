/**
 * @file variables.ts
 * @brief Every variable the game uses, with what it means.
 *
 * Variables hold numbers or text in `SaveData.variables` (see src/state).
 * As with flags.ts, listing them here lets the validator catch typos and
 * lets Tiled offer them in a drop-down list.
 */
export const VARIABLES = {
    badges: 'Number of Gym Badges.',
    rival_name: "The rival's name.",
    starter_choice: 'Species ID of the starter the player picked.',
    battle_result: 'Result of the last battle: win, lose, draw, flee or caught. Set by the engine.',
    choice_result: 'Index of the option picked in the last choice, from 0 (-1 for cancel). Set by the engine.',
} as const satisfies Record<string, string>;

/** @brief A variable name from the registry. */
export type VariableName = keyof typeof VARIABLES;

/** @brief Variable the engine writes each battle's result to. */
export const BATTLE_RESULT_VAR = 'battle_result';

/** @brief Variable the engine writes each choice's result to. */
export const CHOICE_RESULT_VAR = 'choice_result';
