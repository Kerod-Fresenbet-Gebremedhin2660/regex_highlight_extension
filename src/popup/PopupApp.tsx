import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Divider,
    Paper,
    Stack,
    Typography
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RegexIcon from '@mui/icons-material/AutoFixHigh';
import KeyboardIcon from '@mui/icons-material/Keyboard';

type WidgetStateResponse = {
    success: boolean;
    isHidden: boolean;
};

type MessageResponse = {
    success: boolean;
};

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs[0]);
        });
    });
}

async function sendTabMessage<T>(
    tabId: number,
    message: Record<string, unknown>
): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                reject(runtimeError);
                return;
            }
            resolve(response as T | undefined);
        });
    });
}

const PopupApp = () => {
    const [isLoading, setIsLoading] = useState(true);
    const [isHidden, setIsHidden] = useState<boolean | null>(null);
    const [statusText, setStatusText] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const statusMessage = useMemo(() => {
        if (error) {
            return { severity: 'error' as const, text: error };
        }
        if (statusText) {
            return {
                severity: isHidden ? ('warning' as const) : ('success' as const),
                text: statusText
            };
        }
        return { severity: 'info' as const, text: 'Widget status unknown' };
    }, [error, isHidden, statusText]);

    const refreshState = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                setIsHidden(null);
                setStatusText('No active tab found');
                setIsLoading(false);
                return;
            }

            const response = await sendTabMessage<WidgetStateResponse>(tab.id, {
                action: 'getWidgetState'
            });

            if (response?.success && typeof response.isHidden === 'boolean') {
                setIsHidden(response.isHidden);
                setStatusText(response.isHidden ? 'Widget is hidden' : 'Widget is visible');
            } else {
                setIsHidden(null);
                setStatusText('Widget not available on this page');
            }
        } catch (err) {
            console.error('Failed to get widget state', err);
            setError('Widget not available on this page');
            setIsHidden(null);
            setStatusText('');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refreshState();
    }, [refreshState]);

    const handleToggle = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                setError('No active tab found');
                return;
            }

            const currentState = await sendTabMessage<WidgetStateResponse>(tab.id, {
                action: 'getWidgetState'
            });

            if (!currentState?.success || typeof currentState.isHidden !== 'boolean') {
                setError('Widget is not available on this page');
                return;
            }

            const nextAction = currentState.isHidden ? 'showWidget' : 'hideWidget';
            const result = await sendTabMessage<MessageResponse>(tab.id, {
                action: nextAction
            });

            if (!result?.success) {
                setError('Unable to toggle widget');
                return;
            }

            // Give the content script a moment to update before refreshing
            setTimeout(() => {
                void refreshState();
            }, 150);
        } catch (err) {
            console.error('Failed to toggle widget', err);
            setError('Unable to communicate with the widget');
        } finally {
            setIsLoading(false);
        }
    }, [refreshState]);

    const isToggleDisabled = isHidden === null || isLoading;

    return (
        <Paper
            elevation={6}
            sx={{
                p: 2,
                width: 320,
                maxWidth: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 2
            }}
        >
            <Stack direction="row" spacing={1.5} alignItems="center">
                <RegexIcon color="primary" />
                <Typography variant="h6" fontWeight={700}>
                    Regex Highlight &amp; Search
                </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
                The widget appears on every page so you can:
            </Typography>
            <Stack spacing={0.75}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <ChevronRightIcon fontSize="small" color="primary" />
                    <Typography variant="body2">Enter regex patterns with live validation</Typography>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                    <ChevronRightIcon fontSize="small" color="primary" />
                    <Typography variant="body2">Highlight every match and jump between them</Typography>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                    <ChevronRightIcon fontSize="small" color="primary" />
                    <Typography variant="body2">Save your favourite searches for quick reuse</Typography>
                </Stack>
            </Stack>
            <Button
                onClick={handleToggle}
                disabled={isToggleDisabled}
                endIcon={
                    isLoading ? (
                        <CircularProgress size={16} color="inherit" />
                    ) : (
                        <ChevronRightIcon fontSize="small" />
                    )
                }
            >
                {isHidden ? 'Show Widget' : 'Hide Widget'}
            </Button>
            <Alert severity={statusMessage.severity} variant="outlined">
                {statusMessage.text}
            </Alert>
            <Divider />
            <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <KeyboardIcon color="primary" />
                    <Typography variant="subtitle2" fontWeight={600}>
                        Keyboard Shortcuts
                    </Typography>
                </Stack>
                <Box>
                    <Typography variant="body2" color="text.secondary">
                        Ctrl/Cmd + Shift + F
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Toggle the widget (expand if minimized, minimize if open)
                    </Typography>
                </Box>
                <Box>
                    <Typography variant="body2" color="text.secondary">
                        F3 / Shift + F3
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        Jump to the next or previous match
                    </Typography>
                </Box>
            </Stack>
        </Paper>
    );
};

export default PopupApp;

