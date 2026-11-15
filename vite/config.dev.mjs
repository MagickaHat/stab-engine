import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import inkPlugin from './plugins/ink.mjs';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser'],
                    react: ['react', 'react-dom'],
                    pkmn: ['@pkmn/sim', '@pkmn/protocol', '@pkmn/client', '@pkmn/data'],
                    ink: ['inkjs']
                }
            }
        },
    },
    plugins: [
        react(),
        inkPlugin()
    ],
    server: {
        port: 8080
    }
});
