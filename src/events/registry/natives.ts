/**
 * @file natives.ts
 * @brief Names of the TypeScript functions scripts may call with the `native` command.
 *
 * Scripts can never run code they carry themselves. When a script needs
 * something the commands do not cover (open the shop, the PC, the Pokédex),
 * it calls a function by name, and the game provides that function in
 * TypeScript with `EventManager.registerNative()`. Listing the names here
 * lets the validator catch typos and Tiled offer them.
 */
export const NATIVES = {
    openShop: 'Open a shop. Args: { stock: "<shop id>" }.',
    openPc: 'Open the PC storage system.',
    openPokedex: 'Open the Pokédex.',
} as const satisfies Record<string, string>;

/** @brief A native function name. */
export type NativeName = keyof typeof NATIVES;
