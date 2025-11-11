import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PopupApp from './PopupApp';
import './popup.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Popup root element not found');
}

const root = createRoot(rootElement);

root.render(
    <StrictMode>
        <PopupApp />
    </StrictMode>
);

