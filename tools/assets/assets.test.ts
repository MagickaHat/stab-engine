/**
 * @file assets.test.ts
 * @brief Tests for the asset importer. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeBmp } from './bmp.ts';
import {OUTPUT_REDIRECTS, TILESETS_DIR} from './config.ts';
import {outputPath, outputRoot} from './destinations.ts';
import { assetName, excludedBy, formKey, parseAssetName, parseFormNames } from './essentials.ts';
import { chooseFilter, detectScale, reduceAverage, reduceDominant, sampleRegion, transform } from './image.ts';
import { gen9 } from './packs/gen9.ts';
import { graphics } from './packs/graphics.ts';
import { planPack } from './plan.ts';
import { decodePng, encodePng, pngSize } from './png.ts';
import type { Image } from './png.ts';
import { SpeciesResolver, formWords, toID } from './resolve.ts';
import type { DexIndex, DexSpecies } from './resolve.ts';

/**
 * @brief Make a test image where every pixel has its own colour.
 * @param width Width.
 * @param height Height.
 * @param colors Number of distinct colours to cycle through.
 * @return The image (pixel 0 is fully transparent).
 */
function makeImage (width: number, height: number, colors = 1 << 20): Image
{
    const data = new Uint8Array(width * height * 4);
    for (let i = 1; i < width * height; i++)
    {
        const c = i % colors;
        data.set([c & 0xff, (c >> 8) & 0xff, 40 + (c % 7), 255], i * 4);
    }
    return { width, height, data };
}

/**
 * @brief Upscale an image with nearest-neighbour, like resource packs do.
 * @param image Image.
 * @param k Factor.
 * @return The enlarged image.
 */
function upscale (image: Image, k: number): Image
{
    const out = { width: image.width * k, height: image.height * k, data: new Uint8Array(image.width * image.height * k * k * 4) };
    for (let y = 0; y < out.height; y++)
    {
        for (let x = 0; x < out.width; x++)
        {
            const src = (Math.floor(y / k) * image.width + Math.floor(x / k)) * 4;
            out.data.set(image.data.subarray(src, src + 4), (y * out.width + x) * 4);
        }
    }
    return out;
}

/**
 * @brief Build a tiny pokedex for resolver tests.
 * @param entries `[name, extra fields]` pairs.
 * @return A dex index.
 */
function makeDex (entries: [string, Partial<DexSpecies>?][]): DexIndex
{
    return {
        species: Object.fromEntries(entries.map(([name, extra]) => [toID(name), { name, ...extra }])),
        items: new Set(['potion']),
    };
}

test('PNG: palette and RGBA images survive a round trip', () =>
{
    for (const image of [makeImage(7, 5, 3), makeImage(9, 4, 12), makeImage(16, 16, 200), makeImage(40, 40)])
    {
        const file = encodePng(image);
        assert.deepEqual(pngSize(file), [image.width, image.height]);
        assert.deepEqual(decodePng(file), image);
    }
});

test('PNG: few-colour images are written as small palette files', () =>
{
    const file = encodePng(makeImage(96, 96, 15));
    assert.equal(file[25], 3, 'colour type 3 = palette');
    assert.equal(file[24], 4, '16 colours fit in 4 bits');
});

test('PNG: rejects files that are not PNGs', () =>
{
    assert.throws(() => decodePng(Buffer.from('OggS not an image')), /not a PNG/);
    assert.equal(pngSize(Buffer.from('nope')), null);
});

test('image: detects the upscale factor', () =>
{
    const sprite = makeImage(12, 12);
    assert.equal(detectScale(sprite), 1);
    assert.equal(detectScale(upscale(sprite, 2)), 2);
    assert.equal(detectScale(upscale(sprite, 3)), 3);
});

test('image: 2× fronts and 3× backs both become the exact 96×96 original', () =>
{
    const sprite = makeImage(96, 96);
    for (const k of [2, 3])
    {
        const result = transform(upscale(sprite, k), { size: [96, 96] });
        assert.deepEqual(result.image, sprite);
        assert.deepEqual(result.notes, []);
    }
    assert.equal(transform(sprite, { size: [96, 96] }).image, sprite, 'already 96×96: untouched');
});

test('image: art that is not a clean upscale is still resized, and flagged', () =>
{
    const result = transform(makeImage(192, 192), { size: [96, 96] });
    assert.deepEqual([result.image.width, result.image.height], [96, 96]);
    assert.deepEqual(result.notes, ['resampled']);
});

test('image: smaller sprites are placed bottom-centre on the canvas', () =>
{
    const result = transform(upscale(makeImage(80, 80), 2), { size: [96, 96] });
    assert.deepEqual([result.image.width, result.image.height], [96, 96]);
    assert.deepEqual(result.notes, ['padded']);
    assert.equal(result.image.data[(16 * 96 + 9) * 4 + 3], 255, 'sprite pixel (1,0) lands at (9,16)');
    assert.equal(result.image.data[3], 0, 'corner is transparent');
});

test('image: divide halves clean art and leaves odd sizes alone', () =>
{
    const icon = makeImage(24, 24);
    assert.deepEqual(transform(upscale(icon, 2), { divide: 2 }).image, icon);
    assert.deepEqual(transform(makeImage(25, 24), { divide: 2 }).notes, ['odd-size']);
});

test('essentials: file names', () =>
{
    assert.deepEqual(parseAssetName('CHARIZARD'), { id: 'CHARIZARD', form: 0, female: false });
    assert.deepEqual(parseAssetName('SNEASEL_1_female'), { id: 'SNEASEL', form: 1, female: true });
    assert.deepEqual(parseAssetName('NIDORANfE'), { id: 'NIDORANfE', form: 0, female: false });
    assert.equal(parseAssetName('PIKACHU_faint'), null);
    assert.equal(parseAssetName('000_cracks'), null);
    assert.equal(formKey('ROTOM', 2), 'ROTOM_2');
});

test('essentials: form names from PBS text', () =>
{
    const names = parseFormNames('\uFEFF# comment\r\n[GROWLITHE,1]\r\nFormName = Hisuian\r\nTypes = FIRE,ROCK\r\n#---\r\n[KYUREM,3]\r\n[GIRATINA]\r\nFormName = Altered Forme\r\n');
    assert.deepEqual([...names], [['GROWLITHE_1', 'Hisuian'], ['GIRATINA', 'Altered Forme']]);
});

test('resolve: form names are matched to Showdown formes', () =>
{
    const dex = makeDex([
        ['Growlithe'], ['Growlithe-Hisui', { baseSpecies: 'Growlithe', forme: 'Hisui' }],
        ['Charizard'], ['Charizard-Mega-X', { baseSpecies: 'Charizard', forme: 'Mega-X' }], ['Charizard-Mega-Y', { baseSpecies: 'Charizard', forme: 'Mega-Y' }],
        ['Darmanitan', { baseForme: 'Standard' }], ['Darmanitan-Zen', { baseSpecies: 'Darmanitan', forme: 'Zen' }],
        ['Darmanitan-Galar', { baseSpecies: 'Darmanitan', forme: 'Galar' }], ['Darmanitan-Galar-Zen', { baseSpecies: 'Darmanitan', forme: 'Galar-Zen' }],
        ['Pumpkaboo', { baseForme: 'Average' }], ['Pumpkaboo-Small', { baseSpecies: 'Pumpkaboo', forme: 'Small' }],
        ['Tauros'], ['Tauros-Paldea-Combat', { baseSpecies: 'Tauros', forme: 'Paldea-Combat' }],
        ['Unown', { baseForme: 'A', cosmeticFormes: ['Unown-B'] }],
        ['Kyurem'], ['Kyurem-White', { baseSpecies: 'Kyurem', forme: 'White' }],
    ]);
    const names = new Map([
        ['GROWLITHE_1', 'Hisuian'], ['CHARIZARD_1', 'Mega Charizard X'], ['CHARIZARD_2', 'Mega Charizard Y'],
        ['DARMANITAN', 'Standard Mode'], ['DARMANITAN_1', 'Zen Mode'], ['DARMANITAN_2', 'Galarian Standard Mode'], ['DARMANITAN_3', 'Galarian Zen Mode'],
        ['PUMPKABOO', 'Small Size'], ['PUMPKABOO_1', 'Average Size'], ['TAUROS_1', 'Paldean (Combat Breed)'],
        ['UNOWN', 'A'], ['UNOWN_1', 'B'], ['KYUREM_1', 'White Kyurem'],
    ]);
    const pairs = [...names.keys(), 'GROWLITHE', 'CHARIZARD', 'KYUREM', 'KYUREM_3', 'MISSINGNO'].map((key) =>
    {
        const [id, form] = key.split('_');
        return { id, form: Number(form ?? 0) };
    });
    const where = new SpeciesResolver(dex, names, {}).assign(pairs);
    const folder = (key: string) => `${where.get(key)!.species}/${where.get(key)!.forme}`;

    assert.equal(folder('GROWLITHE'), 'growlithe/');
    assert.equal(folder('GROWLITHE_1'), 'growlithe/hisui');
    assert.equal(folder('CHARIZARD_1'), 'charizard/megax');
    assert.equal(folder('CHARIZARD_2'), 'charizard/megay');
    assert.equal(folder('DARMANITAN'), 'darmanitan/');
    assert.equal(folder('DARMANITAN_2'), 'darmanitan/galar');
    assert.equal(folder('DARMANITAN_3'), 'darmanitan/galarzen');
    assert.equal(folder('TAUROS_1'), 'tauros/paldeacombat');
    assert.equal(folder('UNOWN_1'), 'unown/b');
    // Essentials' form 0 is Showdown's "Small" forme; form 1 is Showdown's base.
    assert.equal(folder('PUMPKABOO'), 'pumpkaboo/small');
    assert.equal(folder('PUMPKABOO_1'), 'pumpkaboo/');
    // Unnamed forms are never guessed.
    assert.equal(folder('KYUREM_3'), 'kyurem/form3');
    assert.equal(where.get('KYUREM_3')!.how, 'unresolved');
    assert.equal(where.get('MISSINGNO')!.known, false);
});

test('resolve: aliases win, and two forms never share a folder', () =>
{
    const dex = makeDex([['Zygarde', { baseForme: '50' }], ['Zygarde-Complete', { baseSpecies: 'Zygarde', forme: 'Complete' }], ['Nidoran-F'], ['Maushold']]);
    const names = new Map([['ZYGARDE_2', 'Complete Forme'], ['ZYGARDE_3', 'Complete Forme']]);
    const where = new SpeciesResolver(dex, names, { NIDORANfE: 'nidoranf', MAUSHOLD: 'maushold/four', MAUSHOLD_1: 'maushold' }).assign([
        { id: 'ZYGARDE', form: 0 }, { id: 'ZYGARDE', form: 2 }, { id: 'ZYGARDE', form: 3 },
        { id: 'NIDORANfE', form: 0 }, { id: 'MAUSHOLD', form: 0 }, { id: 'MAUSHOLD', form: 1 },
    ]);
    assert.equal(where.get('ZYGARDE_2')!.forme, 'complete');
    assert.equal(where.get('ZYGARDE_3')!.forme, 'form3');
    assert.equal(where.get('NIDORANfE')!.species, 'nidoranf');
    assert.deepEqual([where.get('MAUSHOLD')!.forme, where.get('MAUSHOLD_1')!.forme], ['four', '']);
});

test('resolve: words are compared the way Showdown writes them', () =>
{
    assert.deepEqual(formWords('Paldean (Combat Breed)'), ['paldea', 'combat', 'breed']);
    assert.deepEqual(formWords("Pa'u Style"), ['pau', 'style']);
    assert.deepEqual(formWords('10% Forme'), ['10', 'forme']);
});

test('gen9 pack: Alcremie, Minior and item names', () =>
{
    const alcremie = gen9.forms!.ALCREMIE as (form: number) => string | undefined;
    assert.equal(alcremie(0), 'alcremie');
    assert.equal(alcremie(1), 'alcremie/vanillacreamberrysweet');
    assert.equal(alcremie(7), 'alcremie/rubycreamstrawberrysweet');
    assert.equal(alcremie(62), 'alcremie/rainbowswirlribbonsweet');
    assert.equal(alcremie(63), undefined);
    const minior = gen9.forms!.MINIOR as (form: number) => string | undefined;
    assert.deepEqual([minior(0), minior(7), minior(8), minior(3)], ['minior/meteor', 'minior', 'minior/orange', undefined]);
    assert.equal(gen9.item!('machine_FIRE'), 'tm_fire');
    assert.equal(gen9.item!('machine_tr_WATER'), 'tr_water');
    assert.equal(gen9.item!('back'), null);
    assert.equal(gen9.item!('BLACKAUGURITE'), undefined);
});

test('plan: sprites go to img/pokemon/<species>, cries to one flat sound/se/cries folder', () =>
{
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stab-pack-'));
    try
    {
        for (const file of [
            'Graphics/Pokemon/Front/CHARIZARD.png', 'Graphics/Pokemon/Front/CHARIZARD_1.png', 'Graphics/Pokemon/Back shiny/UNFEZANT_female.png',
            'Audio/SE/Cries/CHARIZARD.ogg', 'Audio/SE/Cries/CHARIZARD_1.ogg', 'Audio/SE/Cries/KYUREM_3.ogg', 'Graphics/Items/POTION.png',
        ])
        {
            fs.mkdirSync(path.dirname(path.join(packDir, file)), { recursive: true });
            fs.writeFileSync(path.join(packDir, file), '');
        }
        const dex = makeDex([['Charizard'], ['Charizard-Mega-X', { baseSpecies: 'Charizard', forme: 'Mega-X' }], ['Unfezant'], ['Kyurem']]);
        const plan = planPack(packDir, gen9, dex, new Map([['CHARIZARD_1', 'Mega Charizard X']]));
        assert.deepEqual(plan.files.map((file) => file.dest).sort(), [
            'img/items/potion.png',
            'img/pokemon/charizard/front.png',
            'img/pokemon/charizard/megax/front.png',
            'img/pokemon/unfezant/backf_shiny.png',
            'sound/se/cries/charizard.ogg',
            'sound/se/cries/charizardmegax.ogg',
            'sound/se/cries/kyuremform3.ogg',
        ]);
    }
    finally
    {
        fs.rmSync(packDir, { recursive: true, force: true });
    }
});

/**
 * @brief Build an image from rows of single-character colour names.
 * @param rows Equal-length strings; `.` is transparent, other characters are colours.
 * @return The image.
 */
function fromRows (rows: string[]): Image
{
    const palette: Record<string, number[]> = { '.': [0, 0, 0, 0], 'k': [0, 0, 0, 255], 'w': [255, 255, 255, 255], 'r': [255, 0, 0, 255], 'g': [0, 160, 0, 255] };
    const data = new Uint8Array(rows.length * rows[0].length * 4);
    rows.forEach((row, y) => [...row].forEach((c, x) => data.set(palette[c], (y * row.length + x) * 4)));
    return { width: rows[0].length, height: rows.length, data };
}

test('image: dominant keeps the main colour of each block and never invents one', () =>
{
    const image = fromRows([
        'wwkk',
        'wkkk',
        'gggg',
        'grgg',
    ]);
    assert.deepEqual(reduceDominant(image, 2), fromRows(['wk', 'gg']));
    // A thin black line through white survives a 2-2 tie: it is the rarer colour around the block.
    const line = fromRows([
        'wwwwww',
        'wwwwww',
        'wwkkww',
        'wwwwww',
        'wwwwww',
        'wwwwww',
    ]);
    assert.deepEqual(reduceDominant(line, 2), fromRows(['www', 'wkw', 'www']));
});

test('image: average blends by alpha, so transparent pixels do not darken edges', () =>
{
    const image = fromRows(['w.', '..']);
    const out = reduceAverage(image, 2);
    assert.deepEqual([...out.data], [255, 255, 255, 64]);
});

test('image: auto treats gradients as soft art and small palettes as pixel art', () =>
{
    const gradient: Image = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
    for (let i = 0; i < 32 * 32; i++) gradient.data.set([i % 256, i % 256, (i * 3) % 256, 255], i * 4);
    assert.equal(chooseFilter(gradient, 2), 'average');
    assert.equal(chooseFilter(makeImage(32, 32, 8), 2), 'dominant');
});

test('image: filtered divide is lossless on clean art and evens odd sizes', () =>
{
    const sprite = makeImage(10, 6, 30);
    assert.deepEqual(transform(upscale(sprite, 2), { divide: 2, filter: 'auto' }), { image: sprite, notes: [] });
    const odd = transform(makeImage(5, 3, 3), { divide: 2, filter: 'dominant' });
    assert.deepEqual([odd.image.width, odd.image.height], [3, 2]);
    assert.deepEqual(odd.notes, ['evened', 'resampled']);
});

test('BMP: 24-bit bottom-up and 32-bit bitfield bitmaps with alpha', () =>
{
    /** Build a 2×2 bitmap: header of `size` bytes (masks stored right after the first 40). */
    const bitmap = (size: number, bits: number, compression: number, masks: number[], pixels: number[]) =>
    {
        const info = Buffer.alloc(size);
        info.writeUInt32LE(size, 0);
        info.writeInt32LE(2, 4);
        info.writeInt32LE(2, 8); // positive height: rows stored bottom-up
        info.writeUInt16LE(1, 12);
        info.writeUInt16LE(bits, 14);
        info.writeUInt32LE(compression, 16);
        masks.forEach((mask, i) => info.writeUInt32LE(mask, 40 + i * 4));
        const head = Buffer.alloc(14);
        head.write('BM', 0, 'latin1');
        head.writeUInt32LE(14 + size, 10);
        return Buffer.concat([head, info, Buffer.from(pixels)]);
    };
    // 24-bit BGR, rows padded to 4 bytes. Stored: bottom row (blue, green), then top row (red, white).
    const rgb = decodeBmp(bitmap(40, 24, 0, [], [255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0]));
    assert.deepEqual([...rgb.data], [255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 255, 0, 255]);
    // 32-bit with an alpha mask (56-byte header). Stored: bottom row (half-transparent red, clear), top row (two opaque black).
    const argb = decodeBmp(bitmap(56, 32, 3, [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
        [0, 0, 255, 128, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255]));
    assert.deepEqual([...argb.data], [0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0]);
    assert.throws(() => decodeBmp(Buffer.from('not a bitmap at all, sorry')), /not a BMP/);
});

test('essentials: engine names and exclusion patterns', () =>
{
    assert.equal(assetName('Town Map'), 'town_map');
    assert.equal(assetName('trainer_POKEMONTRAINER_Red'), 'trainer_pokemontrainer_red');
    assert.equal(assetName('021-Normal01'), '021_normal01');
    assert.equal(assetName('Pokémon Centre'), 'pokemon_centre');
    assert.equal(assetName('!'), 'exclamation');
    assert.equal(assetName('?!'), 'question_exclamation');
    assert.equal(assetName("PRSFX- King's Shield1"), 'prsfx_kings_shield1');
    assert.equal(assetName(''), null);
    assert.equal(excludedBy('Graphics/UI/Debug/icon.png', ['Graphics/UI/Debug']), 'Graphics/UI/Debug');
    assert.equal(excludedBy('graphics/ui/controls help/a.png', ['Graphics/UI/Controls_help']), 'Graphics/UI/Controls_help');
    assert.equal(excludedBy('Graphics/Windowskins/Window.png', ['Graphics/Windowskins/window']), 'Graphics/Windowskins/window');
    assert.equal(excludedBy('Graphics/Characters/Followers shiny/X.png', ['Graphics/Characters/Followers*']), 'Graphics/Characters/Followers*');
    assert.equal(excludedBy('Graphics/UI/Debugger/a.png', ['Graphics/UI/Debug']), null, 'whole names only');
    assert.equal(excludedBy('Graphics/Windowskins/Window2.png', ['Graphics/Windowskins/Window.png']), null);
});

test('plan: graphics copies Graphics/ into img/ with engine names, minus excluded folders', () =>
{
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stab-pack-'));
    try
    {
        for (const file of [
            'Graphics/Tilesets/Outside.png', 'Graphics/UI/Town Map/mapPlayer000.png', 'Graphics/UI/itemstorage_bg.PNG',
            'Graphics/Characters/NPC 01.png', 'Graphics/Characters/Followers/PIKACHU.png', 'Graphics/Battle animations/ring.bmp',
            'Graphics/Pokemon/Front/PIKACHU.png', 'Graphics/Items/POTION.png', 'Graphics/Animations/Fire1.png',
            'Graphics/UI/Debug/x.png', 'Graphics/UI/Controls help/y.png', 'Graphics/Windowskins/Window.png',
            'Graphics/Windowskins/001-Blue01.png', 'Graphics/Windowskins/choice 1.png', 'Graphics/Titles/notes.txt',
            'Graphics/Titles/Thumbs.db', 'Graphics/Titles/title.png', 'Graphics/Titles/Title.png',
        ])
        {
            fs.mkdirSync(path.dirname(path.join(packDir, file)), { recursive: true });
            fs.writeFileSync(path.join(packDir, file), '');
        }
        const dex: DexIndex = { species: {}, items: new Set() };
        const plan = planPack(packDir, graphics, dex, new Map(), undefined, ['Graphics/Tilesets']);
        assert.deepEqual(plan.files.map((file) => file.dest).sort(), [
            'img/battle_animations/ring.png',
            'img/characters/npc_01.png',
            'img/titles/title.png',
            'img/ui/itemstorage_bg.png',
            'img/ui/town_map/mapplayer000.png',
            'img/windowskins/choice_1.png',
        ]);
        assert.deepEqual(plan.report.skipped, ['Graphics/Titles/notes.txt']);
        assert.equal(plan.report.duplicates.length, 1, 'Title.png and title.png share a name');
        assert.ok(plan.report.excluded.includes('Graphics/Tilesets (1 file)'));
        assert.deepEqual(plan.files.find((f) => f.dest === 'img/battle_animations/ring.png')?.image, { divide: 2, filter: 'auto' });
        assert.ok(plan.kinds.has('ui') && plan.kinds.has('characters') && !plan.kinds.has('tilesets'), 'excluded folders are not offered as kinds');

        const onlyUi = planPack(packDir, graphics, dex, new Map(), new Set(['ui']));
        assert.deepEqual(onlyUi.files.map((file) => file.kind), ['ui', 'ui']);
    }
    finally
    {
        fs.rmSync(packDir, { recursive: true, force: true });
    }
});

/**
 * @brief Copy an image onto a transparent canvas at an offset.
 * @param image Image.
 * @param width Canvas width.
 * @param height Canvas height.
 * @param x Left.
 * @param y Top.
 * @return The canvas.
 */
function place (image: Image, width: number, height: number, x: number, y: number): Image
{
    const data = new Uint8Array(width * height * 4);
    for (let j = 0; j < image.height; j++) data.set(image.data.subarray(j * image.width * 4, (j + 1) * image.width * 4), ((y + j) * width + x) * 4);
    return { width, height, data };
}

test('image: sprite-sheet frames pasted one pixel off the grid are realigned losslessly', () =>
{
    // Two 16×16 frames; each holds a 2× upscaled 4×4 sprite. The second is shifted by (1, 1).
    const sprite = makeImage(4, 4, 9);
    const big = upscale(sprite, 2);
    const sheet: Image = { width: 32, height: 16, data: new Uint8Array(32 * 16 * 4) };
    const a = place(big, 16, 16, 4, 4);
    const b = place(big, 16, 16, 5, 5);
    for (let y = 0; y < 16; y++)
    {
        sheet.data.set(a.data.subarray(y * 64, (y + 1) * 64), y * 128);
        sheet.data.set(b.data.subarray(y * 64, (y + 1) * 64), y * 128 + 64);
    }
    const result = transform(sheet, { divide: 2, filter: 'dominant', align: [16, 16] });
    assert.deepEqual(result.notes, ['realigned'], 'no resampling needed once realigned');
    const expected = place(sprite, 8, 8, 2, 2);
    for (const frame of [0, 1])
    {
        const got = sampleRegion(result.image, frame * 8, 0, 8, 8, 0, 0, 1);
        if (frame === 0) assert.deepEqual(got, expected);
        else assert.deepEqual(got, place(sprite, 8, 8, 3, 3), 'shifted frame lands half a pixel over: one output pixel');
    }
    // Without alignment the shifted frame cannot be reduced cleanly.
    assert.ok(transform(sheet, { divide: 2, filter: 'dominant' }).notes.includes('resampled'));
});

test('image: frames that touch their edge share one grid, so no seams open', () =>
{
    // A full-bleed 2× background shifted by one pixel: realigned as a whole, never per frame.
    const art = upscale(makeImage(10, 10, 6), 2);
    const shifted = sampleRegion(art, 0, 0, 20, 20, 1, 0, 2);
    const result = transform(shifted, { divide: 2, filter: 'dominant', align: [8, 8] });
    assert.deepEqual([result.image.width, result.image.height], [10, 10]);
    assert.ok(result.notes.includes('realigned'));
    assert.ok(!result.notes.includes('resampled'));
});

test('destinations: tileset images are written to the Tiled project, everything else to the output folder', () => {
    const out = path.join(os.tmpdir(), 'assets-out');
    assert.equal(outputPath(out, 'img/tilesets/outside.png', OUTPUT_REDIRECTS), path.join(TILESETS_DIR, 'outside.png'));
    assert.equal(outputRoot(out, 'img/tilesets/outside.png', OUTPUT_REDIRECTS), TILESETS_DIR);
    assert.equal(outputPath(out, 'img/ui/bag/bg.png', OUTPUT_REDIRECTS), path.join(out, 'img/ui/bag/bg.png'));
    //  Only whole folder names match.
    assert.equal(outputPath(out, 'img/tilesets_old/a.png', OUTPUT_REDIRECTS), path.join(out, 'img/tilesets_old/a.png'));
    //  Without redirects (a custom --out) everything stays inside the output folder.
    assert.equal(outputPath(out, 'img/tilesets/outside.png', []), path.join(out, 'img/tilesets/outside.png'));
});
