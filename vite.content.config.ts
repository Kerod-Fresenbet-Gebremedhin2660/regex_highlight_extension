import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react()],
    define: {
        'process.env.NODE_ENV': '"production"',
        'process.env': '{}',
        global: 'window'
    },
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        cssCodeSplit: true,
        lib: {
            entry: resolve(__dirname, 'src/content/index.tsx'),
            name: 'RegexHighlightContent',
            formats: ['iife'],
            fileName: () => 'assets/content.js',
            cssFileName: 'assets/content'
        },
        rollupOptions: {
            external: [],
            output: {
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === 'style.css') {
                        return 'assets/content.css';
                    }
                    return 'assets/[name][extname]';
                }
            }
        }
    }
});

