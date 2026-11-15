/**
 * @file types.ts
 * @brief Shared types of the dialogue system.
 */
import type { InkList } from 'inkjs';

/**
 * @brief Compiled ink story, as produced by importing an `.ink` file
 *        (see vite/plugins/ink.mjs) or exported from Inky/inklecate.
 *
 * Either the parsed JSON object or the raw JSON string is accepted.
 */
export type StoryJson = Record<string, unknown> | string;

/** @brief A value an ink variable can hold. */
export type InkValue = boolean | string | number | InkList | null;

/**
 * @brief Tags parsed into a key/value map.
 *
 * `# speaker: Oak` becomes `{ speaker: 'Oak' }`; a tag without a colon,
 * such as `# shake`, becomes `{ shake: true }`.
 */
export type TagMap = Record<string, string | true>;

/** @brief One line of story text. */
export interface DialogueLine {
    /** Text of the line, without the trailing newline. */
    text: string;
    /** Raw tags on this line, in order (e.g. `["speaker: Oak", "shake"]`). */
    tags: string[];
    /** The same tags parsed by `parseTags()`. */
    tagMap: TagMap;
}

/** @brief A choice the player can pick. */
export interface DialogueChoice {
    /** Index to pass to `DialogueEngine.choose()`. */
    index: number;
    /** Text of the choice. */
    text: string;
    /** Raw tags on the choice. */
    tags: string[];
    /** The same tags parsed by `parseTags()`. */
    tagMap: TagMap;
}

/** @brief Options for creating a `DialogueEngine`. */
export interface DialogueEngineOptions {
    /** Print every line, choice and choice made to the console. */
    debug?: boolean;
    /**
     * When an `EXTERNAL` function has no TypeScript binding, run the ink
     * function of the same name instead (as Inky does). Default `true`.
     * Set to `false` to get an error for every unbound external.
     */
    externalFallbacks?: boolean;
    /**
     * Called for runtime errors and warnings raised by the story
     * (e.g. a missing external function or an out-of-range choice).
     * Default: errors throw, warnings are printed with `console.warn`.
     */
    onError?: (message: string, isWarning: boolean) => void;
}

/**
 * @brief An ink variable observer.
 * @param name Name of the variable that changed.
 * @param value Its new value.
 */
export type VariableObserver = (name: string, value: InkValue) => void;
