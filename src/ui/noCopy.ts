/**
 * @file noCopy.ts
 * @brief Stops the player from selecting, copying or dragging anything on the page.
 *
 * Game text is drawn into canvases (see `<PixelText>`), so it is not text
 * the browser can select in the first place. This is the second line of
 * defence for everything else: keyboard shortcuts (Ctrl+A, Ctrl+C), drag
 * selection, long presses, right-click menus and image dragging.
 */

/**
 * @brief Whether an element is a text field the player is typing in.
 * @param target Event target.
 * @return `true` for inputs and text areas.
 */
function isTextField (target: EventTarget | null): boolean
{
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * @brief Blocks selection, copying, cutting, dragging and the context menu on the whole page.
 *
 * Text fields (the name entry) can still be typed in and edited, but their
 * contents cannot be copied or cut either.
 *
 * @param root Document to protect (default the current one).
 * @return Removes the listeners again.
 */
export function blockTextCopy (root: Document = document): () => void
{
    const stop = (event: Event) => event.preventDefault();
    const stopUnlessField = (event: Event) => { if (!isTextField(event.target)) event.preventDefault(); };
    const clearSelection = () =>
    {
        const active = root.activeElement;
        if (isTextField(active)) return;
        const selection = root.getSelection();
        if (selection && !selection.isCollapsed) selection.removeAllRanges();
    };

    root.addEventListener('selectstart', stopUnlessField);
    root.addEventListener('copy', stop);
    root.addEventListener('cut', stop);
    root.addEventListener('dragstart', stop);
    root.addEventListener('contextmenu', stop);
    root.addEventListener('selectionchange', clearSelection);

    return () =>
    {
        root.removeEventListener('selectstart', stopUnlessField);
        root.removeEventListener('copy', stop);
        root.removeEventListener('cut', stop);
        root.removeEventListener('dragstart', stop);
        root.removeEventListener('contextmenu', stop);
        root.removeEventListener('selectionchange', clearSelection);
    };
}
