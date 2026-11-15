import { defineConfig } from 'vite';
import inkPlugin from './plugins/ink.mjs';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser'],
                    pkmn: ['@pkmn/sim', '@pkmn/protocol', '@pkmn/client', '@pkmn/data'],
                    ink: ['inkjs']
                }
            }
        },
    },
    plugins: [
        inkPlugin()
    ],
    server: {
        port: 8080
    }
});
