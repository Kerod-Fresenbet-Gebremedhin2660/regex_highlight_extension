import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import ContentApp from './ContentApp';
import './content.css';
import theme from '../theme';

const CONTAINER_ID = 'regex-highlight-extension-root';
const HOST_ID = 'regex-highlight-extension-host';

type ContainerResult = {
    container: HTMLElement;
    shadow: ShadowRoot;
};

function ensureContainer(): ContainerResult {
    let host = document.getElementById(HOST_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.style.setProperty('all', 'initial');
        host.style.setProperty('z-index', '2147483646');
        host.style.setProperty('position', 'relative');
        document.documentElement.appendChild(host);
    }

    let shadow = host.shadowRoot;
    if (!shadow) {
        shadow = host.attachShadow({ mode: 'open' });
        const styleReset = document.createElement('style');
        styleReset.textContent = `
            :host {
                all: initial;
                contain: layout style paint;
                position: relative;
                z-index: 2147483646;
                font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif;
            }
        `;
        shadow.appendChild(styleReset);
    }

    let container = shadow.getElementById(CONTAINER_ID) as HTMLElement | null;
    if (!container) {
        container = document.createElement('div');
        container.id = CONTAINER_ID;
        shadow.appendChild(container);
    }

    return { container, shadow };
}

const { container, shadow } = ensureContainer();
const cache = createCache({ key: 'mui-regex', container: shadow });
const root = createRoot(container);

root.render(
    <StrictMode>
        <CacheProvider value={cache}>
            <ThemeProvider theme={theme}>
                <ContentApp />
            </ThemeProvider>
        </CacheProvider>
    </StrictMode>
);

