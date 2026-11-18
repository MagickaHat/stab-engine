/**
 * @file sceneKeys.ts
 * @brief Keys of the scenes from launch to the title screen, in one place so
 *        scenes and the React UI can name them without importing Phaser code.
 */

/** @brief The first scene: loads the intro's images (src/game/scenes/Boot.ts). */
export const BOOT_SCENE_KEY = 'Boot';

/** @brief The splashes and opening movie (src/game/scenes/Splash.ts). */
export const SPLASH_SCENE_KEY = 'Splash';

/** @brief The title screen and New Game / Continue menu (src/game/scenes/Title.ts). */
export const TITLE_SCENE_KEY = 'Title';

/** @brief Scenes before a game is loaded, where the development HUD stays hidden. */
export const FRONT_END_SCENES: readonly string[] = [BOOT_SCENE_KEY, SPLASH_SCENE_KEY, TITLE_SCENE_KEY];
