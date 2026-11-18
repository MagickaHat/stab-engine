/**
 * @file EventDialogue.tsx
 * @brief Connects the event system's dialogue requests to the dialogue windows.
 *
 * Listens for `GameEvents.DIALOGUE_MESSAGE`, `DIALOGUE_CHOICE`,
 * `DIALOGUE_NAME_INPUT`, `DIALOGUE_LANGUAGE` and `DIALOGUE_POKEDEX_ENTRY`
 * (see src/world/dialogue.ts) and shows `<MessageBox>`, `<ChoiceWindow>`,
 * `<NameEntryKeyboard>` (src/ui/dialogue/), `<LanguageSelect>` and
 * `<PokedexEntry>` (src/ui/menus/), answering each request when the player is done. While any of them is up
 * the UI is marked modal (`UI_MODAL_CHANGED`), so the player does not walk.
 *
 * Text comes already translated. Restyle the windows through the skin
 * registry (src/ui/skins/skins.ts); only the requests' callbacks matter to the engine.
 */
import { useCallback, useEffect, useState } from 'react';
import { EventBus, GameEvents } from '../bus/EventBus';
import type { ChoiceRequest, DialogueRequest, LanguageRequest, NameInputRequest, PokedexEntryRequest } from '../world/dialogue';
import { ChoiceWindow } from './dialogue/ChoiceWindow';
import { MessageBox } from './dialogue/MessageBox';
import { NameEntryKeyboard } from './dialogue/NameEntryKeyboard';
import { LanguageSelect } from './menus/LanguageSelect';
import { PokedexEntry } from './menus/PokedexEntry';
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
    const [language, setLanguage] = useState<Pending<LanguageRequest> | null>(null);
    const [dex, setDex] = useState<Pending<PokedexEntryRequest> | null>(null);
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
        const onLanguage = (request: LanguageRequest) => setLanguage({ id: nextId++, request });
        const onDex = (request: PokedexEntryRequest) => setDex({ id: nextId++, request });
        EventBus.on(GameEvents.DIALOGUE_MESSAGE, onMessage);
        EventBus.on(GameEvents.DIALOGUE_CHOICE, onChoice);
        EventBus.on(GameEvents.DIALOGUE_NAME_INPUT, onName);
        EventBus.on(GameEvents.DIALOGUE_LANGUAGE, onLanguage);
        EventBus.on(GameEvents.DIALOGUE_POKEDEX_ENTRY, onDex);
        return () =>
        {
            EventBus.off(GameEvents.DIALOGUE_MESSAGE, onMessage);
            EventBus.off(GameEvents.DIALOGUE_CHOICE, onChoice);
            EventBus.off(GameEvents.DIALOGUE_NAME_INPUT, onName);
            EventBus.off(GameEvents.DIALOGUE_LANGUAGE, onLanguage);
            EventBus.off(GameEvents.DIALOGUE_POKEDEX_ENTRY, onDex);
        };
    }, []);

    useModal(!!(message || choice || nameInput || language || dex));

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

    if (language)
    {
        const { request } = language;
        return (
            <LanguageSelect
                key={language.id} initial={request.initial}
                onPick={(locale) =>
                {
                    setLanguage(null);
                    request.pick(locale);
                }}
            />
        );
    }

    if (dex)
    {
        const { request } = dex;
        return (
            <PokedexEntry
                key={dex.id} species={request.species} languages={request.languages}
                onClose={() =>
                {
                    setDex(null);
                    request.done();
                }}
            />
        );
    }

    if (nameInput)
    {
        const { request } = nameInput;
        return (
            <NameEntryKeyboard
                key={nameInput.id} prompt={request.prompt} initial={request.current} max={request.max}
                language={request.language} pokemon={!!request.species}
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
