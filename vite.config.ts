import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
    plugins: [
        react(),
        viteStaticCopy({
            targets: [
                {
                    src: 'public/manifest.json',
                    dest: '.'
                }
            ]
        })
    ],
    define: {
        'process.env.NODE_ENV': '"production"',
        'process.env': '{}',
        global: 'window'
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'popup.html'),
                options: resolve(__dirname, 'options.html')
            },
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === 'style.css' && (process.env.VITE_BUILD_PAGE || '').includes('popup')) {
                        return 'assets/popup.css';
                    }
                    return 'assets/[name][extname]';
                }
            }
        }
    }
});

