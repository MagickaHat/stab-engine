/**
 * @file title.test.ts
 * @brief Tests for the intro and title screen: config, timing, the movie probe
 *        and the New Game / Continue requests. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {EventBus, GameEvents} from '../../bus/EventBus.ts';
import {SaveError} from '../../state/SaveManager.ts';
import type {SaveSummary, SlotInfo} from '../../state/SaveManager.ts';
import {findMovie} from './movie.ts';
import type {MovieProbe} from './movie.ts';
import {continueSlots, playMovie, showLoadMenu} from './requests.ts';
import type {LoadMenuRequest} from './requests.ts';
import {blinkVisible, bobOffset, formatPlayTime, scrollOffset} from './timing.ts';
import {NEW_GAME, OPENING_MOVIE, SPLASHES, TITLE_SCREEN, titleImages} from './titleConfig.ts';

/** @brief A file under public/ exists. */
const inPublic = (path: string) => fs.existsSync(new URL(`../../../public/${path}`, import.meta.url));

/** @brief A readable slot saved at `savedAt`. */
function saved(slot: number, savedAt: string): SlotInfo
{
    const summary: SaveSummary = {
        slot,
        savedAt,
        playerName: 'Red',
        playTimeMs: 0,
        map: 'intro',
        party: [],
        badges: 0,
        pokedexOwned: 0,
        language: 'en',
    };
    return { slot, status: 'ok', summary };
}

test('title config: the shipped splashes and layers use images that exist, and only built-in kinds', () => {
    for (const splash of SPLASHES) assert.ok(inPublic(splash.image), splash.image);
    for (const image of titleImages()) assert.ok(inPublic(image), image);
    for (const layer of TITLE_SCREEN.layers)
        assert.ok(['image', 'blink', 'scroll', 'bob', 'text'].includes(layer.kind), layer.kind);
    assert.deepEqual(titleImages(), ['assets/img/titles/title.png', 'assets/img/titles/start.png']);
    for (const source of OPENING_MOVIE.sources) assert.match(source, /^assets\/video\/intro\.(webm|mp4)$/);
});

test('title config: new games start on a map that exists, on its spawn', () => {
    const map = JSON.parse(fs.readFileSync(new URL(`../../tiled/maps/${NEW_GAME.map}.tmj`, import.meta.url), 'utf8')) as
    {
        layers: { objects?: { name: string; type: string; properties?: { name: string; value: unknown }[] }[] }[];
    };
    const objects = map.layers.flatMap((layer) => layer.objects ?? []);
    assert.ok(objects.some((object) => object.type === 'Spawn' && object.name === NEW_GAME.spawn));
    assert.ok(objects.some(
        (object) => object.type === 'Event'
            && object.properties?.some((p) => p.name === 'script' && p.value === 'intro_professor')));
});

test('timing: blinking, bobbing, scrolling and play time', () => {
    assert.equal(blinkVisible(0, 600, 400), true);
    assert.equal(blinkVisible(599, 600, 400), true);
    assert.equal(blinkVisible(600, 600, 400), false);
    assert.equal(blinkVisible(1000, 600, 400), true);
    assert.equal(blinkVisible(5000, 600, 0), true);

    assert.equal(bobOffset(0, 3, 1000), 0);
    assert.equal(bobOffset(250, 3, 1000), 3);
    assert.equal(bobOffset(750, 3, 1000), -3);
    assert.ok(Number.isInteger(bobOffset(123, 2.5, 1000)));

    assert.equal(scrollOffset(1000, 10, 64), 10);
    assert.equal(scrollOffset(1000, -10, 64), 54);
    assert.equal(scrollOffset(10_000, 10, 64), 100 % 64);

    assert.equal(formatPlayTime(0), '0:00');
    assert.equal(formatPlayTime(59_999), '0:00');
    assert.equal(formatPlayTime(5 * 60_000), '0:05');
    assert.equal(formatPlayTime((12 * 60 + 34) * 60_000 + 999), '12:34');
    assert.equal(formatPlayTime(-5), '0:00');
});

test('movie: the first file that exists and can be played is used; none means no movie', async () => {
    const probe = (files: string[], playable = ['video/webm', 'video/mp4']): MovieProbe => ({
        exists: async (url) => files.includes(url),
        canPlay: (type) => playable.includes(type),
    });
    const sources = ['assets/video/intro.webm', 'assets/video/intro.mp4'];
    const url = (path: string) => `./${path}`;
    assert.equal(await findMovie(sources, probe([]), url), null);
    assert.equal(await findMovie(sources, probe(['./assets/video/intro.mp4']), url), './assets/video/intro.mp4');
    assert.equal(
        await findMovie(sources, probe(['./assets/video/intro.webm', './assets/video/intro.mp4']), url),
        './assets/video/intro.webm');
    //  A browser that cannot play WebM gets the MP4.
    assert.equal(
        await findMovie(sources, probe(['./assets/video/intro.webm', './assets/video/intro.mp4'], ['video/mp4']), url),
        './assets/video/intro.mp4');
});

test('continue slots: saves first by date, unreadable ones last, empty ones left out', () => {
    const broken: SlotInfo = { slot: 0, status: 'error', error: new SaveError('corrupt', 'bad') };
    const slots: SlotInfo[] =
        [broken, saved(1, '2026-01-01T00:00:00Z'), { slot: 2, status: 'empty' }, saved(3, '2026-02-01T00:00:00Z')];
    assert.deepEqual(continueSlots(slots).map((info) => info.slot), [3, 1, 0]);
});

test('requests: without a UI the movie ends at once and the menu continues the latest save', async () => {
    await playMovie('./assets/video/intro.webm', true);
    assert.deepEqual(await showLoadMenu([{ slot: 0, status: 'empty' }]), { kind: 'newGame' });
    assert.deepEqual(
        await showLoadMenu([saved(0, '2026-01-01T00:00:00Z'), saved(2, '2026-03-01T00:00:00Z')]),
        { kind: 'continue', slot: 2 });
});

test('requests: the UI answers the menu once', async () => {
    const answer = (request: LoadMenuRequest) => {
        request.pick({ kind: 'newGame' });
        request.pick({ kind: 'back' });
    };
    EventBus.on(GameEvents.TITLE_LOAD_MENU, answer);
    try
    {
        assert.deepEqual(await showLoadMenu([saved(0, '2026-01-01T00:00:00Z')]), { kind: 'newGame' });
    }
    finally
    {
        EventBus.off(GameEvents.TITLE_LOAD_MENU, answer);
    }
});
