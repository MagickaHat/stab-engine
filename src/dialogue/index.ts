/**
 * @file index.ts
 * @brief Public entry point of the dialogue system.
 *
 * Import from here in scenes: `import { DialogueEngine } from '../../dialogue';`
 */
export { DialogueEngine } from './DialogueEngine';
export { parseTags } from './tags';
export { Story, InkList } from 'inkjs';
export type * from './types';
