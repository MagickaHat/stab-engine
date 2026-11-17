/**
 * @file GameState.ts
 * @brief The game in progress: party, PC, bag, flags, variables and the player.
 *
 * `GameState` holds one `SaveData` (see schema.ts) and is the only thing that
 * changes it. It does not import Phaser or React, so scenes, UI components and
 * Node tests all use the same object:
 *
 * @code
 *  scenes ──┐                         ┌──▶ subscribers (React, via useGameState())
 *  UI ──────┼─ addItem(), setFlag() ─▶ GameState ── toJSON() ──▶ SaveManager ──▶ storage
 *  dialogue ┘                         └──◀ fromJSON() ◀───────────┘
 * @endcode
 *
 * The data is never modified in place. Every change replaces it with a new
 * object (parts that did not change are shared), which is what lets React
 * compare snapshots cheaply. Treat what `getSnapshot()` returns as read-only.
 *
 * @code
 * const state = GameState.create({ name: 'Red' });
 * state.addToParty(createPokemon({ species: 'pikachu', level: 5, ability: 'static', moves: ['thundershock'] }));
 * state.addItem('potion', 3, 'medicine');
 * state.setFlag('got_starter');
 * state.setPosition({ map: 'pallettown', x: 5, y: 7, facing: 'down' });
 * @endcode
 */
import { ID } from '../data/schemas/common.ts';
import { ItemPocket } from '../data/schemas/engine.ts';
import { describeIssues, healed } from './pokemon.ts';
import {
    DEFAULT_BOX_COUNT, DEFAULT_BOX_SIZE, MAX_ITEM_QUANTITY, MAX_MONEY, MAX_MOVES, PARTY_SIZE, SaveData,
} from './schema.ts';
import { eventKey, selfSwitchKey } from './schema.ts';
import type { Bag, PcBox, PcLocation, Position, SavedPokemon, SelfSwitch, VariableValue } from './schema.ts';

/** @brief Settings for a new game. */
export interface NewGameOptions
{
    /** Player name. Default: `"Player"`. */
    name?: string;
    /** Trainer ID. Default: a random number from 0 to 65535. */
    trainerId?: number;
    /** Starting money. Default: 0. */
    money?: number;
    /** Where the player starts. Default: tile (0, 0) of map `""`, facing down. */
    position?: Position;
    /** Number of PC boxes. Default: `DEFAULT_BOX_COUNT` (30). */
    boxCount?: number;
    /** Pokémon per PC box. Default: `DEFAULT_BOX_SIZE` (30). */
    boxSize?: number;
}

/** @brief Where a Pokémon is: in the party or in the PC. */
export type PokemonLocation =
    | { where: 'party'; index: number }
    | { where: 'pc'; box: number; slot: number };

/**
 * @brief The game in progress.
 *
 * Make one with `GameState.create()` (new game) or `GameState.fromJSON()`
 * (loaded game). `subscribe()` and `getSnapshot()` have the shape React's
 * `useSyncExternalStore` expects.
 */
export class GameState
{
    private data: SaveData;
    private readonly listeners = new Set<() => void>();

    /**
     * @brief Wraps data that is already known to be valid. Use `create()` or `fromJSON()` instead.
     * @param data The data. The state takes ownership of it.
     */
    private constructor (data: SaveData)
    {
        this.data = data;
    }

    /**
     * @brief Start a new game: empty party, PC and bag, no flags.
     * @param options Player name, PC size and so on.
     * @return The new state.
     * @throws Error if an option is not allowed (for example `boxCount: 0`).
     */
    static create (options: NewGameOptions = {}): GameState
    {
        const boxCount = options.boxCount ?? DEFAULT_BOX_COUNT;
        const boxSize = options.boxSize ?? DEFAULT_BOX_SIZE;
        const boxes: PcBox[] = [];
        for (let i = 0; i < boxCount; i++)
        {
            boxes.push({ name: `Box ${i + 1}`, slots: new Array<null>(boxSize).fill(null) });
        }
        const bag = {} as Bag;
        for (const pocket of ItemPocket.options) bag[pocket] = [];

        return GameState.fromJSON({
            player: {
                name: options.name ?? 'Player',
                trainerId: options.trainerId ?? Math.floor(Math.random() * 65536),
                money: options.money ?? 0,
                playTimeMs: 0,
                position: options.position ?? { map: '', x: 0, y: 0, facing: 'down' },
            },
            party: [],
            pc: { current: 0, boxes },
            bag,
            flags: {},
            variables: {},
            dialogue: {},
            selfSwitches: {},
            hiddenEvents: {},
            story: {},
        });
    }

    /**
     * @brief Rebuild a state from data made by `toJSON()`.
     * @param data The data, for example from a save file. It is checked and copied.
     * @return The state.
     * @throws Error listing what is wrong if the data does not match `SaveData`.
     */
    static fromJSON (data: unknown): GameState
    {
        const result = SaveData.safeParse(data);
        if (!result.success) throw new Error(`[state] invalid save data: ${describeIssues(result.error.issues)}`);
        return new GameState(result.data);
    }

    /**
     * @brief The whole state as plain data, ready for `JSON.stringify()`.
     * @return A deep copy; changing it does not change the state.
     */
    toJSON (): SaveData
    {
        return structuredClone(this.data);
    }

    /**
     * @brief Be told whenever anything changes.
     * @param listener Called with no arguments; read `getSnapshot()` inside it.
     * @return A function that removes the listener.
     */
    subscribe = (listener: () => void): (() => void) =>
    {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /**
     * @brief The state right now. Read-only: use the methods below to change it.
     * @return The current data. The same object is returned until something changes.
     */
    getSnapshot = (): SaveData => this.data;

    // ---------------------------------------------------------------- Party

    /**
     * @brief Give the player a Pokémon. It goes to the PC if the party is full.
     *
     * A Pokémon without an original trainer (`ot.name` is empty, the default
     * of `createPokemon()`) becomes the player's own. One that already has
     * another trainer keeps it and counts as traded (see `isTraded()`).
     *
     * @param pokemon The Pokémon (see `createPokemon()`).
     * @return Where it went, or `null` if the party and every box are full.
     * @throws Error if a Pokémon with the same `uid` is already owned.
     */
    addToParty (pokemon: SavedPokemon): PokemonLocation | null
    {
        if (this.findPokemon(pokemon.uid)) throw new Error(`[state] a Pokémon with uid "${pokemon.uid}" is already owned`);
        if (!pokemon.ot.name)
        {
            const { name, trainerId } = this.data.player;
            pokemon = { ...pokemon, ot: { name, id: trainerId } };
        }
        if (this.data.party.length < PARTY_SIZE)
        {
            this.set({ party: [...this.data.party, pokemon] });
            return { where: 'party', index: this.data.party.length - 1 };
        }
        const free = this.findFreeSlot(this.data.pc.current);
        if (!free) return null;
        this.putInBox(free, pokemon);
        return { where: 'pc', ...free };
    }

    /**
     * @brief Take a Pokémon out of the party for good (released, traded away...).
     * @param index Party position, from 0.
     * @return The Pokémon that was removed.
     * @throws Error if there is no Pokémon at `index`.
     */
    removeFromParty (index: number): SavedPokemon
    {
        const pokemon = this.partyMember(index);
        this.set({ party: this.data.party.filter((_, i) => i !== index) });
        return pokemon;
    }

    /**
     * @brief Exchange two party positions.
     * @param a Party position, from 0.
     * @param b The other party position.
     * @throws Error if either position is empty.
     */
    swapParty (a: number, b: number): void
    {
        const first = this.partyMember(a);
        const second = this.partyMember(b);
        if (a === b) return;
        const party = [...this.data.party];
        party[a] = second;
        party[b] = first;
        this.set({ party });
    }

    /**
     * @brief Restore the whole party to full HP and PP and cure every status condition.
     */
    healParty (): void
    {
        this.set({ party: this.data.party.map(healed) });
    }

    /**
     * @brief Find a Pokémon in the party or the PC.
     * @param uid Its `uid`.
     * @return The Pokémon and where it is, or `null` if it is not owned.
     */
    findPokemon (uid: string): { pokemon: SavedPokemon; location: PokemonLocation } | null
    {
        const index = this.data.party.findIndex((pokemon) => pokemon.uid === uid);
        if (index >= 0) return { pokemon: this.data.party[index], location: { where: 'party', index } };
        for (const [box, { slots }] of this.data.pc.boxes.entries())
        {
            const slot = slots.findIndex((pokemon) => pokemon?.uid === uid);
            if (slot >= 0) return { pokemon: slots[slot]!, location: { where: 'pc', box, slot } };
        }
        return null;
    }

    /**
     * @brief Change a Pokémon, wherever it is.
     *
     * Pass a function to remove optional fields:
     * @code
     * state.updatePokemon(uid, { level: 16, species: 'ivysaur' });
     * state.updatePokemon(uid, ({ status, ...rest }) => rest);   // cure its status
     * @endcode
     *
     * @param uid Its `uid`.
     * @param change Fields to overwrite, or a function that returns the new Pokémon.
     * @return `false` if no Pokémon with that `uid` is owned.
     */
    updatePokemon (uid: string, change: Partial<SavedPokemon> | ((pokemon: SavedPokemon) => SavedPokemon)): boolean
    {
        const found = this.findPokemon(uid);
        if (!found) return false;
        const next = typeof change === 'function' ? change(found.pokemon) : { ...found.pokemon, ...change };
        const updated = { ...next, uid };
        if (found.location.where === 'party')
        {
            const party = [...this.data.party];
            party[found.location.index] = updated;
            this.set({ party });
        }
        else
        {
            this.putInBox(found.location, updated);
        }
        return true;
    }

    /**
     * @brief Whether a Pokémon came from another trainer. Traded Pokémon gain more experience.
     * @param pokemon The Pokémon.
     * @return `true` if its original trainer's ID is not the player's.
     */
    isTraded (pokemon: SavedPokemon): boolean
    {
        return pokemon.ot.id !== this.data.player.trainerId;
    }

    // ---------------------------------------------------------------- Moves

    /**
     * @brief Teach a Pokémon a move (level-up, TM, evolution...).
     *
     * The move is ready to use if the Pokémon has a free move slot; otherwise
     * it goes to its move bank, from where `relearnMove()` can swap it in.
     *
     * @param uid The Pokémon's `uid`.
     * @param move Move ID.
     * @return `'moves'` or `'bank'` for where the move went; `null` if it already had the
     *         move or no Pokémon with that `uid` is owned.
     */
    learnMove (uid: string, move: string): 'moves' | 'bank' | null
    {
        const pokemon = this.findPokemon(uid)?.pokemon;
        if (!pokemon || pokemon.moves.some((entry) => entry.id === move) || pokemon.moveBank.includes(move)) return null;
        if (pokemon.moves.length < MAX_MOVES)
        {
            this.updatePokemon(uid, { moves: [...pokemon.moves, { id: move, ppUps: 0 }] });
            return 'moves';
        }
        this.updatePokemon(uid, { moveBank: [...pokemon.moveBank, move] });
        return 'bank';
    }

    /**
     * @brief Move one of a Pokémon's ready moves to its move bank.
     * @param uid The Pokémon's `uid`.
     * @param move ID of a move it has ready.
     * @return `false`, changing nothing, if it does not have the move ready or it is its only move.
     */
    forgetMove (uid: string, move: string): boolean
    {
        const pokemon = this.findPokemon(uid)?.pokemon;
        if (!pokemon || pokemon.moves.length < 2 || !pokemon.moves.some((entry) => entry.id === move)) return false;
        return this.updatePokemon(uid, {
            moves: pokemon.moves.filter((entry) => entry.id !== move),
            moveBank: [...pokemon.moveBank, move],
        });
    }

    /**
     * @brief Take a move out of a Pokémon's move bank and make it ready again, with full PP.
     * @param uid The Pokémon's `uid`.
     * @param move ID of a move in its move bank.
     * @param replace ID of the ready move to put in the bank in exchange. Needed when all
     *                `MAX_MOVES` slots are taken; the new move takes that slot.
     * @return `false`, changing nothing, if the move is not in the bank, `replace` is not a
     *         ready move, or the slots are full and `replace` was left out.
     */
    relearnMove (uid: string, move: string, replace?: string): boolean
    {
        const pokemon = this.findPokemon(uid)?.pokemon;
        if (!pokemon || !pokemon.moveBank.includes(move)) return false;
        const bank = pokemon.moveBank.filter((id) => id !== move);
        if (replace === undefined)
        {
            if (pokemon.moves.length >= MAX_MOVES) return false;
            return this.updatePokemon(uid, { moves: [...pokemon.moves, { id: move, ppUps: 0 }], moveBank: bank });
        }
        if (!pokemon.moves.some((entry) => entry.id === replace)) return false;
        return this.updatePokemon(uid, {
            moves: pokemon.moves.map((entry) => (entry.id === replace ? { id: move, ppUps: 0 } : entry)),
            moveBank: [...bank, replace],
        });
    }

    // ------------------------------------------------------------------- PC

    /**
     * @brief Move a party Pokémon into the PC.
     *
     * The state does not stop you from depositing the last Pokémon; check that
     * in the PC screen if your game forbids it.
     *
     * @param index Party position, from 0.
     * @param target Slot to put it in. Left out: the first free slot, looking from the current box onwards.
     * @return Where it went, or `null` if `target` is taken or the PC is full.
     * @throws Error if there is no Pokémon at `index`, or `target` does not exist.
     */
    deposit (index: number, target?: PcLocation): PcLocation | null
    {
        const pokemon = this.partyMember(index);
        const slot = target ?? this.findFreeSlot(this.data.pc.current);
        if (!slot || this.boxSlot(slot)) return null;
        this.set({ party: this.data.party.filter((_, i) => i !== index) });
        this.putInBox(slot, pokemon);
        return slot;
    }

    /**
     * @brief Move a Pokémon from the PC to the end of the party.
     * @param from The slot to take it from.
     * @return `false` if the slot is empty or the party is full.
     * @throws Error if the slot does not exist.
     */
    withdraw (from: PcLocation): boolean
    {
        const pokemon = this.boxSlot(from);
        if (!pokemon || this.data.party.length >= PARTY_SIZE) return false;
        this.putInBox(from, null);
        this.set({ party: [...this.data.party, pokemon] });
        return true;
    }

    /**
     * @brief Move a Pokémon inside the PC. If the destination is taken, the two swap places.
     * @param from The slot to move from.
     * @param to The slot to move to.
     * @throws Error if either slot does not exist.
     */
    movePokemon (from: PcLocation, to: PcLocation): void
    {
        const moved = this.boxSlot(from);
        const other = this.boxSlot(to);
        if (from.box === to.box && from.slot === to.slot) return;
        this.putInBox(from, other);
        this.putInBox(to, moved);
    }

    /**
     * @brief Take a Pokémon out of the PC for good (released).
     * @param from The slot to empty.
     * @return The Pokémon that was removed, or `null` if the slot was empty.
     * @throws Error if the slot does not exist.
     */
    removeFromPc (from: PcLocation): SavedPokemon | null
    {
        const pokemon = this.boxSlot(from);
        if (pokemon) this.putInBox(from, null);
        return pokemon;
    }

    /**
     * @brief Rename a PC box.
     * @param box Box number, from 0.
     * @param name The new name.
     * @throws Error if the box does not exist.
     */
    renameBox (box: number, name: string): void
    {
        this.boxAt(box);
        const boxes = [...this.data.pc.boxes];
        boxes[box] = { ...boxes[box], name };
        this.set({ pc: { ...this.data.pc, boxes } });
    }

    /**
     * @brief Remember which box is open.
     * @param box Box number, from 0.
     * @throws Error if the box does not exist.
     */
    setCurrentBox (box: number): void
    {
        this.boxAt(box);
        this.set({ pc: { ...this.data.pc, current: box } });
    }

    // ------------------------------------------------------------------ Bag

    /**
     * @brief Put items in the bag.
     * @param item Item ID, e.g. `potion`.
     * @param quantity How many. Default: 1.
     * @param pocket The pocket for an item the bag does not hold yet (`ItemInfo.pocket`
     *               in the item data). Ignored if the bag already holds the item.
     * @return `false`, changing nothing, if the bag would hold more than `MAX_ITEM_QUANTITY` of it.
     * @throws Error if `quantity` is not a positive whole number, `item` is not an ID, or the
     *               item is new and no pocket was given.
     */
    addItem (item: string, quantity = 1, pocket?: ItemPocket): boolean
    {
        assertCount(quantity, 'addItem');
        if (!ID.safeParse(item).success) throw new Error(`[state] addItem: "${item}" is not an item ID (use toID())`);
        const held = this.findItem(item);
        const target = held?.pocket ?? pocket;
        if (!target) throw new Error(`[state] addItem: "${item}" is not in the bag yet, so its pocket is needed`);
        const total = (held?.quantity ?? 0) + quantity;
        if (total > MAX_ITEM_QUANTITY) return false;

        const stacks = held
            ? this.data.bag[target].map((stack) => (stack.item === item ? { item, quantity: total } : stack))
            : [...this.data.bag[target], { item, quantity: total }];
        this.set({ bag: { ...this.data.bag, [target]: stacks } });
        return true;
    }

    /**
     * @brief Take items out of the bag.
     * @param item Item ID.
     * @param quantity How many. Default: 1.
     * @return `false`, changing nothing, if the bag holds fewer than `quantity`.
     * @throws Error if `quantity` is not a positive whole number.
     */
    removeItem (item: string, quantity = 1): boolean
    {
        assertCount(quantity, 'removeItem');
        const held = this.findItem(item);
        if (!held || held.quantity < quantity) return false;
        const left = held.quantity - quantity;
        const stacks = left
            ? this.data.bag[held.pocket].map((stack) => (stack.item === item ? { item, quantity: left } : stack))
            : this.data.bag[held.pocket].filter((stack) => stack.item !== item);
        this.set({ bag: { ...this.data.bag, [held.pocket]: stacks } });
        return true;
    }

    /**
     * @brief How many of an item the bag holds.
     * @param item Item ID.
     * @return The quantity; 0 if there is none.
     */
    countItem (item: string): number
    {
        return this.findItem(item)?.quantity ?? 0;
    }

    // ---------------------------------------------------- Flags and variables

    /**
     * @brief Read a flag.
     * @param name The flag's name.
     * @return Its value; `false` if it was never set.
     */
    getFlag (name: string): boolean
    {
        return this.data.flags[name] ?? false;
    }

    /**
     * @brief Set or clear a flag.
     * @param name The flag's name.
     * @param value Default: `true`.
     */
    setFlag (name: string, value = true): void
    {
        if (this.data.flags[name] === value) return;
        this.set({ flags: { ...this.data.flags, [name]: value } });
    }

    /**
     * @brief Read a variable.
     * @param name The variable's name.
     * @return Its value, or `undefined` if it was never set.
     */
    getVar (name: string): VariableValue | undefined
    {
        return this.data.variables[name];
    }

    /**
     * @brief Set a variable.
     * @param name The variable's name.
     * @param value A number or text.
     * @throws Error if `value` is a number JSON cannot store (`NaN`, `Infinity`).
     */
    setVar (name: string, value: VariableValue): void
    {
        if (typeof value === 'number' && !Number.isFinite(value))
        {
            throw new Error(`[state] setVar: "${name}" cannot be ${value}`);
        }
        if (this.data.variables[name] === value) return;
        this.set({ variables: { ...this.data.variables, [name]: value } });
    }

    // --------------------------------------------------------------- Events

    /**
     * @brief Read one of an event's self switches.
     * @param map Map ID.
     * @param event Event ID on that map.
     * @param letter `A` to `D`.
     * @return `true` if it is on.
     */
    getSelfSwitch (map: string, event: number, letter: SelfSwitch): boolean
    {
        return this.data.selfSwitches[selfSwitchKey(map, event, letter)] ?? false;
    }

    /**
     * @brief Turn one of an event's self switches on or off.
     * @param map Map ID.
     * @param event Event ID on that map.
     * @param letter `A` to `D`.
     * @param value Default: `true`.
     */
    setSelfSwitch (map: string, event: number, letter: SelfSwitch, value = true): void
    {
        const key = selfSwitchKey(map, event, letter);
        if ((this.data.selfSwitches[key] ?? false) === value) return;
        const selfSwitches = { ...this.data.selfSwitches };
        if (value) selfSwitches[key] = true;
        else delete selfSwitches[key];
        this.set({ selfSwitches });
    }

    /**
     * @brief Whether an event was hidden for good with the `hide` command.
     * @param map Map ID.
     * @param event Event ID on that map.
     */
    isEventHidden (map: string, event: number): boolean
    {
        return this.data.hiddenEvents[eventKey(map, event)] ?? false;
    }

    /**
     * @brief Hide an event for good, or show it again.
     * @param map Map ID.
     * @param event Event ID on that map.
     * @param hidden Default: `true`.
     */
    setEventHidden (map: string, event: number, hidden = true): void
    {
        const key = eventKey(map, event);
        if ((this.data.hiddenEvents[key] ?? false) === hidden) return;
        const hiddenEvents = { ...this.data.hiddenEvents };
        if (hidden) hiddenEvents[key] = true;
        else delete hiddenEvents[key];
        this.set({ hiddenEvents });
    }

    /**
     * @brief The last milestone reached on a story track.
     * @param track Track name. Default: `"main"`.
     * @return Milestone ID, or `undefined` if the track has not started.
     */
    getStory (track = 'main'): string | undefined
    {
        return this.data.story[track];
    }

    /**
     * @brief Record the milestone a story track has reached.
     *
     * The state does not check the order; `src/events` compares milestones
     * using the list in `src/events/registry/story.ts`.
     * @param milestone Milestone ID.
     * @param track Track name. Default: `"main"`.
     */
    setStory (milestone: string, track = 'main'): void
    {
        if (this.data.story[track] === milestone) return;
        this.set({ story: { ...this.data.story, [track]: milestone } });
    }

    // --------------------------------------------------------------- Player

    /**
     * @brief Rename the player.
     * @param name The new name.
     */
    setPlayerName (name: string): void
    {
        this.set({ player: { ...this.data.player, name } });
    }

    /**
     * @brief Record where the player is. Call it when the player stops on a tile or changes map.
     * @param position Map, tile and facing.
     * @throws Error if `x` or `y` is not a whole number.
     */
    setPosition (position: Position): void
    {
        if (!Number.isInteger(position.x) || !Number.isInteger(position.y))
        {
            throw new Error('[state] setPosition: x and y are tiles, so they must be whole numbers');
        }
        const { map, x, y, facing } = position;
        this.set({ player: { ...this.data.player, position: { map, x, y, facing } } });
    }

    /**
     * @brief Give or take money.
     * @param amount Whole number; negative to pay. Money above `MAX_MONEY` is lost.
     * @return `false`, changing nothing, if the player cannot afford it.
     * @throws Error if `amount` is not a whole number.
     */
    addMoney (amount: number): boolean
    {
        if (!Number.isInteger(amount)) throw new Error('[state] addMoney: amount must be a whole number');
        const money = this.data.player.money + amount;
        if (money < 0) return false;
        this.set({ player: { ...this.data.player, money: Math.min(money, MAX_MONEY) } });
        return true;
    }

    /**
     * @brief Count time played.
     * @param ms Milliseconds since the last call (a scene's `delta`, for example).
     */
    addPlayTime (ms: number): void
    {
        if (!(ms > 0) || !Number.isFinite(ms)) return;
        this.set({ player: { ...this.data.player, playTimeMs: this.data.player.playTimeMs + ms } });
    }

    // ------------------------------------------------------------- Dialogue

    /**
     * @brief The saved state of an ink story.
     * @param story Name the story was saved under.
     * @return JSON for `DialogueEngine.load()`, or `undefined` if that story was never saved.
     */
    getDialogueState (story: string): string | undefined
    {
        return this.data.dialogue[story];
    }

    /**
     * @brief Keep an ink story's state so it is written to the save file.
     * @param story A name for the story, e.g. its file name.
     * @param json The result of `DialogueEngine.save()`.
     */
    setDialogueState (story: string, json: string): void
    {
        if (this.data.dialogue[story] === json) return;
        this.set({ dialogue: { ...this.data.dialogue, [story]: json } });
    }

    // -------------------------------------------------------------- Private

    /** @brief Replace parts of the data and tell every subscriber. */
    private set (change: Partial<SaveData>): void
    {
        this.data = { ...this.data, ...change };
        for (const listener of [...this.listeners]) listener();
    }

    /** @brief The party member at `index`, or an error if there is none. */
    private partyMember (index: number): SavedPokemon
    {
        const pokemon = this.data.party[index];
        if (!pokemon) throw new Error(`[state] no party Pokémon at position ${index}`);
        return pokemon;
    }

    /** @brief The box with this number, or an error if there is none. */
    private boxAt (box: number): PcBox
    {
        const found = this.data.pc.boxes[box];
        if (!found) throw new Error(`[state] PC box ${box} does not exist`);
        return found;
    }

    /** @brief What a PC slot holds (`null` = empty), or an error if the slot does not exist. */
    private boxSlot (location: PcLocation): SavedPokemon | null
    {
        const pokemon = this.boxAt(location.box).slots[location.slot];
        if (pokemon === undefined) throw new Error(`[state] PC box ${location.box} has no slot ${location.slot}`);
        return pokemon;
    }

    /** @brief Put a Pokémon (or `null`) in a PC slot that exists. */
    private putInBox (location: PcLocation, pokemon: SavedPokemon | null): void
    {
        const boxes = [...this.data.pc.boxes];
        const slots = [...boxes[location.box].slots];
        slots[location.slot] = pokemon;
        boxes[location.box] = { ...boxes[location.box], slots };
        this.set({ pc: { ...this.data.pc, boxes } });
    }

    /** @brief The first empty PC slot, starting at box `from` and wrapping around. */
    private findFreeSlot (from: number): PcLocation | null
    {
        const { boxes } = this.data.pc;
        for (let i = 0; i < boxes.length; i++)
        {
            const box = (from + i) % boxes.length;
            const slot = boxes[box].slots.indexOf(null);
            if (slot >= 0) return { box, slot };
        }
        return null;
    }

    /** @brief The pocket and quantity of an item in the bag, or `null` if there is none. */
    private findItem (item: string): { pocket: ItemPocket; quantity: number } | null
    {
        for (const pocket of ItemPocket.options)
        {
            const stack = this.data.bag[pocket].find((entry) => entry.item === item);
            if (stack) return { pocket, quantity: stack.quantity };
        }
        return null;
    }
}

/** @brief Throws unless `quantity` is a positive whole number. */
function assertCount (quantity: number, method: string): void
{
    if (!Number.isInteger(quantity) || quantity < 1)
    {
        throw new Error(`[state] ${method}: quantity must be a positive whole number, not ${quantity}`);
    }
}
