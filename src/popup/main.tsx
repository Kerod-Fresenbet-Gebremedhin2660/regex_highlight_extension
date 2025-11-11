import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import PopupApp from './PopupApp';
import theme from '../theme';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Popup root element not found');
}

const root = createRoot(rootElement);

root.render(
    <StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <PopupApp />
        </ThemeProvider>
    </StrictMode>
);

