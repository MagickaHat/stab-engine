/**
 * @file state.test.ts
 * @brief Tests for the game state and save system. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BattleBridge } from '../battle/bridge/BattleBridge.ts';
import type { BattleSnapshot } from '../battle/bridge/snapshot.ts';
import { importTeam, SAMPLE_TEAM_P2 } from '../battle/teams.ts';
import { partyBattle } from './battle.ts';
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
        slot: 1, savedAt: '2026-01-02T03:04:05.000Z', playerName: 'Red', playTimeMs: 90_000,
        map: 'route1', party: [{ species: 'pikachu', level: 50 }],
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

test('partyBattle: needs a Pokémon that can fight', () =>
{
    const state = GameState.create();
    assert.throws(() => partyBattle(state), /no Pokémon that can fight/);
    state.addToParty(pikachu(0));
    state.updatePokemon('pika0', { hp: 0 });
    assert.throws(() => partyBattle(state), /no Pokémon that can fight/);
});
