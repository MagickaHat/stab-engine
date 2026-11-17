/**
 * @file SaveManager.ts
 * @brief Writes a `GameState` to a save slot and reads it back.
 *
 * A save file is JSON text: the state's data inside a small envelope that
 * records the format version and when it was saved (see `SaveFile`). Where
 * the text is kept is up to a `SaveStorage`; the default is the browser's
 * `localStorage`, and anything with the same three methods can replace it
 * (a file, IndexedDB behind a cache, a cloud save...).
 *
 * @code
 * const saves = new SaveManager();
 * saves.save(0, state);                       // write slot 0
 * const state = saves.load(0);                // read it back (throws SaveError)
 * for (const info of saves.list()) { ... }    // draw a "Continue" screen
 * @endcode
 *
 * Reading never changes what is stored, so a file this version cannot read is
 * still there for a version that can.
 */
import { z } from 'zod';
import { GameState } from './GameState.ts';
import { describeIssues } from './pokemon.ts';
import { SaveData } from './schema.ts';

/** @brief Format version written by this code. Raise it when `SaveData` changes shape, and add a migration. */
export const SAVE_VERSION = 1;

/** @brief Number of save slots unless `SaveManagerOptions.slots` says otherwise. */
export const DEFAULT_SAVE_SLOTS = 3;

/** @brief Start of every storage key. Slot 0 is stored under `stab-engine:save:0`. */
export const DEFAULT_SAVE_PREFIX = 'stab-engine:save:';

/**
 * @brief Where save files are kept. `localStorage` already has this shape.
 */
export interface SaveStorage
{
    /** @return The text stored under `key`, or `null` if there is none. */
    getItem (key: string): string | null;
    /** Store `value` under `key`, replacing what was there. May throw if there is no room. */
    setItem (key: string, value: string): void;
    /** Forget `key`. */
    removeItem (key: string): void;
}

/** @brief A `SaveStorage` that only lives in memory: for tests, Node tools and previews. */
export class MemoryStorage implements SaveStorage
{
    private readonly items = new Map<string, string>();

    getItem (key: string): string | null
    {
        return this.items.get(key) ?? null;
    }

    setItem (key: string, value: string): void
    {
        this.items.set(key, value);
    }

    removeItem (key: string): void
    {
        this.items.delete(key);
    }
}

/**
 * @brief Why a save could not be read or written.
 *
 * - `empty`: the slot holds nothing.
 * - `corrupt`: the text is not a save file (not JSON, or no envelope).
 * - `newer`: it was written by a later version of the game.
 * - `invalid`: it is a save file, but its data does not match `SaveData`.
 * - `storage`: the storage is missing or refused the write (full, private browsing...).
 */
export type SaveErrorCode = 'empty' | 'corrupt' | 'newer' | 'invalid' | 'storage';

/** @brief The error thrown by `SaveManager`. Check `code` to decide what to tell the player. */
export class SaveError extends Error
{
    readonly code: SaveErrorCode;

    /**
     * @param code What went wrong.
     * @param message Details for the developer.
     */
    constructor (code: SaveErrorCode, message: string)
    {
        super(`[save] ${message}`);
        this.name = 'SaveError';
        this.code = code;
    }
}

/** @brief A save file as stored: the data plus what is needed to read it later. */
export interface SaveFile
{
    /** `SAVE_VERSION` at the time of saving. */
    version: number;
    /** When it was saved, as an ISO 8601 string. */
    savedAt: string;
    data: SaveData;
}

/** @brief The envelope before its data has been checked. */
const Envelope = z.object({
    version: z.number().int().min(1),
    savedAt: z.string(),
    data: z.unknown(),
});

/**
 * @brief Upgrades save data by one version.
 * @param data The data as saved by the older version.
 * @return The same game in the next version's shape.
 */
export type Migration = (data: unknown) => unknown;

/**
 * @brief Upgrades for old save files, by the version they upgrade **from**.
 *
 * When `SaveData` changes shape: raise `SAVE_VERSION` and add a function here
 * that turns the previous version's data into the new shape. A file several
 * versions old goes through each step in turn.
 *
 * @code
 * export const MIGRATIONS: Record<number, Migration> = {
 *     1: (data) => ({ ...(data as object), badges: [] }),   // version 1 → 2
 * };
 * @endcode
 */
export const MIGRATIONS: Record<number, Migration> = {};

/**
 * @brief Read save file text: check the envelope, upgrade old versions, check the data.
 * @param json Text of a save file.
 * @param migrations Upgrades to apply. Default: `MIGRATIONS`.
 * @param version The version to end at. Default: `SAVE_VERSION`.
 * @return The file, with `version` set to the version it was upgraded to.
 * @throws SaveError `corrupt`, `newer` or `invalid`.
 */
export function parseSaveFile (
    json: string, migrations: Record<number, Migration> = MIGRATIONS, version: number = SAVE_VERSION,
): SaveFile
{
    let raw: unknown;
    try
    {
        raw = JSON.parse(json);
    }
    catch
    {
        throw new SaveError('corrupt', 'the save file is not valid JSON');
    }
    const envelope = Envelope.safeParse(raw);
    if (!envelope.success) throw new SaveError('corrupt', 'the save file has no version, date or data');
    if (envelope.data.version > version)
    {
        throw new SaveError('newer', `the save file is version ${envelope.data.version}, but this game reads up to version ${version}`);
    }

    let data = envelope.data.data;
    for (let from = envelope.data.version; from < version; from++)
    {
        const migrate = migrations[from];
        if (!migrate) throw new SaveError('invalid', `no migration from save version ${from} to ${from + 1}`);
        data = migrate(data);
    }
    const result = SaveData.safeParse(data);
    if (!result.success) throw new SaveError('invalid', `the save data is not valid: ${describeIssues(result.error.issues)}`);
    return { version, savedAt: envelope.data.savedAt, data: result.data };
}

/** @brief The few facts about a save that a "Continue" screen shows. */
export interface SaveSummary
{
    slot: number;
    /** When it was saved, as an ISO 8601 string. */
    savedAt: string;
    playerName: string;
    playTimeMs: number;
    /** Map the player is on. */
    map: string;
    /** The party, first Pokémon first. */
    party: { species: string; level: number }[];
}

/** @brief One slot as `SaveManager.list()` reports it. */
export type SlotInfo =
    | { slot: number; status: 'empty' }
    | { slot: number; status: 'ok'; summary: SaveSummary }
    | { slot: number; status: 'error'; error: SaveError };

/** @brief Settings for a `SaveManager`. */
export interface SaveManagerOptions
{
    /** Where to keep the files. Default: the browser's `localStorage`. */
    storage?: SaveStorage;
    /** Number of slots. Default: `DEFAULT_SAVE_SLOTS` (3). */
    slots?: number;
    /** Start of the storage keys. Default: `DEFAULT_SAVE_PREFIX`. Change it to keep two games apart on one site. */
    prefix?: string;
    /** The clock used for `savedAt`. Default: the real time. */
    now?: () => Date;
}

/**
 * @brief Saves and loads games in numbered slots.
 */
export class SaveManager
{
    /** @brief Number of slots; valid slot numbers are 0 to `slots - 1`. */
    readonly slots: number;

    private readonly storage: SaveStorage;
    private readonly prefix: string;
    private readonly now: () => Date;

    /**
     * @param options Storage, slot count and key prefix.
     * @throws SaveError `storage` if no storage was given and there is no `localStorage` (as in Node).
     */
    constructor (options: SaveManagerOptions = {})
    {
        this.storage = options.storage ?? browserStorage();
        this.slots = options.slots ?? DEFAULT_SAVE_SLOTS;
        this.prefix = options.prefix ?? DEFAULT_SAVE_PREFIX;
        this.now = options.now ?? (() => new Date());
    }

    /**
     * @brief Write the game to a slot, replacing what was there.
     * @param slot Slot number, from 0.
     * @param state The game to save.
     * @return A summary of what was written.
     * @throws SaveError `storage` if the storage refuses the write. The slot keeps its old contents.
     */
    save (slot: number, state: GameState): SaveSummary
    {
        const file: SaveFile = { version: SAVE_VERSION, savedAt: this.now().toISOString(), data: state.toJSON() };
        this.write(slot, JSON.stringify(file));
        return summarize(slot, file);
    }

    /**
     * @brief Read a slot into a new `GameState`.
     *
     * Make it the game in progress with `setGameState()` (session.ts).
     * @param slot Slot number, from 0.
     * @return The loaded game.
     * @throws SaveError `empty`, `corrupt`, `newer` or `invalid`.
     */
    load (slot: number): GameState
    {
        return GameState.fromJSON(this.read(slot).data);
    }

    /**
     * @brief Whether a slot holds anything (readable or not).
     * @param slot Slot number, from 0.
     */
    has (slot: number): boolean
    {
        return this.storage.getItem(this.key(slot)) !== null;
    }

    /**
     * @brief Erase a slot.
     * @param slot Slot number, from 0.
     */
    delete (slot: number): void
    {
        this.storage.removeItem(this.key(slot));
    }

    /**
     * @brief Describe every slot, for a save or load screen.
     * @return One entry per slot, in order. A file that cannot be read is reported, not thrown.
     */
    list (): SlotInfo[]
    {
        const infos: SlotInfo[] = [];
        for (let slot = 0; slot < this.slots; slot++)
        {
            try
            {
                infos.push({ slot, status: 'ok', summary: summarize(slot, this.read(slot)) });
            }
            catch (error)
            {
                if (!(error instanceof SaveError)) throw error;
                infos.push(error.code === 'empty' ? { slot, status: 'empty' } : { slot, status: 'error', error });
            }
        }
        return infos;
    }

    /**
     * @brief The text of a slot's save file, to download or copy as a backup.
     * @param slot Slot number, from 0.
     * @return The save file as stored.
     * @throws SaveError `empty` if the slot holds nothing.
     */
    exportSave (slot: number): string
    {
        const json = this.storage.getItem(this.key(slot));
        if (json === null) throw new SaveError('empty', `save slot ${slot} is empty`);
        return json;
    }

    /**
     * @brief Put a save file from `exportSave()` into a slot, replacing what was there.
     *
     * The file is checked first (and upgraded if it is from an older version);
     * a bad file leaves the slot untouched.
     * @param slot Slot number, from 0.
     * @param json Text of a save file.
     * @return A summary of the imported save.
     * @throws SaveError `corrupt`, `newer`, `invalid` or `storage`.
     */
    importSave (slot: number, json: string): SaveSummary
    {
        const file = parseSaveFile(json);
        this.write(slot, JSON.stringify(file));
        return summarize(slot, file);
    }

    /** @brief Storage key of a slot, or an error if the slot does not exist. */
    private key (slot: number): string
    {
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.slots)
        {
            throw new RangeError(`[save] slot ${slot} does not exist (slots are 0 to ${this.slots - 1})`);
        }
        return `${this.prefix}${slot}`;
    }

    /** @brief Read and check a slot. */
    private read (slot: number): SaveFile
    {
        const json = this.storage.getItem(this.key(slot));
        if (json === null) throw new SaveError('empty', `save slot ${slot} is empty`);
        return parseSaveFile(json);
    }

    /** @brief Store text in a slot, turning storage failures into a `SaveError`. */
    private write (slot: number, json: string): void
    {
        const key = this.key(slot);
        try
        {
            this.storage.setItem(key, json);
        }
        catch (error)
        {
            throw new SaveError('storage', `could not write save slot ${slot}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/** @brief The summary of a save file. */
function summarize (slot: number, file: SaveFile): SaveSummary
{
    const { player, party } = file.data;
    return {
        slot,
        savedAt: file.savedAt,
        playerName: player.name,
        playTimeMs: player.playTimeMs,
        map: player.position.map,
        party: party.map(({ species, level }) => ({ species, level })),
    };
}

/** @brief The browser's `localStorage`, or a `SaveError` where there is none. */
function browserStorage (): SaveStorage
{
    try
    {
        //  Reading the property itself can throw (cookies blocked, sandboxed frame).
        const storage = (globalThis as { localStorage?: SaveStorage }).localStorage;
        if (storage) return storage;
    }
    catch
    {
        //  Reported below.
    }
    throw new SaveError('storage', 'localStorage is not available here; pass { storage } to SaveManager');
}
