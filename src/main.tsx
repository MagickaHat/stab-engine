/**
 * @file main.tsx
 * @brief Application bootstrap: mounts the React app, which starts the game.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { blockTextCopy } from './ui/noCopy';
import { connectUiStore } from './ui/store/uiStore';

const root = document.getElementById('app');
if (!root) throw new Error('main: #app element not found in index.html.');

// Listen to the bus before the game starts, so the UI store sees the first scene and viewport.
connectUiStore();
// Game text cannot be selected, copied or dragged out of the page.
blockTextCopy();

if (import.meta.env.DEV) void import('./devtools').then(({ installDevtools }) => installDevtools());

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>
);
