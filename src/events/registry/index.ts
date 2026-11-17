/**
 * @file index.ts
 * @brief The code registries scripts refer to: flags, variables, story milestones, emotes and natives.
 *
 * Items, species and translation keys come from the game data and locale
 * files instead; trainers from the event files. `npm run events:sync-tiled`
 * reads all of them and writes them into the Tiled project as enums.
 */
export { FLAGS, TRAINER_FLAG_PREFIX, LISTENER_FLAG_PREFIX, isKnownFlag } from './flags.ts';
export type { FlagName } from './flags.ts';
export { VARIABLES, BATTLE_RESULT_VAR, CHOICE_RESULT_VAR } from './variables.ts';
export type { VariableName } from './variables.ts';
export { STORY, DEFAULT_STORY_TRACK, findMilestone, allMilestones } from './story.ts';
export { EMOTES, EMOTE_FRAME_SIZE } from './emotes.ts';
export type { EmoteName } from './emotes.ts';
export { NATIVES } from './natives.ts';
export type { NativeName } from './natives.ts';
