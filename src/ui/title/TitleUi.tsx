/**
 * @file TitleUi.tsx
 * @brief Connects the title scenes' requests to the React UI: the opening
 *        movie, the title screen's text and the New Game / Continue menu.
 *
 * Mount it once, inside `<UiAssetGate>` (see src/App.tsx). The New Game
 * language menu that follows is shown by `<EventDialogue>`.
 */
import { useEffect, useState } from 'react';
import { EventBus, GameEvents } from '../../bus/EventBus';
import type { LoadMenuRequest, MovieRequest } from '../../game/title/requests';
import { LoadMenu } from '../menus/LoadMenu';
import { OpeningMovie } from './OpeningMovie';
import { TitleOverlay } from './TitleOverlay';

/**
 * @brief Shows whatever the title scenes ask for.
 * @return The movie, the menu, or the title text.
 */
export function TitleUi ()
{
    const [movie, setMovie] = useState<MovieRequest | null>(null);
    const [menu, setMenu] = useState<LoadMenuRequest | null>(null);

    useEffect(() =>
    {
        const onMovie = (request: MovieRequest) => setMovie(request);
        const onMenu = (request: LoadMenuRequest) => setMenu(request);
        EventBus.on(GameEvents.TITLE_MOVIE, onMovie);
        EventBus.on(GameEvents.TITLE_LOAD_MENU, onMenu);
        return () =>
        {
            EventBus.off(GameEvents.TITLE_MOVIE, onMovie);
            EventBus.off(GameEvents.TITLE_LOAD_MENU, onMenu);
        };
    }, []);

    if (movie)
    {
        return (
            <OpeningMovie key={movie.src} src={movie.src} skippable={movie.skippable}
                onDone={() =>
                {
                    setMovie(null);
                    movie.done();
                }} />
        );
    }
    if (menu)
    {
        return (
            <LoadMenu slots={menu.slots}
                onPick={(choice) =>
                {
                    setMenu(null);
                    menu.pick(choice);
                }} />
        );
    }
    return <TitleOverlay />;
}
