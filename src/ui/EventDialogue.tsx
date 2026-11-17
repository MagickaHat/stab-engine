/**
 * @file EventDialogue.tsx
 * @brief The message box, choice list and name entry the event system talks to.
 *
 * Listens for `GameEvents.DIALOGUE_MESSAGE`, `DIALOGUE_CHOICE` and
 * `DIALOGUE_NAME_INPUT` (see src/world/dialogue.ts) and answers each request
 * when the player is done: a tap or the action key (Z, Space, Enter) moves
 * past a message; arrow keys and the action key, or a tap, pick an option;
 * X or Escape cancels a choice that can be cancelled.
 *
 * Text comes already translated. Styles are in ui.css (`.event-dialogue`).
 * Restyle or replace this component freely; only the requests' callbacks
 * matter to the engine.
 */
import { useCallback, useEffect, useState } from 'react';
import { EventBus, GameEvents } from '../game/EventBus';
import type { ChoiceRequest, DialogueRequest, NameInputRequest } from '../world/dialogue';

/** @brief Keys that confirm. */
const CONFIRM = new Set(['z', 'Z', ' ', 'Enter']);

/** @brief Keys that cancel. */
const CANCEL = new Set(['x', 'X', 'Escape']);

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

    useEffect(() =>
    {
        if (!message && !choice) return undefined;
        const onKey = (event: KeyboardEvent) =>
        {
            if (event.repeat) return;
            if (choice)
            {
                const count = choice.options.length;
                if (event.key === 'ArrowUp') setSelected((index) => (index + count - 1) % count);
                else if (event.key === 'ArrowDown') setSelected((index) => (index + 1) % count);
                else if (CONFIRM.has(event.key)) pick(selected);
                else if (CANCEL.has(event.key) && choice.cancel >= 0) pick(choice.cancel);
                return;
            }
            if (CONFIRM.has(event.key)) closeMessage();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [message, choice, selected, pick, closeMessage]);

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
                <div className="event-dialogue event-dialogue-box ui-interactive" onPointerDown={closeMessage}>
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
                            onPointerDown={() => pick(index)}
                        >
                            {option}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
