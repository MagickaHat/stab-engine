/**
 * @file LoadMenu.tsx
 * @brief The New Game / Continue menu opened from the title screen.
 *
 * One large panel per save, most recent first, showing the player's name,
 * badges, Pokédex, play time and party (icons from each species' folder,
 * `img/pokemon/<species>/icon.png`), then the one-line entries (`NEW GAME`).
 * Up/down choose, A picks, B goes back to the title. A tap on a panel picks it.
 * Saves that cannot be read are shown with the reason and cannot be picked.
 *
 * The look is set in loadMenuLayout.ts; the entries in `LOAD_MENU_ENTRIES`.
 */
import { useEffect, useMemo, useState } from 'react';
import { splitSpeciesId, spritePath } from '../../battle/bridge/assets';
import type { AssetManifest } from '../../battle/bridge/assets';
import { continueSlots } from '../../game/title/requests';
import type { LoadMenuChoice } from '../../game/title/requests';
import { formatPlayTime } from '../../game/title/timing';
import type { SaveSummary, SlotInfo } from '../../state';
import { assetUrl } from '../assets/paths';
import { PixelText } from '../components/PixelText';
import { UiSprite } from '../components/UiSprite';
import { useTicker } from '../dialogue/textSpeed';
import { playUiSound } from '../sounds';
import { useModal } from '../store/uiStore';
import { textWidth } from '../text/layout';
import { usePixelFont } from '../text/usePixelText';
import { useMenuText } from '../title/useMenuText';
import { useInputPress } from '../useInput';
import { LOAD_MENU_LAYOUT } from './loadMenuLayout';
import type { PanelFrame } from './loadMenuLayout';

/** @brief A one-line entry under the saves. */
export interface LoadMenuEntry
{
    /** Text key of its label. */
    key: string;
    /** What picking it answers. */
    choice: LoadMenuChoice;
}

/** @brief The one-line entries, in order. Add an OPTIONS or MYSTERY GIFT entry here. */
export const LOAD_MENU_ENTRIES: LoadMenuEntry[] = [
    { key: 'ui.load.new_game', choice: { kind: 'newGame' } },
];

/** @brief Props of `<LoadMenu>`. */
export interface LoadMenuProps
{
    /** Every save slot (`SaveManager.list()`). */
    slots: SlotInfo[];
    /** Called once with the player's pick. */
    onPick: (choice: LoadMenuChoice) => void;
}

/** @brief One row of the menu. */
type Row =
    | { type: 'save'; info: SlotInfo }
    | { type: 'entry'; entry: LoadMenuEntry };

/** @brief The manifest of Pokémon sprites, loaded once. */
let manifest: Promise<AssetManifest | null> | null = null;

/** @brief Load `assets/manifest.json` (which sprites exist), or `null` if it cannot be read. */
function loadManifest (): Promise<AssetManifest | null>
{
    manifest ??= fetch(assetUrl('assets/manifest.json'))
        .then((response) => (response.ok ? response.json() as Promise<AssetManifest> : null))
        .catch(() => null);
    return manifest;
}

/**
 * @brief The icon of a party member, from its species folder.
 * @param data The sprite manifest.
 * @param member A party member of a save summary.
 * @return The icon's URL, or `null` if the species has none.
 */
export function partyIconUrl (data: AssetManifest, member: SaveSummary['party'][number]): string | null
{
    const path = spritePath(data, { ...splitSpeciesId(data, member.species), shiny: member.shiny, gender: member.gender }, 'icon');
    return path && assetUrl(`assets/${path}`);
}

/**
 * @brief Top of every row, and how far the list must scroll to show `selected`.
 * @param heights Height of each row.
 * @param selected Index of the selected row.
 * @param screenHeight Game height.
 * @return `tops` (unscrolled) and `scroll` (pixels to move the list up).
 */
export function layoutRows (heights: readonly number[], selected: number, screenHeight: number): { tops: number[]; scroll: number }
{
    const { top, gap, bottom } = LOAD_MENU_LAYOUT;
    const tops: number[] = [];
    let y = top;
    for (const height of heights)
    {
        tops.push(y);
        y += height + gap;
    }
    const end = (tops[selected] ?? 0) + (heights[selected] ?? 0);
    return { tops, scroll: Math.max(0, end + bottom - screenHeight) };
}

/**
 * @brief A panel of the sheet, normal or selected.
 * @param props `frame`, `selected`, `y`.
 * @return The panel.
 */
function Panel ({ frame, selected, y }: { frame: PanelFrame; selected: boolean; y: number })
{
    const sy = selected ? frame.selectedSy : frame.sy;
    return (
        <UiSprite src={LOAD_MENU_LAYOUT.panels} x={0} y={0} width={frame.width} height={frame.height}
            style={{ backgroundPosition: `${-frame.sx}px ${-sy}px`, top: y }} />
    );
}

/**
 * @brief The New Game / Continue menu.
 * @param props See `LoadMenuProps`.
 * @return The menu, full screen.
 */
export function LoadMenu ({ slots, onPick }: LoadMenuProps)
{
    const t = useMenuText();
    const { advance, ready } = usePixelFont();
    const [icons, setIcons] = useState<AssetManifest | null>(null);
    const tick = useTicker(LOAD_MENU_LAYOUT.iconFrameMs);
    useModal(true);
    useEffect(() =>
    {
        let live = true;
        void loadManifest().then((data) => { if (live) setIcons(data); });
        return () => { live = false; };
    }, []);

    const saves = useMemo(() => continueSlots(slots), [slots]);
    const rows = useMemo<Row[]>(() => [
        ...saves.map((info) => ({ type: 'save', info }) as Row),
        ...LOAD_MENU_ENTRIES.map((entry) => ({ type: 'entry', entry }) as Row),
    ], [saves]);
    const pickable = (row: Row) => row.type === 'entry' || row.info.status === 'ok';
    const [selected, setSelected] = useState(() => Math.max(0, rows.findIndex(pickable)));

    const choose = (index: number) =>
    {
        const row = rows[index];
        if (!row || !pickable(row))
        {
            playUiSound('cancel');
            return;
        }
        playUiSound('select');
        onPick(row.type === 'entry' ? row.entry.choice : { kind: 'continue', slot: row.info.slot });
    };

    useInputPress((button) =>
    {
        if (button === 'up' || button === 'down')
        {
            const step = button === 'up' ? -1 : 1;
            setSelected((index) => (index + step + rows.length) % rows.length);
            playUiSound('cursor');
        }
        else if (button === 'a' || button === 'start') choose(selected);
        else if (button === 'b')
        {
            playUiSound('cancel');
            onPick({ kind: 'back' });
        }
        return true;
    }, ready);

    const { continuePanel, entryPanel, text, save, entry } = LOAD_MENU_LAYOUT;
    const heights = rows.map((row) => (row.type === 'save' ? continuePanel.height : entryPanel.height));
    const { tops, scroll } = layoutRows(heights, selected, 192);
    const right = (value: string, edge: number) => edge - (ready ? textWidth(value, advance) : 0);

    return (
        <div className="load-menu ui-interactive" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <UiSprite src={LOAD_MENU_LAYOUT.background} x={0} y={0} width={256} height={192} />
            {rows.map((row, index) =>
            {
                const frame = row.type === 'save' ? continuePanel : entryPanel;
                const y = tops[index] - scroll;
                return (
                    <div key={row.type === 'save' ? `slot-${row.info.slot}` : row.entry.key}
                        style={{ position: 'absolute', left: frame.x, top: y, width: frame.width, height: frame.height }}
                        onPointerDown={(event) =>
                        {
                            if (event.button !== 0) return;
                            setSelected(index);
                            choose(index);
                        }}>
                        <Panel frame={frame} selected={index === selected} y={0} />
                        {row.type === 'entry' && <PixelText text={t(row.entry.key)} x={entry.x} y={entry.y} {...text} />}
                        {row.type === 'save' && (
                            <>
                                <PixelText text={t('ui.load.continue')} x={save.title.x} y={save.title.y} {...text} />
                                {saves.length > 1 && (
                                    <PixelText text={String(row.info.slot + 1)} x={right(String(row.info.slot + 1), save.slot.right)} y={save.slot.y} {...text} />
                                )}
                                {row.info.status === 'ok' && <SaveDetails summary={row.info.summary} icons={icons} tick={tick} right={right} t={t} />}
                                {row.info.status === 'error' && (
                                    <PixelText text={t(row.info.error.code === 'newer' ? 'ui.load.newer' : 'ui.load.corrupt')}
                                        x={save.error.x} y={save.error.y} wrap={save.error.wrap} {...text} />
                                )}
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/** @brief Props of `<SaveDetails>`. */
interface SaveDetailsProps
{
    summary: SaveSummary;
    icons: AssetManifest | null;
    tick: number;
    /** Left edge of a text that ends at `edge`. */
    right: (value: string, edge: number) => number;
    t: (key: string) => string;
}

/**
 * @brief The inside of a Continue panel: player, badges, Pokédex, time and party.
 * @param props See `SaveDetailsProps`.
 * @return The details.
 */
function SaveDetails ({ summary, icons, tick, right, t }: SaveDetailsProps)
{
    const { text, save } = LOAD_MENU_LAYOUT;
    const rows: [string, string][] = [
        [t('ui.load.player'), summary.playerName],
        [t('ui.load.badges'), String(summary.badges)],
        [t('ui.load.pokedex'), String(summary.pokedexOwned)],
        [t('ui.load.time'), formatPlayTime(summary.playTimeMs)],
    ];
    return (
        <>
            {rows.map(([label, value], index) => (
                <div key={label}>
                    <PixelText text={label} x={save.rows.x} y={save.rows.y + index * save.rows.step} {...text} />
                    <PixelText text={value} x={right(value, save.rows.valueRight)} y={save.rows.y + index * save.rows.step} {...text} />
                </div>
            ))}
            {icons && summary.party.map((member, index) =>
            {
                const url = partyIconUrl(icons, member);
                if (!url) return null;
                const { party } = save;
                return (
                    <UiSprite key={index} src={url} width={party.step} height={party.step} frame={tick % 2}
                        x={party.x + (index % party.columns) * party.step} y={party.y + Math.floor(index / party.columns) * party.step} />
                );
            })}
        </>
    );
}
