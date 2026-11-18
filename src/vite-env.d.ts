/// <reference types="vite/client" />

/**
 * @brief `.ink` files are compiled to ink JSON by vite/plugins/ink.mjs.
 *        Pass the default export to `new DialogueEngine(...)`.
 */
declare module '*.ink' {
    const story: Record<string, unknown>;
    export default story;
}

/**
 * @brief Every event file compiled by vite/plugins/events.mjs.
 *        Pass it to `new EventManager({ bundle, ... })` (src/events).
 */
declare module 'virtual:stab-events' {
    const bundle: import('./events/compile.ts').EventBundle;
    export default bundle;
}

/**
 * @brief Translated graphics found at build time by vite/plugins/locales.mjs:
 *        paths under `public/assets/img/locales/`, without `.png`
 *        (`de/ui/battle/cursor_command`). See src/i18n/graphics.ts.
 */
declare module 'virtual:stab-locale-graphics' {
    const files: string[];
    export default files;
}
