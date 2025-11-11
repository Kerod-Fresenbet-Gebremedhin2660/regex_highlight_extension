import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ContentApp from './ContentApp';
import './content.css';

const CONTAINER_ID = 'regex-highlight-extension-root';

function ensureContainer(): HTMLElement {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
        container = document.createElement('div');
        container.id = CONTAINER_ID;
        document.documentElement.appendChild(container);
    }
    return container;
}

const container = ensureContainer();
const root = createRoot(container);

root.render(
    <StrictMode>
        <ContentApp />
    </StrictMode>
);

