/**
 * @file gen9.ts
 * @brief Layout of Pokémon Essentials resource packs, tuned for the
 *        "Generation 9 Resource Pack" for Essentials v21.1 by Caruban.
 *
 * A plain Essentials project uses the same folders, so this definition also
 * imports the graphics and cries of an Essentials game folder.
 */
import type { PackDefinition } from '../pack.ts';

/** @brief Alcremie creams, in Essentials order (form = cream × 7 + sweet). */
const CREAMS = ['Vanilla-Cream', 'Ruby-Cream', 'Matcha-Cream', 'Mint-Cream', 'Lemon-Cream', 'Salted-Cream', 'Ruby-Swirl', 'Caramel-Swirl', 'Rainbow-Swirl'];
/** @brief Alcremie sweets, in Essentials order. */
const SWEETS = ['Strawberry', 'Berry', 'Love', 'Star', 'Clover', 'Flower', 'Ribbon'];
/** @brief Minior core colours, in Essentials order (forms 7–13). */
const CORES = ['', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'];

export const gen9: PackDefinition = {
    name: 'gen9',
    credits: 'Credits.txt',
    rules: [
        // Battle sprites: fronts are stored at 2× (192px) and backs at 3× (288px); both become 96×96.
        { kind: 'front', target: 'pokemon', dir: 'Graphics/Pokemon/Front', ext: '.png', output: 'front{f}.png', image: { size: [96, 96] } },
        { kind: 'front', target: 'pokemon', dir: 'Graphics/Pokemon/Front shiny', ext: '.png', output: 'front{f}_shiny.png', image: { size: [96, 96] } },
        { kind: 'back', target: 'pokemon', dir: 'Graphics/Pokemon/Back', ext: '.png', output: 'back{f}.png', image: { size: [96, 96] } },
        { kind: 'back', target: 'pokemon', dir: 'Graphics/Pokemon/Back shiny', ext: '.png', output: 'back{f}_shiny.png', image: { size: [96, 96] } },
        // Party icons: two 64×64 frames side by side at 2× → two 32×32 frames.
        { kind: 'icon', target: 'pokemon', dir: 'Graphics/Pokemon/Icons', ext: '.png', output: 'icon{f}.png', image: { divide: 2 } },
        { kind: 'icon', target: 'pokemon', dir: 'Graphics/Pokemon/Icons shiny', ext: '.png', output: 'icon{f}_shiny.png', image: { divide: 2 } },
        // Overworld (follower) sheets: 4 directions × 4 frames at 2×.
        { kind: 'overworld', target: 'pokemon', dir: 'Graphics/Characters/Followers', ext: '.png', output: 'overworld{f}.png', image: { divide: 2 } },
        { kind: 'overworld', target: 'pokemon', dir: 'Graphics/Characters/Followers shiny', ext: '.png', output: 'overworld{f}_shiny.png', image: { divide: 2 } },
        { kind: 'footprint', target: 'pokemon', dir: 'Graphics/Pokemon/Footprints', ext: '.png', output: 'footprint.png', image: { divide: 2 } },
        // Item icons: 48×48 at 2× → 24×24.
        { kind: 'item', target: 'item', dir: 'Graphics/Items', ext: '.png', image: { divide: 2 } },
    ],
    forms: {
        // IDs that are not simply the Showdown ID in capitals.
        '000': 'unknown',
        'NIDORANfE': 'nidoranf',
        'NIDORANmA': 'nidoranm',

        // Essentials and Showdown disagree on which forme is the base one.
        'MAUSHOLD': 'maushold/four',
        'MAUSHOLD_1': 'maushold',
        'XERNEAS': 'xerneas/neutral',
        'XERNEAS_1': 'xerneas',
        'MINIOR': (form) => (form === 0 ? 'minior/meteor' : form >= 7 && form <= 13 ? `minior/${CORES[form - 7]}`.replace(/\/$/, '') : undefined),

        // Forms the pack's PBS files do not name, or name in a way that cannot be matched.
        // (Checked against the sprites. Pikachu's costumes are in alphabetical order.)
        'PIKACHU_2': 'pikachu/cosplay',
        'PIKACHU_3': 'pikachu/belle',
        'PIKACHU_4': 'pikachu/libre',
        'PIKACHU_5': 'pikachu/phd',
        'PIKACHU_6': 'pikachu/popstar',
        'PIKACHU_7': 'pikachu/rockstar',
        'PIKACHU_8': 'pikachu/original',
        'PIKACHU_9': 'pikachu/hoenn',
        'PIKACHU_10': 'pikachu/sinnoh',
        'PIKACHU_11': 'pikachu/unova',
        'PIKACHU_12': 'pikachu/kalos',
        'PIKACHU_13': 'pikachu/alola',
        'PIKACHU_14': 'pikachu/partner',
        'UNOWN_26': 'unown/question',
        'UNOWN_27': 'unown/exclamation',
        'VIVILLON_19': 'vivillon/pokeball',
        'BASCULEGION_1': 'basculegion/f',
        'ZARUDE_1': 'zarude/dada',
        'MEOWSTIC_2': 'meowstic/mmega',
        'OGERPON_8': 'ogerpon/tealtera',
        'OGERPON_9': 'ogerpon/wellspringtera',
        'OGERPON_10': 'ogerpon/hearthflametera',
        'OGERPON_11': 'ogerpon/cornerstonetera',

        // Essentials numbers Alcremie cream-first; Showdown names the forme after cream and sweet.
        'ALCREMIE': (form) =>
        {
            const cream = CREAMS[Math.floor(form / SWEETS.length)];
            if (!cream) return undefined;
            return form === 0 ? 'alcremie' : `alcremie/${`${cream}${SWEETS[form % SWEETS.length]}sweet`.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        },
    },
    // Stray misnamed copies: `BOMBIRDIERs`, `ORTHWORMs`, `POLTHCAGEIST` (followers), `CELUREDGE` (cry).
    ignore: [/^[A-Z0-9]+s$/, /^POLTHCAGEIST$/, /^CELUREDGE$/],
    item: (stem) =>
    {
        // Type-coloured TM/TR discs shared by every machine of that type.
        const machine = /^machine_(?:(hm|tr)_)?([A-Za-z]+)$/.exec(stem);
        if (machine) return `${machine[1] ?? 'tm'}_${machine[2].toLowerCase()}`;
        if (stem === '000') return 'unknown';
        if (stem === 'back') return null; // the Bag's "close" icon, not an item
        return undefined;
    },
};
