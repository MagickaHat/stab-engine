import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser'],
                    pkmn: ['@pkmn/sim']
                }
            }
        },
    },
    server: {
        port: 8080
    }
});
