/**
 * @file EventDialogue.tsx
 * @brief Connects the event system's dialogue requests to the dialogue windows.
 *
 * Listens for `GameEvents.DIALOGUE_MESSAGE`, `DIALOGUE_CHOICE` and
 * `DIALOGUE_NAME_INPUT` (see src/world/dialogue.ts) and shows
 * `<MessageBox>`, `<ChoiceWindow>` and `<NameEntry>` (src/ui/dialogue/),
 * answering each request when the player is done. While any of them is up
 * the UI is marked modal (`UI_MODAL_CHANGED`), so the player does not walk.
 *
 * Text comes already translated. Restyle the windows through the skin
 * registry (src/ui/skins/skins.ts); only the requests' callbacks matter to the engine.
 */
import { useCallback, useEffect, useState } from 'react';
import { EventBus, GameEvents } from '../bus/EventBus';
import type { ChoiceRequest, DialogueRequest, NameInputRequest } from '../world/dialogue';
import { ChoiceWindow } from './dialogue/ChoiceWindow';
import { MessageBox } from './dialogue/MessageBox';
import { NameEntry } from './dialogue/NameEntry';
import { useModal } from './store/uiStore';

/** @brief A request and a number that changes for every new one (used as a React key). */
interface Pending<T>
{
    id: number;
    request: T;
}

let nextId = 1;

/**
 * @brief Draws event messages, choices and name entry over the game.
 * @return The dialogue UI, or nothing when no script is talking.
 */
export function EventDialogue ()
{
    const [message, setMessage] = useState<Pending<DialogueRequest> | null>(null);
    const [choice, setChoice] = useState<Pending<ChoiceRequest> | null>(null);
    const [nameInput, setNameInput] = useState<Pending<NameInputRequest> | null>(null);
    const [promptTyped, setPromptTyped] = useState(false);

    useEffect(() =>
    {
        const onMessage = (request: DialogueRequest) => setMessage({ id: nextId++, request });
        const onChoice = (request: ChoiceRequest) =>
        {
            setPromptTyped(false);
            setChoice({ id: nextId++, request });
        };
        const onName = (request: NameInputRequest) => setNameInput({ id: nextId++, request });
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

    useModal(!!(message || choice || nameInput));

    const closeMessage = useCallback(() =>
    {
        if (!message) return;
        setMessage(null);
        message.request.done();
    }, [message]);

    const pick = useCallback((index: number) =>
    {
        if (!choice) return;
        setChoice(null);
        choice.request.pick(index);
    }, [choice]);

    const onPromptTyped = useCallback(() => setPromptTyped(true), []);

    if (nameInput)
    {
        const { request } = nameInput;
        return (
            <NameEntry
                key={nameInput.id} prompt={request.prompt} initial={request.current} max={request.max}
                onSubmit={(name) =>
                {
                    setNameInput(null);
                    request.submit(name || request.current);
                }}
            />
        );
    }

    if (message)
    {
        const { request } = message;
        return <MessageBox key={message.id} text={request.text} speaker={request.speaker} onDone={closeMessage} />;
    }

    if (choice)
    {
        const { request } = choice;
        const showOptions = !request.prompt || promptTyped;
        return (
            <>
                {request.prompt && <MessageBox key={choice.id} text={request.prompt} waitForInput={false} onTyped={onPromptTyped} />}
                {showOptions && <ChoiceWindow key={`c${choice.id}`} options={request.options} cancel={request.cancel} onPick={pick} />}
            </>
        );
    }

    return null;
}
