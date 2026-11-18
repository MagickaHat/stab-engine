/**
 * @file layers.ts
 * @brief The kinds of title screen layer, and how to add your own.
 *
 * Each `kind` in `TITLE_SCREEN.layers` (titleConfig.ts) is drawn by a
 * factory registered here. The built-in kinds are `image`, `blink`, `scroll`
 * and `bob`; `text` is drawn by the React UI (src/ui/title/TitleOverlay.tsx),
 * so its factory here draws nothing.
 *
 * A new kind of layer is one call, with no change to the scene:
 * @code
 * registerTitleLayer('spin', (scene, layer, ctx) =>
 * {
 *     const image = scene.add.image(layer.x ?? 0, layer.y ?? 0, ctx.texture(layer.image!)).setOrigin(0, 0);
 *     return { update: (time) => image.setFrame(Math.floor(time / 100) % 4), destroy: () => image.destroy() };
 * });
 * @endcode
 */
import type {GameObjects, Scene} from 'phaser';
import type {BlinkLayer, BobLayer, ImageLayer, ScrollLayer, TitleLayer} from './titleConfig';
import {blinkVisible, bobOffset, scrollOffset} from './timing';

/** @brief What a layer factory gets besides the scene and its settings. */
export interface TitleLayerContext {
    /** Game size in pixels. */
    width: number;
    height: number;
    /** Depth to draw at; later layers get higher depths. */
    depth: number;
    /**
     * @brief The texture key of an image from the config (loaded by `Boot`).
     * @return The key, or `null` if the image could not be loaded.
     */
    texture: (image: string) => string | null;
}

/** @brief A layer on screen. */
export interface TitleLayerInstance {
    /**
     * @brief Called every frame.
     * @param timeMs Milliseconds since the title screen appeared.
     */
    update?: (timeMs: number) => void;
    /** Remove what the layer drew (the scene's own objects go away by themselves). */
    destroy?: () => void;
}

/**
 * @brief Draws one kind of layer.
 * @return The layer, or `null` if it has nothing to draw (e.g. a missing image).
 */
export type TitleLayerFactory<L extends TitleLayer = TitleLayer> = (scene: Scene, layer: L, ctx: TitleLayerContext) =>
    TitleLayerInstance|null;

const factories = new Map<string, TitleLayerFactory>();

/**
 * @brief Add (or replace) a kind of title layer.
 * @param kind The `kind` the config uses.
 * @param factory Draws it.
 */
export function registerTitleLayer<L extends TitleLayer>(kind: string, factory: TitleLayerFactory<L>): void
{
    factories.set(kind, factory as TitleLayerFactory);
}

/**
 * @brief Whether a kind of layer can be drawn.
 * @param kind A layer kind.
 * @return `true` if a factory is registered for it.
 */
export function hasTitleLayer(kind: string): boolean
{
    return factories.has(kind);
}

/**
 * @brief Draw a layer with the factory of its kind.
 * @return The layer, or `null` if its kind is unknown (a warning is logged) or it draws nothing.
 */
export function createTitleLayer(scene: Scene, layer: TitleLayer, ctx: TitleLayerContext): TitleLayerInstance|null
{
    const factory = factories.get(layer.kind);
    if (!factory)
    {
        console.warn(`[title] unknown layer kind "${layer.kind}": register it with registerTitleLayer()`);
        return null;
    }
    return factory(scene, layer, ctx);
}

/** @brief Add an image at a layer's position, top-left anchored, or `null` if its texture is missing. */
function addImage(scene: Scene, layer: ImageLayer|BlinkLayer|BobLayer, ctx: TitleLayerContext): GameObjects.Image|null
{
    const key = ctx.texture(layer.image);
    if (!key) return null;
    return scene.add.image(Math.round(layer.x ?? 0), Math.round(layer.y ?? 0), key).setOrigin(0, 0).setDepth(ctx.depth);
}

registerTitleLayer<ImageLayer>('image', (scene, layer, ctx) => {
    const image = addImage(scene, layer, ctx);
    return image && { destroy: () => image.destroy() };
});

registerTitleLayer<BlinkLayer>('blink', (scene, layer, ctx) => {
    const image = addImage(scene, layer, ctx);
    return image && {
        update: (time) => image.setVisible(blinkVisible(time, layer.onMs, layer.offMs)),
        destroy: () => image.destroy(),
    };
});

registerTitleLayer<BobLayer>('bob', (scene, layer, ctx) => {
    const image = addImage(scene, layer, ctx);
    const y = Math.round(layer.y ?? 0);
    return image && {
        update: (time) => image.setY(y + bobOffset(time, layer.amplitude, layer.periodMs)),
        destroy: () => image.destroy(),
    };
});

registerTitleLayer<ScrollLayer>('scroll', (scene, layer, ctx) => {
    const key = ctx.texture(layer.image);
    if (!key) return null;
    const source = scene.textures.get(key).getSourceImage() as
    {
        width: number;
        height: number
    };
    const height = layer.height ?? source.height;
    //  A tile sprite repeats the image at 1×; only its whole-pixel offset changes.
    const band = scene.add.tileSprite(Math.round(layer.x ?? 0), Math.round(layer.y ?? 0), ctx.width, height, key)
                     .setOrigin(0, 0)
                     .setDepth(ctx.depth);
    return {
        update: (time) => {
            band.tilePositionX = -scrollOffset(time, layer.speedX ?? 0, source.width);
            band.tilePositionY = -scrollOffset(time, layer.speedY ?? 0, source.height);
        },
        destroy: () => band.destroy(),
    };
});

//  Drawn by the React UI with the pixel font (src/ui/title/TitleOverlay.tsx).
registerTitleLayer('text', () => null);
