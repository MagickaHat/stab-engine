import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import inkPlugin from './plugins/ink.mjs';
import eventsPlugin from './plugins/events.mjs';
import localesPlugin from './plugins/locales.mjs';

const phasermsg = () => {
    return {
        name: 'phasermsg',
        buildStart() {
            process.stdout.write(`Building for production...\n`);
        },
        buildEnd() {
            const line = "---------------------------------------------------------";
            const msg = `❤️❤️❤️ Tell us about your game! - games@phaser.io ❤️❤️❤️`;
            process.stdout.write(`${line}\n${msg}\n${line}\n`);
            
            process.stdout.write(`✨ Done ✨\n`);
        }
    }
}   

export default defineConfig({
    base: './',
    logLevel: 'warning',
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
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 2
            },
            mangle: true,
            format: {
                comments: false
            }
        }
    },
    server: {
        port: 8080
    },
    plugins: [
        phasermsg(),
        react(),
        inkPlugin(),
        eventsPlugin(),
        localesPlugin()
    ]
});
