import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
            entry: resolve(__dirname, 'src/background/background.ts'),
            name: 'RegexHighlightBackground',
            formats: ['es'],
            fileName: () => 'assets/background.js'
        },
        rollupOptions: {
            output: {
                entryFileNames: 'assets/background.js'
            }
        }
    }
});

