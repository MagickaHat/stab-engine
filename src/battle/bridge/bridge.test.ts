/**
 * @file bridge.test.ts
 * @brief Tests for the battle bridge. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { importTeam, SAMPLE_TEAM_P1, SAMPLE_TEAM_P2 } from '../teams.ts';
import {cryPath, splitSpeciesId, spritePath} from './assets.ts';
import type { AssetManifest } from './assets.ts';
import { BattleBridge } from './BattleBridge.ts';
import type { BattleBridgeOptions } from './BattleBridge.ts';
import { getActiveBattle, setActiveBattle, subscribeActiveBattle } from './session.ts';
import type { BattleSnapshot } from './snapshot.ts';
import { toStep } from './steps.ts';
import type { BattleStep } from './steps.ts';

/** @brief Options for a seeded sample battle against the random AI. */
function sampleOptions (): BattleBridgeOptions
{
    return {
        p1: { name: 'Player', team: importTeam(SAMPLE_TEAM_P1) },
        p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
        seed: 'gen5,1,2,3,4',
    };
}

/** @brief Answer whatever is being offered with the first valid option. */
function answer (bridge: BattleBridge, snapshot: BattleSnapshot): void
{
    const choice = snapshot.choice;
    if (!choice) return;
    if (choice.kind === 'team') bridge.chooseTeam();
    else if (choice.kind === 'switch') bridge.chooseSwitch(choice.switches.find((s) => !s.disabled)!.slot);
    else bridge.chooseMove(choice.moves.find((m) => !m.disabled)!.slot);
}

/** @brief Resolve once the bridge reaches a phase. */
function reach (bridge: BattleBridge, phase: BattleSnapshot['phase']): Promise<BattleSnapshot>
{
    return new Promise((resolve) =>
    {
        const check = () =>
        {
            const snapshot = bridge.getSnapshot();
            if (snapshot.phase !== phase) return false;
            resolve(snapshot);
            return true;
        };
        if (check()) return;
        const stop = bridge.subscribe(() => { if (check()) stop(); });
    });
}

test('toStep: common lines', () =>
{
    const damage = toStep('|-damage|p2a: Gengar|120/261 par|[from] item: Life Orb');
    assert.ok(damage && damage.kind === 'damage');
    assert.deepEqual(damage.pokemon, { side: 'p2', position: 'a', name: 'Gengar', ident: 'p2a: Gengar', slot: 0 });
    assert.deepEqual(damage.hp, { hp: 120, maxhp: 261, status: 'par' });
    assert.equal(damage.from, 'item: Life Orb');

    const sent = toStep('|drag|p1b: Sparky|Pikachu, L50, M, shiny|95/95');
    assert.ok(sent && sent.kind === 'switch');
    assert.equal(sent.drag, true);
    assert.equal(sent.pokemon.slot, 1);
    assert.equal(sent.details, 'Pikachu, L50, M, shiny');

    const move = toStep('|move|p1a: Pikachu|Thunderbolt|p2a: Blastoise|[miss]');
    assert.ok(move && move.kind === 'move');
    assert.equal(move.target?.side, 'p2');
    assert.equal(move.missed, true);
    assert.equal(move.text, 'Pikachu used Thunderbolt!');

    const drop = toStep('|-unboost|p2a: Blastoise|atk|2');
    assert.ok(drop && drop.kind === 'boost');
    assert.equal(drop.amount, -2);

    const end = toStep('|tie');
    assert.ok(end && end.kind === 'end');
    assert.equal(end.winner, null);

    const other = toStep('|-sidestart|p1: Player|move: Stealth Rock');
    assert.ok(other && other.kind === 'other');
    assert.equal(other.line.cmd, '-sidestart');

    for (const silent of ['', '|', '|t:|1700000000', '|upkeep', '|request|{}', 'plain text'])
    {
        assert.equal(toStep(silent), null, silent);
    }
});

test('BattleBridge: plays a whole battle step by step', async () =>
{
    const bridge = new BattleBridge(sampleOptions());
    assert.equal(bridge.getSnapshot().phase, 'idle');

    const steps: BattleStep[] = [];
    let showing = 0;
    let offeredWhileShowing = false;
    let hpMismatch = '';

    bridge.setPresenter(async (step, snapshot) =>
    {
        showing++;
        steps.push(step);
        assert.equal(snapshot.phase, 'presenting');
        assert.equal(snapshot.step, step);
        assert.equal(snapshot.choice, null);
        //  The snapshot is exactly as far as the step: no later damage has leaked in.
        if (step.kind === 'damage' || step.kind === 'heal')
        {
            const side = step.pokemon.side === snapshot.player ? snapshot.me : snapshot.foe;
            const shown = side.active[step.pokemon.slot];
            if (shown?.hp !== step.hp.hp) hpMismatch = `${step.line.raw} but snapshot has ${shown?.hp}`;
        }
        //  Really asynchronous, so the simulator runs ahead of the presentation.
        await new Promise((resolve) => setImmediate(resolve));
        showing--;
    });

    let choices = 0;
    bridge.subscribe(() =>
    {
        const snapshot = bridge.getSnapshot();
        if (snapshot.phase !== 'choosing') return;
        if (showing > 0) offeredWhileShowing = true;
        choices++;
        //  Answer later, like a player would.
        setImmediate(() => answer(bridge, bridge.getSnapshot()));
    });

    bridge.start();
    const final = await reach(bridge, 'ended');

    assert.equal(offeredWhileShowing, false, 'a choice was offered during a step');
    assert.equal(hpMismatch, '');
    assert.ok(choices > 2, 'the player was asked to choose');
    assert.ok(final.winner === 'Player' || final.winner === 'Rival');
    assert.equal(final.choice, null);
    assert.equal(steps.at(-1)?.kind, 'end');
    assert.ok(final.turn >= 1);

    const kinds = new Set(steps.map((step) => step.kind));
    for (const kind of ['switch', 'move', 'damage', 'faint', 'turn', 'end'] as const)
    {
        assert.ok(kinds.has(kind), `no "${kind}" step`);
    }

    //  The loser's active Pokémon is down and both sides were tracked.
    const loser = final.winner === 'Player' ? final.foe : final.me;
    assert.ok(loser.team.every((pokemon) => pokemon.fainted));
    assert.equal(final.me.name, 'Player');
    assert.equal(final.me.team.length, 3);

    bridge.destroy();
});

test('BattleBridge: snapshot describes the field and the choice', async () =>
{
    const bridge = new BattleBridge(sampleOptions());
    bridge.start();

    const preview = await reach(bridge, 'choosing');
    assert.equal(preview.choice?.kind, 'team');
    assert.ok(preview.choice.switches.every((s) => !s.disabled));
    assert.equal(bridge.getSnapshot(), preview, 'snapshot is stable until something changes');
    bridge.chooseTeam([2, 1, 3]);
    assert.equal(bridge.getSnapshot().phase, 'waiting');

    const turn = await reach(bridge, 'choosing');
    assert.equal(turn.choice?.kind, 'move');
    assert.equal(turn.turn, 1);
    const lead = turn.me.active[0];
    assert.ok(lead);
    assert.equal(lead.ident, turn.choice.switches[0].ident);
    assert.equal(lead.active, true);
    assert.equal(lead.speciesId, lead.baseSpeciesId + lead.formeId);
    assert.ok(lead.maxhp > 100 && lead.hp === lead.maxhp);
    assert.equal(turn.choice.switches[0].disabled, true, 'the active Pokémon cannot be switched to');
    assert.equal(turn.choice.switches[1].disabled, false);
    assert.equal(turn.choice.moves.length, 4);
    assert.deepEqual(turn.choice.moves.map((m) => m.slot), [1, 2, 3, 4]);
    assert.ok(turn.foe.active[0]);
    assert.equal(turn.foe.totalPokemon, 3);

    bridge.destroy();
});

test('BattleBridge: a rejected choice is offered again with an error', async () =>
{
    const bridge = new BattleBridge(sampleOptions());
    bridge.start();
    await reach(bridge, 'choosing');
    bridge.chooseTeam();
    await reach(bridge, 'choosing');

    bridge.chooseSwitch(1); // already on the field
    assert.equal(bridge.getSnapshot().phase, 'waiting');
    const again = await reach(bridge, 'choosing');
    assert.match(again.error ?? '', /Can't switch/);
    assert.equal(again.choice?.kind, 'move');

    bridge.chooseMove(1);
    assert.equal(bridge.getSnapshot().error, null);
    //  The battle moved on: a new decision (next turn, or a forced switch) without the error.
    const next = await reach(bridge, 'choosing');
    assert.equal(next.error, null);
    assert.notEqual(next.choice?.request, again.choice.request);

    bridge.destroy();
});

test('BattleBridge: forfeit ends the battle, destroy silences it', async () =>
{
    const bridge = new BattleBridge(sampleOptions());
    bridge.start();
    await reach(bridge, 'choosing');
    bridge.forfeit();
    const final = await reach(bridge, 'ended');
    assert.equal(final.winner, 'Rival');

    let calls = 0;
    bridge.subscribe(() => calls++);
    bridge.destroy();
    bridge.chooseMove(1);
    bridge.forfeit();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 0);
});

test('BattleBridge: the other side can be driven by code', async () =>
{
    const options = sampleOptions();
    options.p2 = { ...options.p2, ai: false };
    const bridge = new BattleBridge(options);
    let asked = 0;
    bridge.onOpponentRequest = (side, request) =>
    {
        asked++;
        assert.equal(side, 'p2');
        if (!request.wait) bridge.engine.choose(side, 'default');
    };
    bridge.subscribe(() => answer(bridge, bridge.getSnapshot()));
    bridge.start();
    await reach(bridge, 'ended');
    assert.ok(asked > 2);
    bridge.destroy();
});

test('BattleBridge: follows a Mega Evolution', async () =>
{
    const bridge = new BattleBridge({
        p1: { name: 'Player', team: importTeam('Charizard @ Charizardite X\nAbility: Blaze\nLevel: 50\n- Dragon Claw') },
        p2: { name: 'Rival', team: importTeam('Snorlax\nAbility: Immunity\nLevel: 50\n- Splash'), ai: 'random' },
        seed: 'gen5,1,2,3,4',
    });
    const formes: string[] = [];
    bridge.setPresenter((step, snapshot) =>
    {
        if (step.kind === 'formechange') formes.push(`${snapshot.me.active[0]?.baseSpeciesId}/${snapshot.me.active[0]?.formeId}`);
    });
    bridge.start();
    await reach(bridge, 'choosing');
    bridge.chooseTeam();
    const turn = await reach(bridge, 'choosing');
    assert.equal(turn.choice?.canMegaEvo, true);
    bridge.chooseMove(1, 'mega');
    const next = await reach(bridge, 'choosing');
    assert.deepEqual(formes, ['charizard/megax']);
    assert.equal(next.me.active[0]?.speciesId, 'charizardmegax');
    bridge.destroy();
});

test('BattleBridge: rejects options it cannot present', () =>
{
    assert.throws(() => new BattleBridge({ ...sampleOptions(), perspective: 'spectator' }), /perspective/);
    assert.throws(() => new BattleBridge({ ...sampleOptions(), perspective: 'p2' }), /local player/);
});

test('session: tracks the active battle', () =>
{
    const bridge = new BattleBridge(sampleOptions());
    let calls = 0;
    const stop = subscribeActiveBattle(() => calls++);
    setActiveBattle(bridge);
    setActiveBattle(bridge);
    assert.equal(getActiveBattle(), bridge);
    setActiveBattle(null);
    assert.equal(getActiveBattle(), null);
    assert.equal(calls, 2);
    stop();
    setActiveBattle(bridge);
    assert.equal(calls, 2);
    setActiveBattle(null);
    bridge.destroy();
});

test('assets: sprite and cry lookup', () =>
{
    const manifest: AssetManifest = {
        pokemon: {
            charizard: {
                files: { 'front.png': [96, 96], 'back.png': [96, 96], 'front_shiny.png': [96, 96] },
                formes: { megax: { 'front.png': [96, 96] } },
            },
            abomasnow: { files: { 'front.png': [96, 96], 'frontf.png': [96, 96], 'frontf_shiny.png': [96, 96], 'front_shiny.png': [96, 96] } },
        },
        cries: ['charizard', 'charizardmegax', 'abomasnow'],
    };
    const charizard = { baseSpeciesId: 'charizard', formeId: '' };
    const megaX = { baseSpeciesId: 'charizard', formeId: 'megax' };

    assert.equal(spritePath(manifest, charizard, 'front'), 'img/pokemon/charizard/front.png');
    assert.equal(spritePath(manifest, megaX, 'front'), 'img/pokemon/charizard/megax/front.png');
    //  No back sprite for the forme: use the base species'.
    assert.equal(spritePath(manifest, megaX, 'back'), 'img/pokemon/charizard/back.png');
    //  A shiny base sprite beats a non-shiny forme sprite; no shiny back at all → normal back.
    assert.equal(spritePath(manifest, { ...megaX, shiny: true }, 'front'), 'img/pokemon/charizard/front_shiny.png');
    assert.equal(spritePath(manifest, { ...charizard, shiny: true }, 'back'), 'img/pokemon/charizard/back.png');
    assert.equal(spritePath(manifest, { baseSpeciesId: 'abomasnow', formeId: '', gender: 'F' }, 'front'), 'img/pokemon/abomasnow/frontf.png');
    assert.equal(spritePath(manifest, { baseSpeciesId: 'abomasnow', formeId: '', gender: 'F', shiny: true }, 'front'), 'img/pokemon/abomasnow/frontf_shiny.png');
    assert.equal(spritePath(manifest, { ...charizard, gender: 'F' }, 'front'), 'img/pokemon/charizard/front.png');
    assert.equal(spritePath(manifest, { baseSpeciesId: 'missingno', formeId: '' }, 'front'), null);

    assert.equal(cryPath(manifest, megaX), 'sound/se/cries/charizardmegax.ogg');
    assert.equal(cryPath(manifest, { baseSpeciesId: 'abomasnow', formeId: 'mega' }), 'sound/se/cries/abomasnow.ogg');
    assert.equal(cryPath(manifest, { baseSpeciesId: 'missingno', formeId: '' }), null);
});

test('assets: the sample teams have sprites and cries in the real manifest', () =>
{
    const manifest = JSON.parse(fs.readFileSync(new URL('../../../public/assets/manifest.json', import.meta.url), 'utf8')) as AssetManifest;
    for (const id of ['pikachu', 'charizard', 'blastoise', 'gengar'])
    {
        const pokemon = { baseSpeciesId: id, formeId: '' };
        for (const facing of ['front', 'back'] as const)
        {
            const file = spritePath(manifest, pokemon, facing);
            assert.ok(file && fs.existsSync(new URL(`../../../public/assets/${file}`, import.meta.url)), `${id} ${facing}`);
        }
        const cry = cryPath(manifest, pokemon);
        assert.ok(cry && fs.existsSync(new URL(`../../../public/assets/${cry}`, import.meta.url)), `${id} cry`);
    }
});

test('assets: icons come from the species folder, and save species IDs split into species and forme', () => {
    const manifest =
        JSON.parse(fs.readFileSync(new URL('../../../public/assets/manifest.json', import.meta.url), 'utf8')) as
        AssetManifest;
    assert.deepEqual(splitSpeciesId(manifest, 'cyndaquil'), { baseSpeciesId: 'cyndaquil', formeId: '' });
    assert.deepEqual(splitSpeciesId(manifest, 'absolmega'), { baseSpeciesId: 'absol', formeId: 'mega' });
    assert.deepEqual(splitSpeciesId(manifest, 'missingno'), { baseSpeciesId: 'missingno', formeId: '' });
    assert.equal(
        spritePath(manifest, { baseSpeciesId: 'cyndaquil', formeId: '' }, 'icon'), 'img/pokemon/cyndaquil/icon.png');
    assert.equal(
        spritePath(manifest, { baseSpeciesId: 'cyndaquil', formeId: '', shiny: true }, 'icon'),
        'img/pokemon/cyndaquil/icon_shiny.png');
    assert.equal(spritePath(manifest, { baseSpeciesId: 'missingno', formeId: '' }, 'icon'), null);
});
