/**
 * @file UiAssetGate.tsx
 * @brief Holds the UI back until its font and default images have loaded.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_SKINS, getSkin } from '../skins/skins';
import { listFonts } from '../text/fonts';
import { preloadUi } from './loader';
import type { UiPreloadList } from './loader';
import { uiImageUrl } from './paths';

/**
 * @brief What `<UiAssetGate>` loads by default: every registered font, the
 *        default skins and the dialogue arrows.
 * @return The list.
 */
export function defaultUiPreload (): UiPreloadList
{
    return {
        fonts: Object.values(listFonts()).map(({ family, url }) => ({ family, url })),
        images: [
            ...Object.values(DEFAULT_SKINS).map((id) => getSkin(id).url),
            uiImageUrl('pause_arrow'),
            uiImageUrl('sel_arrow'),
        ],
    };
}

/** @brief Props of `<UiAssetGate>`. */
export interface UiAssetGateProps
{
    /** The UI. */
    children?: ReactNode;
    /** Extra files to load first (added to `defaultUiPreload()`). */
    preload?: UiPreloadList;
    /** Shown while loading (default nothing). */
    fallback?: ReactNode;
}

/**
 * @brief Renders `children` once the UI's files are ready.
 *
 * Without it, the first message could appear before its font, in a fallback
 * font, or with its frame popping in a moment later.
 *
 * @param props See `UiAssetGateProps`.
 * @return `fallback` while loading, then `children`.
 */
export function UiAssetGate ({ children, preload, fallback = null }: UiAssetGateProps)
{
    const [ready, setReady] = useState(false);

    useEffect(() =>
    {
        let live = true;
        const base = defaultUiPreload();
        void preloadUi({
            fonts: [...(base.fonts ?? []), ...(preload?.fonts ?? [])],
            images: [...(base.images ?? []), ...(preload?.images ?? [])],
        }).then(() => { if (live) setReady(true); });
        return () => { live = false; };
        //  Only the first list counts; later changes would reload for nothing.
    }, []);

    return <>{ready ? children : fallback}</>;
}
