/**
 * @file main.tsx
 * @brief Application bootstrap: mounts the React app, which starts the game.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('app');
if (!root) throw new Error('main: #app element not found in index.html.');

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>
);
