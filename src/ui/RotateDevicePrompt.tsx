/**
 * @file RotateDevicePrompt.tsx
 * @brief Full-screen "rotate your device" message for phones held upright.
 */
import './ui.css';

/** @brief Props of `<RotateDevicePrompt>`. */
export interface RotateDevicePromptProps
{
    /** Text to show. Defaults to an English message. */
    message?: string;
}

/**
 * @brief Covers the screen with a message while a touch device is in portrait.
 *
 * The element is always rendered; `ui.css` only shows it when the screen is
 * taller than it is wide and the main input is touch
 * (`(orientation: portrait) and (pointer: coarse)`). A narrow desktop browser
 * window is therefore never blocked.
 *
 * Render it outside `<UiLayer>` so it covers the whole screen, not just the game.
 *
 * @param props See `RotateDevicePromptProps`.
 * @return The prompt element.
 */
export function RotateDevicePrompt ({ message = 'Please rotate your device' }: RotateDevicePromptProps)
{
    return (
        <div className="rotate-prompt" role="alert">
            <div className="rotate-prompt-icon" aria-hidden="true" />
            <p>{message}</p>
        </div>
    );
}
