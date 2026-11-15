/// <reference types="vite/client" />

/**
 * @brief `.ink` files are compiled to ink JSON by vite/plugins/ink.mjs.
 *        Pass the default export to `new DialogueEngine(...)`.
 */
declare module '*.ink' {
    const story: Record<string, unknown>;
    export default story;
}
