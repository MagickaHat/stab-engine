/**
 * @file EventDialogue.tsx
 * @brief The message box, choice list and name entry the event system talks to.
 *
 * Listens for `GameEvents.DIALOGUE_MESSAGE`, `DIALOGUE_CHOICE` and
 * `DIALOGUE_NAME_INPUT` (see src/world/dialogue.ts) and answers each request
 * when the player is done. Buttons come from the input system (src/input), so
 * every device works the same: A (or a tap / left click) moves past a
 * message; up and down move through options and A picks one; B (or a right
 * click) cancels a choice that can be cancelled. Tapping an option picks it.
 *
 * Text comes already translated. Styles are in ui.css (`.event-dialogue`).
 * Restyle or replace this component freely; only the requests' callbacks
 * matter to the engine.
 */
import { useCallback, useEffect, useState } from 'react';
import { EventBus, GameEvents } from '../game/EventBus';
import type { ChoiceRequest, DialogueRequest, NameInputRequest } from '../world/dialogue';
import { useInputPress } from './useInput';

/**
 * @brief Draws event messages, choices and name entry over the game.
 * @return The dialogue UI, or nothing when no script is talking.
 */
export function EventDialogue ()
{
    const [message, setMessage] = useState<DialogueRequest | null>(null);
    const [choice, setChoice] = useState<ChoiceRequest | null>(null);
    const [nameInput, setNameInput] = useState<NameInputRequest | null>(null);
    const [selected, setSelected] = useState(0);
    const [name, setName] = useState('');

    useEffect(() =>
    {
        const onMessage = (request: DialogueRequest) => setMessage(request);
        const onChoice = (request: ChoiceRequest) =>
        {
            setSelected(0);
            setChoice(request);
        };
        const onName = (request: NameInputRequest) =>
        {
            setName(request.current);
            setNameInput(request);
        };
        EventBus.on(GameEvents.DIALOGUE_MESSAGE, onMessage);
        EventBus.on(GameEvents.DIALOGUE_CHOICE, onChoice);
        EventBus.on(GameEvents.DIALOGUE_NAME_INPUT, onName);
        return () =>
        {
            EventBus.off(GameEvents.DIALOGUE_MESSAGE, onMessage);
            EventBus.off(GameEvents.DIALOGUE_CHOICE, onChoice);
            EventBus.off(GameEvents.DIALOGUE_NAME_INPUT, onName);
        };
    }, []);

    const closeMessage = useCallback(() =>
    {
        if (!message) return;
        setMessage(null);
        message.done();
    }, [message]);

    const pick = useCallback((index: number) =>
    {
        if (!choice) return;
        setChoice(null);
        choice.pick(index);
    }, [choice]);

    const submitName = useCallback(() =>
    {
        if (!nameInput) return;
        setNameInput(null);
        nameInput.submit(name.trim() || nameInput.current);
    }, [nameInput, name]);

    //  While a message or choice is up, every button press belongs to it. Taps and left clicks
    //  on the box and options are handled by their own pointer handlers; a right click is B.
    useInputPress((button) =>
    {
        if (message)
        {
            if (button === 'a' || button === 'b') closeMessage();
            return true;
        }
        if (!choice) return false;
        const count = choice.options.length;
        if (button === 'up') setSelected((index) => (index + count - 1) % count);
        else if (button === 'down') setSelected((index) => (index + 1) % count);
        else if (button === 'a') pick(selected);
        else if (button === 'b' && choice.cancel >= 0) pick(choice.cancel);
        return true;
    }, !!message || !!choice);

    if (nameInput)
    {
        return (
            <form className="event-dialogue event-dialogue-box ui-interactive" onSubmit={(event) => { event.preventDefault(); submitName(); }}>
                {nameInput.prompt && <div className="event-dialogue-text">{nameInput.prompt}</div>}
                <input
                    className="event-dialogue-input" value={name} maxLength={nameInput.max} autoFocus
                    onChange={(event) => setName(event.target.value)}
                />
            </form>
        );
    }

    return (
        <>
            {(message || choice?.prompt) && (
                <div className="event-dialogue event-dialogue-box ui-interactive" onPointerDown={(event) => event.button === 0 && closeMessage()}>
                    {message?.speaker && <div className="event-dialogue-speaker">{message.speaker}</div>}
                    <div className="event-dialogue-text">{message ? message.text : choice?.prompt}</div>
                </div>
            )}
            {choice && !message && (
                <ul className="event-dialogue event-dialogue-choices ui-interactive">
                    {choice.options.map((option, index) => (
                        <li
                            key={index}
                            className={index === selected ? 'selected' : undefined}
                            onPointerEnter={() => setSelected(index)}
                            onPointerDown={(event) => event.button === 0 && pick(index)}
                        >
                            {option}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
