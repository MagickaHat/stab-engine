/**
 * @file story.ts
 * @brief Story milestones, in the order the player reaches them.
 *
 * Each track is an ordered list of milestone IDs. `setStory` records the
 * milestone a track has reached, and the `story` condition compares
 * milestones by their place in the list, so "has the player reached X?"
 * stays correct when milestones are added in between later.
 *
 * Milestone IDs must be unique across all tracks.
 */
export const STORY = {
    main: [
        'intro',
        'got_starter',
        'first_rival_battle',
        'beat_gym_1',
    ],
} as const satisfies Record<string, readonly string[]>;

/** @brief Track used when a script names none. */
export const DEFAULT_STORY_TRACK = 'main';

/**
 * @brief Find a milestone.
 * @param milestone Milestone ID.
 * @param track Track to look in. Left out: every track.
 * @return Its track and index, or `null` if it is not registered.
 */
export function findMilestone (milestone: string, track?: string): { track: string; index: number } | null
{
    for (const [name, list] of Object.entries(STORY) as [string, readonly string[]][])
    {
        if (track !== undefined && name !== track) continue;
        const index = list.indexOf(milestone);
        if (index >= 0) return { track: name, index };
    }
    return null;
}

/**
 * @brief Every milestone ID, with its track.
 * @return `[{ track, milestone }]` in track order.
 */
export function allMilestones (): { track: string; milestone: string }[]
{
    return (Object.entries(STORY) as [string, readonly string[]][])
        .flatMap(([track, list]) => list.map((milestone) => ({ track, milestone })));
}
