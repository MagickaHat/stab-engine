/**
 * @file assets.test.ts
 * @brief Tests for the asset importer. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { formKey, parseAssetName, parseFormNames } from './essentials.ts';
import { detectScale, transform } from './image.ts';
import { gen9 } from './packs/gen9.ts';
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
    const alcremie = gen9.forms.ALCREMIE as (form: number) => string | undefined;
    assert.equal(alcremie(0), 'alcremie');
    assert.equal(alcremie(1), 'alcremie/vanillacreamberrysweet');
    assert.equal(alcremie(7), 'alcremie/rubycreamstrawberrysweet');
    assert.equal(alcremie(62), 'alcremie/rainbowswirlribbonsweet');
    assert.equal(alcremie(63), undefined);
    const minior = gen9.forms.MINIOR as (form: number) => string | undefined;
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
            'img/pokemon/charizard/front.png',
            'img/pokemon/charizard/megax/front.png',
            'img/pokemon/unfezant/backf_shiny.png',
            'items/potion.png',
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
