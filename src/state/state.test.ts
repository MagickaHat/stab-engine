/**
 * @file state.test.ts
 * @brief Tests for the game state and save system. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { BattleBridge } from '../battle/bridge/BattleBridge.ts';
import type { BattleSnapshot } from '../battle/bridge/snapshot.ts';
import { importTeam, SAMPLE_TEAM_P2 } from '../battle/teams.ts';
import { englishMessage } from '../battle/text.ts';
import { partyBattle } from './battle.ts';
import type { ExpSpecies } from './battle.ts';
import { evolvedAbility, evolvePokemon, findEvolution } from './evolution.ts';
import { addEvs, expForLevel, expGain, levelForExp, levelUpMoves } from './experience.ts';
import { GameState } from './GameState.ts';
import { createPokemon } from './pokemon.ts';
import type { NewPokemon } from './pokemon.ts';
import { MemoryStorage, parseSaveFile, SaveError, SaveManager, SAVE_VERSION } from './SaveManager.ts';
import type { SaveStorage } from './SaveManager.ts';
import { getGameState, requireGameState, setGameState, subscribeGameState } from './session.ts';

/** @brief A repeatable source of random numbers. */
function seeded (seed = 1): () => number
{
    let value = seed;
    return () =>
    {
        value = (value * 1103515245 + 12345) % 2147483648;
        return value / 2147483648;
    };
}

/** @brief A Pikachu with a different `uid` for every `n`. */
function pikachu (n = 0, extra: Partial<NewPokemon> = {}): ReturnType<typeof createPokemon>
{
    return createPokemon({
        species: 'pikachu', level: 50, ability: 'static', moves: ['thunderbolt', 'surf'],
        uid: `pika${n}`, metDate: new Date(0), ...extra,
    }, seeded(n + 1));
}

/** @brief Expects a `SaveError` with this code. */
function saveError (code: SaveError['code']): (error: unknown) => boolean
{
    return (error) => error instanceof SaveError && error.code === code;
}

test('createPokemon: fills in defaults and rejects bad values', () =>
{
    const pokemon = pikachu(0, { nickname: 'Sparky', item: 'lightball' });
    assert.equal(pokemon.nickname, 'Sparky');
    assert.equal(pokemon.item, 'lightball');
    assert.equal(pokemon.hp, undefined, 'full HP is stored by leaving hp out');
    assert.deepEqual(pokemon.moves, [{ id: 'thunderbolt', ppUps: 0 }, { id: 'surf', ppUps: 0 }]);
    assert.ok(Object.values(pokemon.ivs).every((iv) => iv >= 0 && iv <= 31));
    assert.deepEqual(pokemon, pikachu(0, { nickname: 'Sparky', item: 'lightball' }), 'same seed, same Pokémon');

    assert.throws(() => pikachu(0, { level: 0 }), /createPokemon: level/);
    assert.throws(() => pikachu(0, { species: 'Mr. Mime' }), /createPokemon: species/);
    assert.throws(() => pikachu(0, { moves: [] }), /createPokemon: moves/);
});

test('GameState: a new game is empty and has 30 boxes of 30', () =>
{
    const data = GameState.create({ name: 'Red', trainerId: 7 }).getSnapshot();
    assert.equal(data.player.name, 'Red');
    assert.equal(data.player.trainerId, 7);
    assert.deepEqual(data.party, []);
    assert.equal(data.pc.boxes.length, 30);
    assert.ok(data.pc.boxes.every((box) => box.slots.length === 30 && box.slots.every((slot) => slot === null)));
    assert.equal(data.pc.boxes[0].name, 'Box 1');
    assert.deepEqual(data.bag.medicine, []);
    assert.throws(() => GameState.create({ boxCount: 0 }), /invalid save data/);
});

test('GameState: party fills up, then Pokémon go to the PC', () =>
{
    const state = GameState.create({ boxCount: 2, boxSize: 2 });
    for (let n = 0; n < 6; n++) assert.deepEqual(state.addToParty(pikachu(n)), { where: 'party', index: n });
    assert.deepEqual(state.addToParty(pikachu(6)), { where: 'pc', box: 0, slot: 0 });
    assert.throws(() => state.addToParty(pikachu(6)), /already owned/);

    state.setCurrentBox(1);
    assert.deepEqual(state.addToParty(pikachu(7)), { where: 'pc', box: 1, slot: 0 });
    assert.deepEqual(state.addToParty(pikachu(8)), { where: 'pc', box: 1, slot: 1 });
    assert.deepEqual(state.addToParty(pikachu(9)), { where: 'pc', box: 0, slot: 1 }, 'wraps to the first box');
    assert.equal(state.addToParty(pikachu(10)), null, 'everything is full');

    assert.deepEqual(state.findPokemon('pika9')?.location, { where: 'pc', box: 0, slot: 1 });
    assert.equal(state.findPokemon('nobody'), null);
});

test('GameState: party order, deposit, withdraw and moving in the PC', () =>
{
    const state = GameState.create();
    for (let n = 0; n < 3; n++) state.addToParty(pikachu(n));

    state.swapParty(0, 2);
    assert.deepEqual(state.getSnapshot().party.map((p) => p.uid), ['pika2', 'pika1', 'pika0']);
    assert.throws(() => state.swapParty(0, 5), /no party Pokémon/);

    assert.deepEqual(state.deposit(0), { box: 0, slot: 0 });
    assert.equal(state.deposit(0, { box: 0, slot: 0 }), null, 'the slot is taken');
    assert.deepEqual(state.deposit(0, { box: 3, slot: 4 }), { box: 3, slot: 4 });
    assert.deepEqual(state.getSnapshot().party.map((p) => p.uid), ['pika0']);
    assert.throws(() => state.deposit(0, { box: 99, slot: 0 }), /box 99 does not exist/);

    state.movePokemon({ box: 0, slot: 0 }, { box: 3, slot: 4 });
    assert.equal(state.getSnapshot().pc.boxes[0].slots[0]?.uid, 'pika1', 'two Pokémon swap places');
    state.movePokemon({ box: 0, slot: 0 }, { box: 1, slot: 1 });
    assert.equal(state.getSnapshot().pc.boxes[0].slots[0], null);

    assert.equal(state.withdraw({ box: 0, slot: 0 }), false, 'empty slot');
    assert.equal(state.withdraw({ box: 1, slot: 1 }), true);
    assert.deepEqual(state.getSnapshot().party.map((p) => p.uid), ['pika0', 'pika1']);

    assert.equal(state.removeFromPc({ box: 3, slot: 4 })?.uid, 'pika2');
    assert.equal(state.removeFromParty(0).uid, 'pika0');
    state.renameBox(0, 'Favourites');
    assert.equal(state.getSnapshot().pc.boxes[0].name, 'Favourites');
});

test('GameState: updatePokemon and healParty', () =>
{
    const state = GameState.create();
    state.addToParty(pikachu(0));
    state.updatePokemon('pika0', { hp: 0, status: 'par', level: 51 });
    state.updatePokemon('pika0', (p) => ({ ...p, uid: 'changed', moves: [{ id: 'surf', ppUps: 1, pp: 3 }] }));
    const hurt = state.getSnapshot().party[0];
    assert.equal(hurt.uid, 'pika0', 'the uid cannot be changed');
    assert.deepEqual([hurt.hp, hurt.status, hurt.level], [0, 'par', 51]);
    assert.equal(state.updatePokemon('nobody', { level: 2 }), false);

    state.healParty();
    const well = state.getSnapshot().party[0];
    assert.equal(well.hp, undefined);
    assert.equal(well.status, undefined);
    assert.deepEqual(well.moves, [{ id: 'surf', ppUps: 1 }]);
});

test('GameState: bag', () =>
{
    const state = GameState.create();
    assert.throws(() => state.addItem('potion'), /pocket is needed/);
    assert.throws(() => state.addItem('Potion', 1, 'medicine'), /not an item ID/);
    assert.throws(() => state.addItem('potion', 0, 'medicine'), /positive whole number/);

    assert.equal(state.addItem('potion', 3, 'medicine'), true);
    assert.equal(state.addItem('pokeball', 5, 'pokeballs'), true);
    assert.equal(state.addItem('potion', 2), true, 'the pocket is known once the item is held');
    assert.equal(state.addItem('antidote', 1, 'medicine'), true);
    assert.deepEqual(state.getSnapshot().bag.medicine, [{ item: 'potion', quantity: 5 }, { item: 'antidote', quantity: 1 }]);
    assert.equal(state.countItem('potion'), 5);

    assert.equal(state.addItem('potion', 995), false, 'more than 999');
    assert.equal(state.removeItem('potion', 6), false, 'not enough');
    assert.equal(state.countItem('potion'), 5);
    assert.equal(state.removeItem('potion', 5), true);
    assert.deepEqual(state.getSnapshot().bag.medicine, [{ item: 'antidote', quantity: 1 }]);
    assert.equal(state.countItem('potion'), 0);
    assert.equal(state.removeItem('masterball'), false);
});

test('GameState: flags, variables, player and dialogue', () =>
{
    const state = GameState.create({ money: 100 });
    assert.equal(state.getFlag('got_starter'), false);
    state.setFlag('got_starter');
    assert.equal(state.getFlag('got_starter'), true);
    state.setFlag('got_starter', false);
    assert.equal(state.getFlag('got_starter'), false);

    assert.equal(state.getVar('badges'), undefined);
    state.setVar('badges', 3);
    state.setVar('rival_name', 'Blue');
    assert.equal(state.getVar('badges'), 3);
    assert.equal(state.getVar('rival_name'), 'Blue');
    assert.throws(() => state.setVar('badges', Number.NaN), /cannot be NaN/);

    assert.equal(state.addMoney(-150), false);
    assert.equal(state.addMoney(-40), true);
    assert.equal(state.getSnapshot().player.money, 60);
    state.addMoney(99_999_999);
    assert.equal(state.getSnapshot().player.money, 9_999_999);

    state.setPosition({ map: 'pallettown', x: 5, y: 7, facing: 'left' });
    assert.deepEqual(state.getSnapshot().player.position, { map: 'pallettown', x: 5, y: 7, facing: 'left' });
    assert.throws(() => state.setPosition({ map: 'pallettown', x: 5.5, y: 7, facing: 'left' }), /whole numbers/);

    state.addPlayTime(16.6);
    state.addPlayTime(-5);
    assert.equal(state.getSnapshot().player.playTimeMs, 16.6);

    state.setDialogueState('sample', '{"flows":{}}');
    assert.equal(state.getDialogueState('sample'), '{"flows":{}}');
    assert.equal(state.getDialogueState('other'), undefined);
});

test('GameState: subscribers are told of changes and snapshots are replaced, not modified', () =>
{
    const state = GameState.create();
    let calls = 0;
    const stop = state.subscribe(() => { calls++; });

    const before = state.getSnapshot();
    assert.equal(state.getSnapshot(), before, 'the same object until something changes');
    state.setFlag('a');
    const after = state.getSnapshot();
    assert.notEqual(after, before);
    assert.deepEqual(before.flags, {}, 'the old snapshot is untouched');
    assert.equal(after.pc, before.pc, 'parts that did not change are shared');
    assert.equal(calls, 1);

    state.setFlag('a');
    assert.equal(calls, 1, 'setting the same value changes nothing');
    stop();
    state.setFlag('b');
    assert.equal(calls, 1);

    const copy = state.toJSON();
    copy.flags.c = true;
    assert.equal(state.getFlag('c'), false, 'toJSON() returns a copy');
});

test('GameState: survives JSON and rejects bad data', () =>
{
    const state = GameState.create({ name: 'Red', trainerId: 1 });
    state.addToParty(pikachu(0, { nickname: 'Sparky' }));
    state.deposit(0);
    state.addToParty(pikachu(1));
    state.addItem('potion', 3, 'medicine');
    state.setFlag('got_starter');
    state.setVar('badges', 2);
    state.setDialogueState('sample', '{}');

    const restored = GameState.fromJSON(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(restored.toJSON(), state.toJSON());

    const broken = state.toJSON() as unknown as { party: { level: number }[] };
    broken.party[0].level = -1;
    assert.throws(() => GameState.fromJSON(broken), /invalid save data: party\.0\.level/);
    assert.throws(() => GameState.fromJSON(null), /invalid save data/);
});

test('session: the game in progress', () =>
{
    assert.equal(getGameState(), null);
    assert.throws(() => requireGameState(), /no game in progress/);
    let calls = 0;
    const stop = subscribeGameState(() => { calls++; });
    const state = GameState.create();
    setGameState(state);
    setGameState(state);
    assert.equal(calls, 1);
    assert.equal(requireGameState(), state);
    setGameState(null);
    assert.equal(calls, 2);
    stop();
});

test('SaveManager: save, list, load and delete', () =>
{
    const storage = new MemoryStorage();
    const saves = new SaveManager({ storage, now: () => new Date('2026-01-02T03:04:05.000Z') });
    const state = GameState.create({ name: 'Red', trainerId: 1 });
    state.addToParty(pikachu(0));
    state.setPosition({ map: 'route1', x: 3, y: 4, facing: 'up' });
    state.addPlayTime(90_000);

    assert.deepEqual(saves.list().map((info) => info.status), ['empty', 'empty', 'empty']);
    const summary = saves.save(1, state);
    assert.deepEqual(summary, {
        slot: 1,
        savedAt: '2026-01-02T03:04:05.000Z',
        playerName: 'Red',
        playTimeMs: 90_000,
        map: 'route1',
        party: [{ species: 'pikachu', level: 50, shiny: false, gender: 'N' }],
        badges: 0,
        pokedexOwned: 1,
        language: 'en',
    });
    assert.deepEqual(saves.list(), [{ slot: 0, status: 'empty' }, { slot: 1, status: 'ok', summary }, { slot: 2, status: 'empty' }]);
    assert.ok(storage.getItem('stab-engine:save:1'));
    assert.equal(saves.has(1), true);

    const loaded = saves.load(1);
    assert.notEqual(loaded, state);
    assert.deepEqual(loaded.toJSON(), state.toJSON());

    //  Later changes are not in the file until the next save.
    state.setFlag('later');
    assert.equal(saves.load(1).getFlag('later'), false);

    saves.delete(1);
    assert.equal(saves.has(1), false);
    assert.throws(() => saves.load(1), saveError('empty'));
    assert.throws(() => saves.save(3, state), RangeError);
});

test('SaveManager: export and import', () =>
{
    const saves = new SaveManager({ storage: new MemoryStorage() });
    const state = GameState.create({ name: 'Red' });
    state.setVar('badges', 8);
    saves.save(0, state);

    const text = saves.exportSave(0);
    const other = new SaveManager({ storage: new MemoryStorage() });
    assert.equal(other.importSave(2, text).playerName, 'Red');
    assert.equal(other.load(2).getVar('badges'), 8);
    assert.throws(() => saves.exportSave(1), saveError('empty'));

    assert.throws(() => other.importSave(2, 'not a save'), saveError('corrupt'));
    assert.equal(other.load(2).getVar('badges'), 8, 'a bad import leaves the slot alone');
});

test('SaveManager: unreadable files are reported and kept', () =>
{
    const storage = new MemoryStorage();
    const saves = new SaveManager({ storage });
    const good = GameState.create().toJSON();

    storage.setItem('stab-engine:save:0', '{"half a file');
    const newer = JSON.stringify({ version: SAVE_VERSION + 1, savedAt: '', data: good });
    storage.setItem('stab-engine:save:1', newer);
    storage.setItem('stab-engine:save:2', JSON.stringify({ version: SAVE_VERSION, savedAt: '', data: { ...good, party: 'none' } }));

    assert.throws(() => saves.load(0), saveError('corrupt'));
    assert.throws(() => saves.load(1), saveError('newer'));
    assert.throws(() => saves.load(2), saveError('invalid'));
    assert.deepEqual(
        saves.list().map((info) => (info.status === 'error' ? info.error.code : info.status)),
        ['corrupt', 'newer', 'invalid'],
    );
    assert.equal(storage.getItem('stab-engine:save:1'), newer, 'reading does not change the stored file');
});

test('SaveManager: a failed write is a SaveError', () =>
{
    const full: SaveStorage = {
        getItem: () => null,
        setItem: () => { throw new Error('quota exceeded'); },
        removeItem: () => {},
    };
    assert.throws(() => new SaveManager({ storage: full }).save(0, GameState.create()), saveError('storage'));
    assert.throws(() => new SaveManager(), saveError('storage'), 'Node has no localStorage');
});

test('parseSaveFile: old versions are upgraded step by step', () =>
{
    const data = GameState.create({ name: 'Red' }).toJSON();
    const { flags: _flags, variables: _variables, ...rest } = data;
    //  Pretend version 1 had no flags or variables, and version 2 no variables.
    const old = JSON.stringify({ version: 1, savedAt: '2020-01-01T00:00:00.000Z', data: rest });
    const migrations = {
        1: (value: unknown) => ({ ...(value as object), flags: { migrated: true } }),
        2: (value: unknown) => ({ ...(value as object), variables: { from: 2 } }),
    };

    const file = parseSaveFile(old, migrations, 3);
    assert.equal(file.version, 3);
    assert.equal(file.savedAt, '2020-01-01T00:00:00.000Z');
    assert.deepEqual(file.data.flags, { migrated: true });
    assert.deepEqual(file.data.variables, { from: 2 });

    assert.throws(() => parseSaveFile(old, { 1: migrations[1] }, 3), saveError('invalid'), 'a step is missing');
    assert.throws(() => parseSaveFile(old, {}, 1), saveError('invalid'), 'version 1 data without flags');
});

/** @brief Play a bridged battle to the end, always picking the first valid option. */
function playOut (bridge: BattleBridge): Promise<BattleSnapshot>
{
    return new Promise((resolve) =>
    {
        bridge.subscribe(() =>
        {
            const snapshot = bridge.getSnapshot();
            const choice = snapshot.choice;
            if (snapshot.phase === 'ended') resolve(snapshot);
            else if (!choice) return;
            else if (choice.kind === 'team') bridge.chooseTeam();
            else if (choice.kind === 'switch') bridge.chooseSwitch(choice.switches.find((s) => !s.disabled)!.slot);
            else bridge.chooseMove(choice.moves.find((m) => !m.disabled)!.slot);
        });
        bridge.start();
    });
}

test('partyBattle: the party enters a battle as saved and the result is written back', async () =>
{
    const state = GameState.create({ name: 'Red' });
    state.addToParty(pikachu(0, { nickname: 'Fainted' }));
    state.addToParty(pikachu(1, { nickname: 'Sparky', item: 'lightball', gender: 'F', shiny: true }));
    state.addToParty(createPokemon({
        species: 'snorlax', level: 60, ability: 'thickfat', moves: ['bodyslam', 'rest'], uid: 'lax', gender: 'M',
    }, seeded(9)));
    state.updatePokemon('pika0', { hp: 0 });
    state.updatePokemon('pika1', { hp: 40, status: 'par', moves: [{ id: 'thunderbolt', ppUps: 3, pp: 5 }, { id: 'surf', ppUps: 0 }] });

    const link = partyBattle(state);
    assert.deepEqual(link.uids, ['pika1', 'lax'], 'fainted Pokémon stay out of the team');

    const bridge = new BattleBridge({
        p1: { name: 'Red', team: link.team },
        p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
        seed: 'gen5,1,2,3,4',
        prepare: link.prepare,
    });

    //  What the player is first shown must already be the saved condition.
    let first: BattleSnapshot | null = null;
    bridge.subscribe(() => { if (!first && bridge.getSnapshot().choice) first = bridge.getSnapshot(); });
    const end = await playOut(bridge);

    const preview = first as BattleSnapshot | null;
    assert.ok(preview?.choice);
    const [sparky, snorlax] = preview.choice.switches;
    assert.deepEqual([sparky.name, sparky.hp, sparky.status], ['Sparky', 40, 'par']);
    assert.ok(sparky.details.includes('shiny') && sparky.details.includes('L50') && sparky.details.includes(', F'));
    assert.equal(snorlax.hp, snorlax.maxhp);

    const battle = bridge.engine.battle;
    assert.ok(battle);
    const simSparky = battle.p1.pokemon.find((p) => p.name === 'Sparky')!;
    const simSnorlax = battle.p1.pokemon.find((p) => p.name === 'Snorlax')!;
    assert.equal(simSparky.baseMoveSlots[0].maxpp, 24, 'Thunderbolt with 3 PP Ups');
    assert.equal(simSparky.baseMoveSlots[1].maxpp, 15, 'Surf without PP Ups');
    assert.equal(simSparky.item || simSparky.lastItem, 'lightball');

    link.finish();
    bridge.destroy();

    const [fainted, pika, lax] = state.getSnapshot().party;
    assert.equal(fainted.hp, 0, 'left as it was');
    for (const [saved, sim] of [[pika, simSparky], [lax, simSnorlax]] as const)
    {
        assert.equal(saved.hp ?? sim.maxhp, sim.hp, `${saved.species}: HP`);
        assert.equal(saved.status ?? '', sim.hp ? sim.status : '', `${saved.species}: status`);
        for (const [index, move] of saved.moves.entries())
        {
            const slot = sim.baseMoveSlots[index];
            assert.equal(move.pp ?? slot.maxpp, slot.pp, `${saved.species}: PP of ${move.id}`);
        }
    }
    assert.equal(pika.moves[0].ppUps, 3);
    //  The battle really happened: something on the player's side changed.
    assert.equal(end.phase, 'ended');
    const used = [simSparky, simSnorlax].some((p) => p.hp < p.maxhp || p.baseMoveSlots.some((s) => s.pp < s.maxpp));
    assert.ok(used);
    assert.ok(pika.hp !== 40 || pika.moves[0].pp !== 5 || lax.hp !== undefined, 'the saved party reflects the battle');

    //  The result survives a save and load.
    const saves = new SaveManager({ storage: new MemoryStorage() });
    saves.save(0, state);
    assert.deepEqual(saves.load(0).getSnapshot().party, state.getSnapshot().party);
});

/** @brief Fight the sample opponent with a lone Snorlax and write the result back. */
async function fightAlone (state: GameState): Promise<NonNullable<BattleBridge['engine']['battle']>['p1']['pokemon'][number]>
{
    const link = partyBattle(state);
    const bridge = new BattleBridge({
        p1: { name: 'Red', team: link.team },
        p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
        seed: 'gen5,1,2,3,4',
        prepare: link.prepare,
    });
    await playOut(bridge);
    const pokemon = bridge.engine.battle!.p1.pokemon[0];
    link.finish();
    bridge.destroy();
    return pokemon;
}

test('partyBattle: used held items come back after the battle, except Berries', async () =>
{
    const snorlax = (item: string): NewPokemon => ({
        species: 'snorlax', level: 100, ability: 'thickfat', moves: ['hypervoice'], uid: 'lax', item,
    });

    const spray = GameState.create();
    spray.addToParty(createPokemon(snorlax('throatspray'), seeded(3)));
    const sprayed = await fightAlone(spray);
    assert.deepEqual([sprayed.item, sprayed.lastItem], ['', 'throatspray'], 'the Throat Spray was used in battle');
    assert.equal(spray.getSnapshot().party[0].item, 'throatspray', 'and is held again afterwards');

    const berry = GameState.create();
    berry.addToParty(createPokemon(snorlax('sitrusberry'), seeded(3)));
    berry.updatePokemon('lax', { hp: 10 });
    const fed = await fightAlone(berry);
    assert.deepEqual([fed.item, fed.lastItem], ['', 'sitrusberry'], 'the Sitrus Berry was eaten in battle');
    assert.equal(berry.getSnapshot().party[0].item, undefined, 'and is gone afterwards');

    const kept = GameState.create();
    kept.addToParty(createPokemon(snorlax('leftovers'), seeded(3)));
    await fightAlone(kept);
    assert.equal(kept.getSnapshot().party[0].item, 'leftovers');
});

test('experience: growth curves and the gain formula', () =>
{
    assert.deepEqual(
        (['fast', 'medium', 'medium-slow', 'slow', 'slow-then-very-fast', 'fast-then-very-slow'] as const)
            .map((growth) => expForLevel(growth, 100)),
        [800_000, 1_000_000, 1_059_860, 1_250_000, 600_000, 1_640_000],
    );
    assert.equal(expForLevel('medium-slow', 1), 0);
    assert.equal(expForLevel('medium-slow', 2), 9);
    assert.equal(expForLevel('slow-then-very-fast', 50), 125_000);
    assert.equal(expForLevel('fast-then-very-slow', 36), 46_656 * 50 / 50);

    assert.equal(levelForExp('medium', 0), 1);
    assert.equal(levelForExp('medium', 124_999), 49);
    assert.equal(levelForExp('medium', 125_000), 50);
    assert.equal(levelForExp('medium', 99_999_999), 100);

    const even = { baseExp: 112, defeatedLevel: 50, level: 50 };
    assert.equal(expGain({ ...even, participated: true }), 1121);
    assert.equal(expGain({ ...even, participated: false }), 561, 'half for those that did not take part');
    assert.equal(expGain({ ...even, participated: true, luckyEgg: true }), 1681);
    assert.ok(expGain({ ...even, level: 20, participated: true }) > 1121, 'more for a lower-level receiver');
    assert.ok(expGain({ ...even, level: 80, participated: true }) < 1121, 'less for a higher-level receiver');
    assert.equal(expGain({ ...even, baseExp: 0, participated: true }), 0);
});

/** @brief Reads a generated PBS table. */
function readTable<T> (file: string): Record<string, T>
{
    return JSON.parse(fs.readFileSync(new URL(`../../content/pbs/generated/${file}`, import.meta.url), 'utf8')) as Record<string, T>;
}

test('partyBattle: experience, effort values, level-ups and new moves apply during the battle and are saved after it', async () =>
{
    const info = readTable<ExpSpecies>('species_info.json');
    const learnsets = readTable<{ learnset?: Record<string, string[]> }>('learnsets.json');
    const magikarp = 'Magikarp\nLevel: 30\nAbility: Swift Swim\n- Splash';

    const state = GameState.create({ name: 'Red', trainerId: 1 });
    //  Four moves already: what the lead learns goes to its move bank.
    state.addToParty(createPokemon({
        species: 'pikachu', level: 10, ability: 'static', moves: ['thundershock', 'growl', 'tailwhip', 'quickattack'],
        uid: 'lead', nickname: 'Sparky',
    }, seeded(1)));
    //  One move: what it learns is ready at once.
    state.addToParty(createPokemon({ species: 'bulbasaur', level: 5, ability: 'overgrow', moves: ['tackle'], uid: 'bench', exp: 140 }, seeded(2)));
    state.addToParty(createPokemon({ species: 'snorlax', level: 100, ability: 'thickfat', moves: ['rest'], uid: 'max' }, seeded(3)));
    //  From another trainer, one level short of evolving, and already near the effort value limits.
    state.addToParty(createPokemon({
        species: 'caterpie', level: 6, ability: 'runaway', moves: ['tackle'], uid: 'traded',
        ot: { name: 'Blue', id: 2 }, evs: { hp: 252, atk: 252, spe: 5 },
    }, seeded(4)));
    assert.deepEqual(state.getSnapshot().party.map((p) => [p.ot.name, state.isTraded(p)]),
        [['Red', false], ['Red', false], ['Red', false], ['Blue', true]]);

    const link = partyBattle(state, { exp: { species: (id) => info[id], learnset: (id) => learnsets[id] } });
    const bridge = new BattleBridge({
        p1: { name: 'Red', team: link.team },
        p2: { name: 'Rival', team: importTeam(`${magikarp}\n\n${magikarp}`), ai: 'random' },
        seed: 'gen5,1,2,3,4',
        prepare: link.prepare,
    });
    const lines: string[] = [];
    const forward = bridge.engine.onProtocol;
    bridge.engine.onProtocol = (batch) => { lines.push(...batch); forward(batch); };
    //  The lead as the player is shown it, each time a choice is offered.
    const shown: { level: number; maxhp: number }[] = [];
    //  The party's levels in the snapshot at the moment each "grew to" message is presented.
    const levelsWhenTold: Record<string, number | undefined> = {};
    bridge.subscribe(() =>
    {
        const snapshot = bridge.getSnapshot();
        const lead = snapshot.me.active[0];
        if (snapshot.choice && lead) shown.push({ level: lead.level, maxhp: lead.maxhp });
        //  `step.text` is what a battle text box prints.
        const told = /^(.+) grew to Lv\. (\d+)!$/.exec(snapshot.step?.text ?? '');
        if (told) levelsWhenTold[`${told[1]} ${told[2]}`] = snapshot.me.team.find((view) => view.name === told[1])?.level;
    });

    const end = await playOut(bridge);
    assert.equal(end.winner, 'Red');

    //  What the rules say two level 30 Magikarp are worth, one after the other.
    const expected = (growth: ExpSpecies['growthRate'], start: number, participated: boolean, traded = false) =>
    {
        let exp = start;
        let gained = 0;
        for (let i = 0; i < 2; i++)
        {
            const gain = expGain({ baseExp: info.magikarp.baseExp!, defeatedLevel: 30, level: levelForExp(growth, exp), participated, traded });
            exp += gain;
            gained += gain;
        }
        return { exp, gained, level: levelForExp(growth, exp) };
    };
    //  The lead was made without `exp`, so it starts at the least level 10 needs; the bench has 140.
    const lead = expected('medium', expForLevel('medium', 10), true);
    const bench = expected('medium-slow', 140, false);
    const traded = expected('medium', expForLevel('medium', 6), false, true);
    assert.ok(traded.gained > expected('medium', expForLevel('medium', 6), false).gained, 'traded Pokémon gain more');
    assert.deepEqual([lead.level, bench.level], [12, 11]);

    //  During the battle: the simulator's Pokémon have grown, stats included.
    const battle = bridge.engine.battle!;
    const [simLead, simBench, simMax, simTraded] = battle.p1.pokemon;
    assert.deepEqual([simLead.level, simBench.level, simMax.level, simTraded.level], [12, 11, 100, traded.level]);
    for (const sim of battle.p1.pokemon)
    {
        assert.deepEqual(sim.baseStoredStats, battle.spreadModify(sim.species.baseStats, sim.set), `${sim.name}: stats`);
        assert.equal(sim.maxhp, sim.baseStoredStats.hp, `${sim.name}: max HP`);
    }
    //  Effort values: each Magikarp gives 1 Speed, used in the stats above.
    assert.equal(simLead.set.evs.spe, 2);
    assert.equal(simMax.set.evs.spe, 2, 'level 100 still gains effort values');
    assert.deepEqual([simTraded.set.evs.hp, simTraded.set.evs.atk, simTraded.set.evs.spe], [252, 252, 6], 'stops at 510 in total');

    //  New moves: ready at once with a free slot, otherwise in the move bank.
    assert.deepEqual(simBench.baseMoveSlots.map((slot) => slot.id), ['tackle', 'growth', 'leechseed']);
    assert.deepEqual(simBench.moveSlots.map((slot) => [slot.id, slot.pp]), [['tackle', 35], ['growth', 20], ['leechseed', 10]]);
    assert.equal(simLead.baseMoveSlots.length, 4);

    //  The battle text: the protocol carries text keys, shown in English without a localizer.
    assert.ok(lines.some((line) => line.startsWith('|-message|@battle.exp.gained ')));
    const messages = lines.filter((line) => line.startsWith('|-message|')).map((line) => englishMessage(line.slice('|-message|'.length)));
    assert.ok(messages.some((text) => /^Sparky gained \d+ Exp\. Points!$/.test(text)));
    assert.ok(messages.includes('Bulbasaur grew to Lv. 11!'));
    assert.ok(messages.includes('Bulbasaur learned Growth!'));
    assert.ok(messages.includes('Bulbasaur learned Leech Seed!'));
    assert.ok(messages.includes('Sparky learned Electro Ball! It was stored in its move bank.'));
    assert.ok(messages.indexOf('Sparky grew to Lv. 12!') < messages.indexOf('Sparky learned Electro Ball! It was stored in its move bank.'));

    //  The new level is shown as soon as it is announced, on the field and on the bench.
    assert.ok(lines.some((line) => line.startsWith('|detailschange|p1a: Sparky|Pikachu, L12')));
    assert.ok(lines.some((line) => line.startsWith('|detailschange|p1: Bulbasaur|Bulbasaur, L11')));
    for (const [told, level] of Object.entries(levelsWhenTold))
    {
        assert.equal(level, Number(told.split(' ').pop()), `${told}: the snapshot has the level when the message is shown`);
    }
    assert.deepEqual(
        ['Sparky 11', 'Sparky 12', 'Bulbasaur 11', `Caterpie ${simTraded.level}`].filter((told) => !(told in levelsWhenTold)), [],
    );
    assert.equal(shown[0].level, 10);
    assert.ok(shown.some((view) => view.level > 10 && view.maxhp > shown[0].maxhp), 'the lead grew between two turns');
    assert.deepEqual(end.me.team.map((view) => view.level).sort((a, b) => a - b), [11, 12, traded.level, 100].sort((a, b) => a - b));
    //  Announcing the level must not disturb what the viewer knows of the ability.
    assert.equal(end.me.team.find((view) => view.name === 'Caterpie')?.ability, 'runaway');

    //  After the battle: written back to the game state.
    const outcome = link.finish();
    bridge.destroy();
    assert.deepEqual(outcome.gains, [
        { uid: 'lead', gained: lead.gained, fromLevel: 10, toLevel: 12, learned: [], banked: ['electroball'], evs: { spe: 2 } },
        { uid: 'bench', gained: bench.gained, fromLevel: 5, toLevel: 11, learned: ['growth', 'leechseed'], banked: [], evs: { spe: 2 } },
        { uid: 'max', gained: 0, fromLevel: 100, toLevel: 100, learned: [], banked: [], evs: { spe: 2 } },
        { uid: 'traded', gained: traded.gained, fromLevel: 6, toLevel: traded.level, learned: outcome.gains[3].learned, banked: [], evs: { spe: 1 } },
    ]);
    assert.deepEqual(outcome.evolutions, [{ uid: 'traded', from: 'caterpie', into: 'metapod' }]);

    const [savedLead, savedBench, savedMax, savedTraded] = state.getSnapshot().party;
    assert.deepEqual([savedLead.level, savedLead.exp], [12, lead.exp]);
    assert.deepEqual([savedBench.level, savedBench.exp], [11, bench.exp]);
    assert.deepEqual([savedMax.level, savedMax.exp], [100, expForLevel('slow', 100)], 'level 100 gains no experience');
    assert.deepEqual([savedTraded.level, savedTraded.exp], [traded.level, traded.exp]);
    assert.equal(savedLead.hp, undefined, 'unhurt, so still at full HP at its new level');
    assert.deepEqual(savedLead.moves.map((move) => move.id), ['thundershock', 'growl', 'tailwhip', 'quickattack']);
    assert.deepEqual(savedLead.moveBank, ['electroball']);
    assert.deepEqual(savedBench.moves, [{ id: 'tackle', ppUps: 0 }, { id: 'growth', ppUps: 0 }, { id: 'leechseed', ppUps: 0 }]);
    assert.deepEqual(savedBench.moveBank, []);
    assert.equal(savedLead.evs.spe, 2);
    assert.equal(savedTraded.evs.spe, 6);
    assert.deepEqual(link.finish(), { gains: [], evolutions: [] }, 'a second call does nothing');

    //  What the evolution scene does once it has shown the evolution.
    const pokedex = readTable<{ abilities: Record<string, string> }>('pokedex.json');
    const [{ uid, from, into }] = outcome.evolutions;
    assert.equal(evolvePokemon(state, uid, into, {
        ability: evolvedAbility(pokedex[from].abilities, pokedex[into].abilities, savedTraded.ability),
        moves: levelUpMoves(learnsets[into].learnset, -1, 0),
    }), true);
    const metapod = state.getSnapshot().party[3];
    assert.deepEqual([metapod.species, metapod.ability, metapod.level, metapod.uid], ['metapod', 'shedskin', traded.level, 'traded']);
    assert.ok(metapod.moves.some((move) => move.id === 'harden'), 'Metapod learns Harden on evolving');

    //  Everything new survives a save and load.
    const saves = new SaveManager({ storage: new MemoryStorage() });
    saves.save(0, state);
    assert.deepEqual(saves.load(0).getSnapshot().party, state.getSnapshot().party);
});

test('partyBattle: no experience unless it is asked for', async () =>
{
    const state = GameState.create();
    state.addToParty(createPokemon({ species: 'pikachu', level: 10, ability: 'static', moves: ['thundershock'], uid: 'lead', exp: 1000 }, seeded(1)));
    const link = partyBattle(state);
    const bridge = new BattleBridge({
        p1: { name: 'Red', team: link.team },
        p2: { name: 'Rival', team: importTeam('Magikarp\nLevel: 30\nAbility: Swift Swim\n- Splash'), ai: 'random' },
        seed: 'gen5,1,2,3,4',
        prepare: link.prepare,
    });
    assert.equal((await playOut(bridge)).winner, 'Red');
    assert.deepEqual(link.finish(), { gains: [], evolutions: [] });
    bridge.destroy();
    const [lead] = state.getSnapshot().party;
    assert.deepEqual([lead.level, lead.exp, lead.evs.spe, lead.moves.length], [10, 1000, 0, 1]);
});

test('experience: effort values, the traded bonus and level-up moves', () =>
{
    const none = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    assert.deepEqual(addEvs(none, { spe: 2, hp: 1 }), { ...none, hp: 1, spe: 2 });
    assert.deepEqual(addEvs({ ...none, spe: 251 }, { spe: 3 }), { ...none, spe: 252 }, '252 per stat');
    const nearlyFull = { ...none, hp: 252, atk: 252, def: 5 };
    assert.deepEqual(addEvs(nearlyFull, { def: 3 }), { ...nearlyFull, def: 6 }, '510 in total');
    const full = { ...none, hp: 252, atk: 252, def: 6 };
    assert.equal(addEvs(full, { spe: 3 }), full, 'the same object when nothing fits');

    const even = { baseExp: 112, defeatedLevel: 50, level: 50, participated: true };
    assert.equal(expGain({ ...even, traded: true }), 1681);
    assert.equal(expGain({ ...even, traded: true, luckyEgg: true }), 2521);

    const learnset = {
        tackle: ['9L1', '8L1'], vinewhip: ['9L3', '8L7'], growth: ['9L6'], leechseed: ['9L9'], toxic: ['9M', '8L50'],
        petaldance: ['9L0'],
    };
    assert.deepEqual(levelUpMoves(learnset, 2, 6), ['vinewhip', 'growth']);
    assert.deepEqual(levelUpMoves(learnset, 6, 6), []);
    assert.deepEqual(levelUpMoves(learnset, -1, 0), ['petaldance'], 'moves learned on evolving');
    assert.deepEqual(levelUpMoves(learnset, 6, 60, 8), ['vinewhip', 'toxic'], 'another generation');
    assert.deepEqual(levelUpMoves({ tackle: ['7L1'], harden: ['7L4', '6L5'] }, 1, 9), ['harden'], 'newest generation that has any');
    assert.deepEqual(levelUpMoves(undefined, 1, 100), []);
});

test('GameState: the move bank', () =>
{
    const state = GameState.create();
    state.addToParty(pikachu(0, { moves: ['thundershock', 'growl', 'tailwhip'], moveBank: ['nuzzle'] }));
    const moves = () => state.getSnapshot().party[0].moves.map((move) => move.id);
    const bank = () => state.getSnapshot().party[0].moveBank;

    assert.equal(state.learnMove('pika0', 'quickattack'), 'moves');
    assert.equal(state.learnMove('pika0', 'thunderwave'), 'bank', 'the four slots are taken');
    assert.equal(state.learnMove('pika0', 'growl'), null, 'already ready');
    assert.equal(state.learnMove('pika0', 'nuzzle'), null, 'already in the bank');
    assert.deepEqual([moves(), bank()], [['thundershock', 'growl', 'tailwhip', 'quickattack'], ['nuzzle', 'thunderwave']]);

    assert.equal(state.relearnMove('pika0', 'nuzzle'), false, 'no free slot and nothing to replace');
    assert.equal(state.relearnMove('pika0', 'surf', 'growl'), false, 'not in the bank');
    assert.equal(state.relearnMove('pika0', 'nuzzle', 'surf'), false, 'not a ready move');
    state.updatePokemon('pika0', (p) => ({ ...p, moves: p.moves.map((move) => ({ ...move, pp: 1, ppUps: 2 })) }));
    assert.equal(state.relearnMove('pika0', 'nuzzle', 'growl'), true);
    assert.deepEqual([moves(), bank()], [['thundershock', 'nuzzle', 'tailwhip', 'quickattack'], ['thunderwave', 'growl']]);
    assert.deepEqual(state.getSnapshot().party[0].moves[1], { id: 'nuzzle', ppUps: 0 }, 'a relearned move has full PP');

    assert.equal(state.forgetMove('pika0', 'tailwhip'), true);
    assert.equal(state.forgetMove('pika0', 'surf'), false);
    assert.equal(state.relearnMove('pika0', 'growl'), true, 'a free slot needs no replacement');
    assert.deepEqual([moves(), bank()], [['thundershock', 'nuzzle', 'quickattack', 'growl'], ['thunderwave', 'tailwhip']]);

    for (const move of ['nuzzle', 'quickattack', 'growl']) assert.equal(state.forgetMove('pika0', move), true);
    assert.equal(state.forgetMove('pika0', 'thundershock'), false, 'the last move cannot be forgotten');
});

test('evolution: conditions for evolving on level-up', () =>
{
    const eevee = pikachu(0, { species: 'eevee', level: 20, friendship: 200, moves: ['tackle', 'babydolleyes'] });
    const methods = [
        { into: 'vaporeon', trigger: 'use-item', item: 'waterstone' },
        { into: 'espeon', trigger: 'level-up', timeOfDay: 'day' as const, minHappiness: 160 },
        { into: 'umbreon', trigger: 'level-up', timeOfDay: 'night' as const, minHappiness: 160 },
        { into: 'sylveon', trigger: 'level-up', knownMoveType: 'Fairy', minHappiness: 160 },
    ];
    const moveType = (move: string) => (move === 'babydolleyes' ? 'Fairy' : 'Normal');
    assert.equal(findEvolution(eevee, methods), null, 'nothing can be checked without a context');
    assert.equal(findEvolution(eevee, methods, { timeOfDay: 'night' }), 'umbreon');
    assert.equal(findEvolution(eevee, methods, { timeOfDay: 'day', moveType }), 'espeon', 'the first that applies');
    assert.equal(findEvolution(eevee, methods, { moveType }), 'sylveon');
    assert.equal(findEvolution({ ...eevee, friendship: 100 }, methods, { timeOfDay: 'day', moveType }), null);
    assert.equal(findEvolution({ ...eevee, item: 'everstone' }, methods, { timeOfDay: 'day' }), null);
    assert.equal(findEvolution(eevee, undefined), null);

    const level = [{ into: 'charmeleon', trigger: 'level-up', minLevel: 16 }];
    assert.equal(findEvolution({ ...eevee, level: 15 }, level), null);
    assert.equal(findEvolution({ ...eevee, level: 16 }, level), 'charmeleon');

    const tyrogue = [
        { into: 'hitmonlee', trigger: 'level-up', minLevel: 20, relativePhysicalStats: 1 },
        { into: 'hitmonchan', trigger: 'level-up', minLevel: 20, relativePhysicalStats: -1 },
        { into: 'hitmontop', trigger: 'level-up', minLevel: 20, relativePhysicalStats: 0 },
    ];
    assert.equal(findEvolution(eevee, tyrogue), null);
    assert.equal(findEvolution(eevee, tyrogue, { stats: { atk: 30, def: 40 } }), 'hitmonchan');
    assert.equal(findEvolution(eevee, tyrogue, { stats: { atk: 40, def: 40 } }), 'hitmontop');

    const gendered = [{ into: 'gallade', trigger: 'level-up', minLevel: 20, gender: 'M' as const }];
    assert.equal(findEvolution({ ...eevee, gender: 'F' }, gendered), null);
    assert.equal(findEvolution({ ...eevee, gender: 'M' }, gendered), 'gallade');

    const mantyke = [{ into: 'mantine', trigger: 'level-up', partySpecies: 'remoraid' }];
    assert.equal(findEvolution(eevee, mantyke, { party: [eevee] }), null);
    assert.equal(findEvolution(eevee, mantyke, { party: [eevee, pikachu(1, { species: 'remoraid' })] }), 'mantine');

    //  Conditions only the overworld can check are never met here.
    assert.equal(findEvolution(eevee, [{ into: 'leafeon', trigger: 'level-up', location: 'eterna-forest' }]), null);
    assert.equal(findEvolution(eevee, [{ into: 'goodra', trigger: 'level-up', minLevel: 5, needsOverworldRain: true }]), null);

    assert.equal(evolvedAbility({ 0: 'Shield Dust', H: 'Run Away' }, { 0: 'Shed Skin' }, 'runaway'), 'shedskin');
    assert.equal(evolvedAbility({ 0: 'Static', H: 'Lightning Rod' }, { 0: 'Static', H: 'Lightning Rod' }, 'lightningrod'), 'lightningrod');
});

test('partyBattle: needs a Pokémon that can fight', () =>
{
    const state = GameState.create();
    assert.throws(() => partyBattle(state), /no Pokémon that can fight/);
    state.addToParty(pikachu(0));
    state.updatePokemon('pika0', { hp: 0 });
    assert.throws(() => partyBattle(state), /no Pokémon that can fight/);
});

test('language: chosen at the start, saved, and never changed', () =>
{
    const state = GameState.create({ name: 'Rojo', language: 'es-mx' });
    assert.equal(state.language, 'es-mx');
    assert.equal(Object.getOwnPropertyDescriptor(GameState.prototype, 'language')?.set, undefined, 'there is no setter');
    const copy = GameState.fromJSON(JSON.parse(JSON.stringify(state.toJSON())));
    assert.equal(copy.language, 'es-mx');
    assert.throws(() => GameState.fromJSON({ ...state.toJSON(), language: 'ja' }), /language/, 'Japanese is a Pokémon language, not a game language');
    assert.throws(() => GameState.fromJSON({ ...state.toJSON(), language: undefined }), /language/);
});

test('Pokémon languages: own catches take the game\'s, traded ones keep theirs; the Pokédex unlocks each', () =>
{
    const state = GameState.create({ name: 'Red', trainerId: 1, language: 'de' });
    state.addToParty(createPokemon({ species: 'eevee', level: 5, ability: 'runaway', moves: ['tackle'] }));
    state.addToParty(createPokemon({ species: 'eevee', level: 5, ability: 'runaway', moves: ['tackle'], language: 'ja', ot: { name: 'Satoshi', id: 2 } }));
    state.addToParty(createPokemon({ species: 'eevee', level: 5, ability: 'runaway', moves: ['tackle'], language: 'ja', ot: { name: 'Satoshi', id: 2 } }));
    assert.deepEqual(state.getSnapshot().party.map((p) => p.language), ['de', 'ja', 'ja']);
    assert.deepEqual(state.getPokedexEntry('eevee'), { seen: true, owned: true, languages: ['de', 'ja'] });
    assert.deepEqual(state.pokedexLanguages('eevee'), ['de', 'ja']);

    state.markSeen('pidgey');
    assert.deepEqual(state.getPokedexEntry('pidgey'), { seen: true, owned: false, languages: [] });
    assert.deepEqual(state.pokedexLanguages('pidgey'), ['de'], 'a seen species shows the game\'s language');
    assert.deepEqual(state.pokedexLanguages('mew'), []);

    //  Evolving registers the new species in the Pokémon's language.
    const traded = state.getSnapshot().party[1];
    state.updatePokemon(traded.uid, { species: 'vaporeon' });
    assert.deepEqual(state.pokedexLanguages('vaporeon'), ['de', 'ja']);
    assert.deepEqual(GameState.fromJSON(state.toJSON()).getPokedexEntry('vaporeon').languages, ['ja']);
});
