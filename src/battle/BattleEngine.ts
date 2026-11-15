/**
 * @file BattleEngine.ts
 * @brief Runs a Pokémon battle using the Pokémon Showdown simulator (@pkmn/sim).
 *
 * The simulator is completely separate from Phaser: it receives text commands
 * (`>start`, `>p1 move 1` ...) and answers with protocol lines. `BattleEngine`
 * hides those details behind a small callback-based API that a Phaser scene
 * (or any other code) can use.
 *
 * @code
 * const engine = new BattleEngine({
 *     p1: { name: 'Player', team: importTeam(SAMPLE_TEAM_P1) },
 *     p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
 * });
 * engine.onProtocol = (lines) => lines.forEach((l) => console.log(describeLine(l)));
 * engine.onRequest = (side, req) => { if (isMoveRequest(req)) engine.chooseMove(side, 1); };
 * engine.onEnd = (winner) => console.log('Winner:', winner);
 * engine.start();
 * @endcode
 */
import { BattleStreams, RandomPlayerAI, Streams } from '@pkmn/sim';
import type { PRNGSeed } from '@pkmn/sim';
import type { BattleRequest, SideID } from './types';

/** @brief How a side is controlled. `false`/omitted = controlled by your code. */
export type AIKind = 'random' | false;

/** @brief Settings for one player. */
export interface PlayerOptions {
    /** Name shown in the protocol (and used in `|win|`). */
    name?: string;
    /** Packed team string (see `importTeam()` in teams.ts). */
    team: string;
    /** Let a built-in AI control this side. */
    ai?: AIKind;
}

/** @brief Which point of view `onProtocol` lines are reported from. */
export type Perspective = 'p1' | 'p2' | 'spectator' | 'omniscient';

/** @brief Options for creating a battle. */
export interface BattleEngineOptions {
    /** Showdown format ID. Default: `"gen9customgame"` (any team, no validation). */
    formatid?: string;
    /** Player 1 settings. */
    p1: PlayerOptions;
    /** Player 2 settings. */
    p2: PlayerOptions;
    /** Fixed RNG seed for reproducible battles, e.g. `"sodium,0123abcd..."` or `"gen5,1,2,3,4"`. */
    seed?: PRNGSeed;
    /**
     * Perspective for `onProtocol`. Default `"p1"`: what player 1 is allowed to
     * see. (In formats with the "HP Percentage Mod" rule, such as
     * `gen9ou`, the opponent's HP is then reported out of 100.)
     */
    perspective?: Perspective;
    /** Print every raw message to the console. */
    debug?: boolean;
}

/**
 * @brief Wraps a `@pkmn/sim` BattleStream and exposes a simple event API.
 *
 * Lifecycle: construct → assign callbacks → `start()` → answer each
 * `onRequest` with `chooseMove()` / `chooseSwitch()` / `choose()` →
 * `onEnd` fires → `destroy()`.
 */
export class BattleEngine
{
    /**
     * @brief Called when a player controlled by your code must make a decision.
     * @param side The player who must choose.
     * @param request What they can choose from (see `types.ts`).
     */
    onRequest: (side: SideID, request: BattleRequest) => void = () => {};

    /**
     * @brief Called with each batch of protocol lines (one batch ≈ one turn).
     * @param lines Raw protocol lines; use `parseLine()` / `describeLine()` on them.
     */
    onProtocol: (lines: string[]) => void = () => {};

    /**
     * @brief Called when the simulator rejects a choice (e.g. a disabled move).
     *
     * A new request for the same decision normally follows, so you can let the
     * player try again.
     * @param side The player whose choice was rejected.
     * @param message Error text from the simulator.
     */
    onError: (side: SideID, message: string) => void = (side, message) => console.warn(`[${side}] ${message}`);

    /**
     * @brief Called once when the battle ends.
     * @param winner Winning player's name, or `null` for a tie.
     */
    onEnd: (winner: string | null) => void = () => {};

    /** @brief The latest unanswered request for each player (if any). */
    readonly requests: Partial<Record<SideID, BattleRequest>> = {};

    /** @brief `true` once the battle has finished. */
    ended = false;

    private readonly options: BattleEngineOptions;
    private readonly battleStream: BattleStreams.BattleStream;
    private readonly streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
    private started = false;

    /**
     * @brief Create a battle (it does not start until `start()` is called).
     * @param options Format, teams, AI and other settings.
     */
    constructor (options: BattleEngineOptions)
    {
        this.options = options;
        this.battleStream = new BattleStreams.BattleStream({ debug: options.debug });
        this.streams = BattleStreams.getPlayerStreams(this.battleStream);
    }

    /**
     * @brief Start the battle. Assign your callbacks before calling this.
     */
    start (): void
    {
        if (this.started) throw new Error('BattleEngine: battle already started');
        this.started = true;

        const { formatid = 'gen9customgame', seed, p1, p2, perspective = 'p1' } = this.options;

        for (const side of ['p1', 'p2'] as const)
        {
            const player = this.options[side];
            if (player.ai === 'random')
            {
                void new RandomPlayerAI(this.streams[side]).start();
            }
            else
            {
                void this.readPlayerStream(side, perspective === side);
            }
        }
        if (perspective === 'spectator' || perspective === 'omniscient')
        {
            void this.readProtocolStream(this.streams[perspective]);
        }

        const startOptions: { formatid: string; seed?: PRNGSeed } = { formatid };
        if (seed) startOptions.seed = seed;

        void this.streams.omniscient.write(
            `>start ${JSON.stringify(startOptions)}\n` +
            `>player p1 ${JSON.stringify({ name: p1.name ?? 'Player 1', team: p1.team })}\n` +
            `>player p2 ${JSON.stringify({ name: p2.name ?? 'Player 2', team: p2.team })}`
        );
    }

    /**
     * @brief Send a raw choice string for a player, e.g. `"move 2 terastallize"`, `"switch 3"`, `"team 123456"`.
     * @param side The player making the choice.
     * @param choice Choice in Showdown syntax (see SIM-PROTOCOL.md "Choices").
     */
    choose (side: SideID, choice: string): void
    {
        if (this.ended) return;
        delete this.requests[side];
        void this.streams[side as 'p1' | 'p2'].write(choice);
    }

    /**
     * @brief Use a move.
     * @param side The player making the choice.
     * @param slot Move slot, 1-4 (1 = first move in the request's `moves` list).
     * @param extra Optional modifier such as `"terastallize"` or `"mega"`.
     */
    chooseMove (side: SideID, slot: number, extra?: string): void
    {
        this.choose(side, `move ${slot}${extra ? ' ' + extra : ''}`);
    }

    /**
     * @brief Switch to another team member.
     * @param side The player making the choice.
     * @param slot Party slot, 1-6 (1 = first Pokémon in `request.side.pokemon`).
     */
    chooseSwitch (side: SideID, slot: number): void
    {
        this.choose(side, `switch ${slot}`);
    }

    /**
     * @brief Make a player forfeit (lose immediately).
     * @param side The player who forfeits.
     */
    forfeit (side: SideID): void
    {
        if (this.ended) return;
        void this.streams.omniscient.write(`>forcelose ${side}`);
    }

    /**
     * @brief Stop the simulator and release its streams. Call when leaving the battle scene.
     */
    destroy (): void
    {
        this.ended = true;
        void this.battleStream.writeEnd();
    }

    /** @brief Read a player's stream: requests and errors, plus protocol if it is the chosen perspective. */
    private async readPlayerStream (side: SideID, forwardProtocol: boolean): Promise<void>
    {
        for await (const chunk of this.streams[side as 'p1' | 'p2'])
        {
            const protocol: string[] = [];
            for (const line of chunk.split('\n'))
            {
                if (line.startsWith('|request|'))
                {
                    const json = line.slice('|request|'.length);
                    if (!json) continue;
                    const request = JSON.parse(json) as BattleRequest;
                    this.requests[side] = request;
                    this.onRequest(side, request);
                }
                else if (line.startsWith('|error|'))
                {
                    this.onError(side, line.slice('|error|'.length));
                }
                else if (forwardProtocol)
                {
                    protocol.push(line);
                }
            }
            if (protocol.length) this.handleProtocol(protocol);
        }
    }

    /** @brief Read a spectator/omniscient stream and forward every line as protocol. */
    private async readProtocolStream (stream: Streams.ObjectReadStream<string>): Promise<void>
    {
        for await (const chunk of stream)
        {
            this.handleProtocol(chunk.split('\n'));
        }
    }

    /** @brief Forward protocol lines and detect the end of the battle. */
    private handleProtocol (lines: string[]): void
    {
        this.onProtocol(lines);
        if (this.ended) return;
        for (const line of lines)
        {
            if (line.startsWith('|win|') || line === '|tie')
            {
                this.ended = true;
                this.onEnd(line === '|tie' ? null : line.slice('|win|'.length));
                return;
            }
        }
    }
}
