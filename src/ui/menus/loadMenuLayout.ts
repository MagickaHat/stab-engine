/**
 * @file loadMenuLayout.ts
 * @brief Where the New Game / Continue menu draws everything. Change these to
 *        reskin the menu; the component (LoadMenu.tsx) only reads them.
 *
 * The graphics are Essentials' load screen at 1× (`ui/load/bg.png`, 256×192,
 * and `ui/load/panels.png`, a sheet of four panels):
 *
 * | Panel                 | Source (x, y) | Size    |
 * |-----------------------|---------------|---------|
 * | Continue              | 0, 0          | 204×111 |
 * | Continue, selected    | 0, 111        | 204×111 |
 * | Small entry           | 8, 222        | 192×23  |
 * | Small entry, selected | 8, 245        | 192×23  |
 */
import {uiImageUrl} from '../assets/paths';

/** @brief A rectangle of the panel sheet. */
export interface PanelFrame {
    /** Left of the normal frame in the sheet. */
    sx: number;
    /** Top of the normal frame in the sheet. */
    sy: number;
    /** Top of the selected frame in the sheet. */
    selectedSy: number;
    width: number;
    height: number;
    /** Left on screen. */
    x: number;
}

/** @brief Everything about the menu's look. */
export const LOAD_MENU_LAYOUT = {
    /** Full-screen background. */
    background: uiImageUrl('load/bg'),
    /** Sheet of panels. */
    panels: uiImageUrl('load/panels'),
    /** A save (the large panel). */
    continuePanel: {sx: 0, sy: 0, selectedSy: 111, width: 204, height: 111, x: 26} satisfies PanelFrame,
    /** New Game and other one-line entries. */
    entryPanel: {sx: 8, sy: 222, selectedSy: 245, width: 192, height: 23, x: 32} satisfies PanelFrame,
    /** Top of the first panel, and the space between panels. */
    top: 8,
    gap: 4,
    /** Space kept below the last panel when scrolling. */
    bottom: 8,
    /** Text colours (Essentials' load screen). */
    text: {color: '#e8e8e8', shadow: '#888888'},
    /** Inside a Continue panel, relative to it. */
    save: {
        /** "CONTINUE" in the header. */
        title: {x: 12, y: 3},
        /** Slot number, right-aligned in the header (only when there are several saves). */
        slot: {right: 192, y: 3},
        /** Rows of label / value: player, badges, Pokédex, time. */
        rows: {x: 12, valueRight: 98, y: 27, step: 16},
        /** Party icons: 3 columns × 2 rows of 32×32 cells. */
        party: {x: 104, y: 38, step: 32, columns: 3},
        /** Message of a save that cannot be read. */
        error: {x: 12, y: 30, wrap: 180},
    },
    /** Inside an entry panel, relative to it. */
    entry: {x: 12, y: 3},
    /** Milliseconds per frame of the party icons' two-frame animation. */
    iconFrameMs: 250,
} as const;
