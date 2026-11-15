/**
 * @file DialogueEngine.ts
 * @brief Runs an ink story (dialogue, cutscenes, NPC scripts) using inkjs.
 *
 * ink is inkle's narrative scripting language. Stories are written in `.ink`
 * files, compiled to JSON by the Vite plugin in vite/plugins/ink.mjs, and run
 * here with the inkjs runtime. `DialogueEngine` is independent of Phaser: it
 * produces lines and choices through callbacks and your code decides how to
 * show them.
 *
 * @code
 * import story from '../../content/dialogue/sample.ink';
 *
 * const dialogue = new DialogueEngine(story);
 * dialogue.onLine = (line) => console.log(`${line.tagMap.speaker ?? ''}: ${line.text}`);
 * dialogue.onChoices = (choices) => { dialogue.choose(choices[0].index); dialogue.run(); };
 * dialogue.onEnd = () => console.log('The end');
 * dialogue.run();
 * @endcode
 */
import { Story } from 'inkjs';
import { parseTags } from './tags';
import type {
    DialogueChoice, DialogueEngineOptions, DialogueLine, InkValue, StoryJson, TagMap, VariableObserver,
} from './types';

/** @brief inkjs `ErrorType.Warning` (the enum lives in a module we don't want to bundle). */
const INK_WARNING = 1;
/** @brief inkjs `ErrorType.Author` (`TODO:` notes left in the ink source). */
const INK_AUTHOR = 0;

/**
 * @brief Wraps an inkjs `Story` and exposes a simple line/choice API.
 *
 * Two ways to drive it:
 * - **Step by step** (typical dialogue box): call `advance()` each time the
 *   player presses a button. It reports one line through `onLine`, or, when
 *   there are no more lines, the choices through `onChoices` or the end
 *   through `onEnd`.
 * - **In bulk**: `run()` reports every line up to the next choice (or the
 *   end) in one go.
 *
 * After the player picks an option, call `choose(index)` and then
 * `advance()` / `run()` again.
 */
export class DialogueEngine
{
    /** @brief Called for each line of text produced by `advance()` / `run()`. */
    onLine: ((line: DialogueLine) => void) | null = null;

    /** @brief Called when the story stops at a choice. */
    onChoices: ((choices: DialogueChoice[]) => void) | null = null;

    /** @brief Called once when the story has no more content and no choices. */
    onEnd: (() => void) | null = null;

    /** @brief The underlying inkjs story, for anything this wrapper doesn't cover. */
    readonly story: Story;

    /** @brief Options passed to the constructor. */
    private readonly options: DialogueEngineOptions;

    /** @brief Set once `onEnd` has fired, so it only fires once per ending. */
    private endReported = false;

    /**
     * @brief Loads a compiled story.
     * @param json Compiled story (imported `.ink` file, or ink JSON object/string).
     * @param options See `DialogueEngineOptions`.
     */
    constructor (json: StoryJson, options: DialogueEngineOptions = {})
    {
        this.options = options;
        this.story = typeof json === 'string' ? new Story(json) : new Story(json);
        this.story.allowExternalFunctionFallbacks = options.externalFallbacks ?? true;
        this.story.onError = (message, type) => this.handleError(message, type as number);
    }

    // ------------------------------------------------------------------
    // Flow
    // ------------------------------------------------------------------

    /** @brief `true` if there is another line to read with `continue()`. */
    get canContinue (): boolean
    {
        return this.story.canContinue;
    }

    /** @brief The choices currently available (empty while lines remain). */
    get choices (): DialogueChoice[]
    {
        return this.story.currentChoices.map((c) => ({
            index: c.index,
            text: c.text,
            tags: c.tags ?? [],
            tagMap: parseTags(c.tags),
        }));
    }

    /** @brief `true` when the story has no more lines and no choices. */
    get isEnded (): boolean
    {
        return !this.story.canContinue && this.story.currentChoices.length === 0;
    }

    /** @brief Tags at the very top of the main ink file (title, author...). */
    get globalTags (): TagMap
    {
        return parseTags(this.story.globalTags);
    }

    /**
     * @brief Reads the next line without firing any callback.
     *
     * Lines with no text (for example a line holding only `# tags`, such as
     * the global tags at the top of a file) are not returned on their own:
     * their tags are added to the next line that has text.
     *
     * @return The line, or `null` if the story can't continue
     *         (it is waiting for a choice or has ended).
     */
    continue (): DialogueLine | null
    {
        if (!this.story.canContinue) return null;
        const tags: string[] = [];
        let text = '';
        while (this.story.canContinue)
        {
            text = (this.story.Continue() ?? '').replace(/\n$/, '');
            tags.push(...(this.story.currentTags ?? []));
            if (text.trim().length > 0) break;
        }
        // Only tag-only lines were left before a choice or the end.
        if (text.trim().length === 0 && tags.length === 0) return null;

        const line: DialogueLine = { text, tags, tagMap: parseTags(tags) };
        if (this.options.debug) console.log('[dialogue]', text, tags.length ? tags : '');
        return line;
    }

    /**
     * @brief Reads every line up to the next choice or the end, without firing callbacks.
     * @return The lines read (possibly empty).
     */
    continueMaximally (): DialogueLine[]
    {
        const lines: DialogueLine[] = [];
        for (let line = this.continue(); line !== null; line = this.continue()) lines.push(line);
        return lines;
    }

    /**
     * @brief Moves the story one step and reports it through the callbacks.
     *
     * Fires `onLine` if a line was read. Otherwise fires `onChoices` if the
     * story is waiting for a choice, or `onEnd` (once) if it has ended.
     *
     * @return The line that was read, or `null` if none was.
     */
    advance (): DialogueLine | null
    {
        const line = this.continue();
        if (line !== null)
        {
            this.onLine?.(line);
            return line;
        }

        const choices = this.choices;
        if (choices.length > 0)
        {
            if (this.options.debug) console.log('[dialogue] choices:', choices.map((c) => c.text));
            this.onChoices?.(choices);
        }
        else if (!this.endReported)
        {
            this.endReported = true;
            if (this.options.debug) console.log('[dialogue] end');
            this.onEnd?.();
        }
        return null;
    }

    /**
     * @brief Reports every line up to the next choice (`onLine` for each),
     *        then the choices (`onChoices`) or the end (`onEnd`).
     * @return The lines that were read.
     */
    run (): DialogueLine[]
    {
        const lines: DialogueLine[] = [];
        for (let line = this.advance(); line !== null; line = this.advance()) lines.push(line);
        return lines;
    }

    /**
     * @brief Picks one of the current choices. Call `advance()` / `run()` afterwards.
     * @param index `DialogueChoice.index` of the chosen option.
     */
    choose (index: number): void
    {
        const choices = this.story.currentChoices;
        if (index < 0 || index >= choices.length)
        {
            throw new RangeError(`Choice ${index} is out of range (${choices.length} choices available).`);
        }
        if (this.options.debug) console.log('[dialogue] chose:', choices[index].text);
        this.story.ChooseChoiceIndex(index);
    }

    /**
     * @brief Jumps to a knot or stitch, e.g. `"oak_lab"` or `"oak_lab.after_battle"`.
     *
     * Use this to start a specific conversation from a story file that holds
     * several (one knot per NPC, for example).
     *
     * @param path Knot or `knot.stitch` path.
     * @param args Arguments, if the knot takes parameters.
     * @throws inkjs `StoryException` if the path doesn't exist.
     */
    goTo (path: string, ...args: InkValue[]): void
    {
        this.story.ChoosePathString(path, true, args);
        this.endReported = false;
    }

    /**
     * @brief Restarts the story from the beginning, resetting all variables.
     */
    reset (): void
    {
        this.story.ResetState();
        this.endReported = false;
    }

    // ------------------------------------------------------------------
    // Variables and functions
    // ------------------------------------------------------------------

    /**
     * @brief Reads a global ink variable (`VAR name = ...`).
     * @param name Variable name.
     * @return Its value, or `null`/`undefined` if it doesn't exist.
     */
    getVariable<T extends InkValue = InkValue> (name: string): T
    {
        return this.story.variablesState.$(name) as T;
    }

    /**
     * @brief Sets a global ink variable. It must already be declared with `VAR`.
     * @param name Variable name.
     * @param value New value.
     */
    setVariable (name: string, value: InkValue): void
    {
        this.story.variablesState.$(name, value);
    }

    /**
     * @brief Calls `observer` whenever the story changes a global variable.
     * @param name Variable name.
     * @param observer Called with the variable name and its new value.
     * @return A function that removes the observer.
     */
    observeVariable (name: string, observer: VariableObserver): () => void
    {
        const wrapped = (varName: string, value: unknown) => observer(varName, value as InkValue);
        this.story.ObserveVariable(name, wrapped);
        return () => this.story.RemoveVariableObserver(wrapped, name);
    }

    /**
     * @brief Implements an ink `EXTERNAL` function in TypeScript.
     *
     * Bind every external before the first `continue()` / `advance()` / `run()`:
     * inkjs checks all bindings then (unless the ink file provides a fallback
     * function and `externalFallbacks` is on).
     *
     * @code
     * // ink:  EXTERNAL give_item(item, amount)
     * dialogue.bindFunction('give_item', (item: string, amount: number) => bag.add(item, amount));
     * @endcode
     *
     * @param name Name of the `EXTERNAL` declared in ink.
     * @param fn Implementation. Its return value is passed back to ink.
     * @param lookaheadSafe `true` if `fn` has no side effects (ink may call it
     *        early while looking ahead). Default `false`, which is always safe.
     */
    bindFunction (name: string, fn: (...args: any[]) => InkValue | void, lookaheadSafe = false): void
    {
        this.story.BindExternalFunction(name, fn, lookaheadSafe);
    }

    /**
     * @brief Removes a function bound with `bindFunction()`.
     * @param name Name of the `EXTERNAL`.
     */
    unbindFunction (name: string): void
    {
        this.story.UnbindExternalFunction(name);
    }

    /**
     * @brief Calls an ink function (`=== function name(...) ===`) from TypeScript.
     * @param name Function name.
     * @param args Arguments.
     * @return What the function returned.
     */
    callFunction<T extends InkValue = InkValue> (name: string, ...args: InkValue[]): T
    {
        return this.story.EvaluateFunction(name, args) as T;
    }

    /**
     * @brief Number of times a knot or stitch has been visited.
     * @param path Knot or `knot.stitch` path.
     * @return The visit count (0 if never visited).
     */
    visitCount (path: string): number
    {
        return this.story.state.VisitCountAtPathString(path) ?? 0;
    }

    /**
     * @brief Tags at the start of a knot or stitch, without running it.
     * @param path Knot or `knot.stitch` path.
     * @return The parsed tags.
     */
    tagsForPath (path: string): TagMap
    {
        return parseTags(this.story.TagsForContentAtPath(path));
    }

    // ------------------------------------------------------------------
    // Saving
    // ------------------------------------------------------------------

    /**
     * @brief Serializes the story state (position, variables, visit counts).
     * @return A JSON string to store in the save file.
     */
    save (): string
    {
        return this.story.state.ToJson();
    }

    /**
     * @brief Restores a state produced by `save()` on the same story.
     * @param json Saved state.
     */
    load (json: string): void
    {
        this.story.state.LoadJson(json);
        this.endReported = false;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * @brief Routes inkjs runtime errors to `options.onError` (or throws / warns).
     * @param message Error message from inkjs.
     * @param type inkjs `ErrorType` value.
     */
    private handleError (message: string, type: number): void
    {
        const isWarning = type === INK_WARNING || type === INK_AUTHOR;
        if (this.options.onError)
        {
            this.options.onError(message, isWarning);
        }
        else if (isWarning)
        {
            console.warn(`[dialogue] ${message}`);
        }
        else
        {
            throw new Error(`[dialogue] ${message}`);
        }
    }
}
