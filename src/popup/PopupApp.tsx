import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Box,
    Button,
    Collapse,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Paper,
    Stack,
    Typography,
    alpha
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RegexIcon from '@mui/icons-material/AutoFixHigh';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsIcon from '@mui/icons-material/Settings';

type MessageResponse = {
    success: boolean;
};

type MatchPreview = {
    index: number;
    before: string;
    match: string;
    after: string;
    fullText: string;
};

type MatchPreviewsResponse = {
    success: boolean;
    previews: MatchPreview[];
    state: {
        matchesTotal: number;
        currentIndex: number;
        searchPattern: string;
    } | null;
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
    const theme = useTheme();
    const [matchPreviews, setMatchPreviews] = useState<MatchPreview[]>([]);
    const [matchState, setMatchState] = useState<{
        matchesTotal: number;
        currentIndex: number;
        searchPattern: string;
    } | null>(null);
    const [matchPreviewExpanded, setMatchPreviewExpanded] = useState(false);

    const fetchMatchPreviews = useCallback(async (tabId: number) => {
        try {
            const response = await sendTabMessage<MatchPreviewsResponse>(tabId, {
                action: 'getMatchPreviews'
            });

            if (response?.success) {
                setMatchPreviews(response.previews || []);
                setMatchState(response.state);
                if (response.state && response.state.matchesTotal > 0) {
                    setMatchPreviewExpanded(true);
                }
            } else {
                setMatchPreviews([]);
                setMatchState(null);
            }
        } catch (err) {
            console.error('Failed to fetch match previews', err);
            setMatchPreviews([]);
            setMatchState(null);
        }
    }, []);

    useEffect(() => {
        // Best-effort: try to load previews if available; no status UI.
        (async () => {
            try {
                const tab = await getActiveTab();
                if (tab?.id) {
                    await fetchMatchPreviews(tab.id);
                } else {
                    setMatchPreviews([]);
                    setMatchState(null);
                }
            } catch {
                setMatchPreviews([]);
                setMatchState(null);
            }
        })();

        // Poll for match preview updates when match preview is expanded
        if (matchPreviewExpanded && matchState && matchState.matchesTotal > 0) {
            const interval = setInterval(async () => {
                try {
                    const tab = await getActiveTab();
                    if (tab?.id) {
                        await fetchMatchPreviews(tab.id);
                    }
                } catch (err) {
                    console.error('Failed to poll match previews', err);
                }
            }, 1000); // Poll every second

            return () => clearInterval(interval);
        }
    }, [matchPreviewExpanded, matchState, fetchMatchPreviews]);

    const handleMatchClick = useCallback(async (matchIndex: number) => {
        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                return;
            }

            const tabId = tab.id;
            const result = await sendTabMessage<MessageResponse>(tabId, {
                action: 'jumpToMatch',
                matchIndex
            });

            if (result?.success) {
                // Refresh match previews to update active match highlighting
                setTimeout(() => {
                    void fetchMatchPreviews(tabId);
                }, 200);
            }
        } catch (err) {
            console.error('Failed to jump to match', err);
        }
    }, [fetchMatchPreviews]);

    const toggleMatchPreview = useCallback(() => {
        setMatchPreviewExpanded((prev) => !prev);
    }, []);

    const openOptions = useCallback(() => {
        if (chrome.runtime && chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        }
    }, []);

    return (
        <Paper
            elevation={0}
            sx={{
                p: 0,
                width: '100%',
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                gap: 2
            }}
        >
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                    <RegexIcon color="primary" />
                    <Typography variant="h6" fontWeight={700}>
                        Regex Highlight &amp; Search
                    </Typography>
                </Stack>
                <IconButton aria-label="Open options" onClick={openOptions} size="small">
                    <SettingsIcon />
                </IconButton>
            </Stack>
            <Divider sx={{ mx: 0, borderColor: 'common.black', opacity: 1 }} />
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
                    The widget appears on every page so you can:
                </Typography>
                <Stack spacing={0.75} sx={{ px: 2, pt: 1 }}>
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
                {matchState && matchState.matchesTotal > 0 && (
                    <>
                        <Divider sx={{ mx: 0, borderColor: 'common.black', opacity: 1, mt: 2 }} />
                        <Box sx={{ px: 2, pt: 1 }}>
                            <Button
                                variant="text"
                                size="small"
                                onClick={toggleMatchPreview}
                                endIcon={matchPreviewExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                sx={{ fontWeight: 600, width: '100%', justifyContent: 'space-between' }}
                            >
                                Match Preview ({matchState.matchesTotal})
                                {matchState.currentIndex >= 0 && (
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                        {matchState.currentIndex + 1} / {matchState.matchesTotal}
                                    </Typography>
                                )}
                            </Button>
                            <Collapse in={matchPreviewExpanded}>
                                <Box
                                    sx={{
                                        mt: 1,
                                        maxHeight: 400,
                                        overflowY: 'auto',
                                        border: '1px solid',
                                        borderColor: 'common.black',
                                        borderRadius: 1,
                                        bgcolor: 'background.default'
                                    }}
                                >
                                    <List dense sx={{ py: 0 }}>
                                        {matchPreviews.map((preview) => {
                                            const isActive = preview.index === matchState.currentIndex;
                                            return (
                                                <ListItem
                                                    key={preview.index}
                                                    disablePadding
                                                    sx={{
                                                        borderBottom: '1px solid',
                                                        borderColor: 'common.black',
                                                        bgcolor: isActive
                                                            ? alpha(theme.palette.primary.main, 0.2)
                                                            : 'transparent',
                                                        '&:hover': {
                                                            bgcolor: isActive
                                                                ? alpha(theme.palette.primary.main, 0.3)
                                                                : alpha(theme.palette.action.hover, 0.1)
                                                        }
                                                    }}
                                                >
                                                    <ListItemButton
                                                        onClick={() => handleMatchClick(preview.index)}
                                                        sx={{ py: 1, px: 1.5 }}
                                                    >
                                                        <ListItemText
                                                            primary={
                                                                <Typography
                                                                    variant="caption"
                                                                    fontWeight={600}
                                                                    color="text.secondary"
                                                                    sx={{ mb: 0.5 }}
                                                                >
                                                                    Match {preview.index + 1} of {matchState.matchesTotal}
                                                                </Typography>
                                                            }
                                                            secondary={
                                                                <Typography
                                                                    variant="body2"
                                                                    sx={{
                                                                        fontFamily: 'monospace',
                                                                        fontSize: '0.75rem',
                                                                        lineHeight: 1.5,
                                                                        wordBreak: 'break-word',
                                                                        whiteSpace: 'pre-wrap'
                                                                    }}
                                                                >
                                                                    <span style={{ opacity: 0.6 }}>{preview.before}</span>
                                                                    <span
                                                                        style={{
                                                                            backgroundColor: alpha(
                                                                                theme.palette.success.main,
                                                                                0.3
                                                                            ),
                                                                            fontWeight: 600,
                                                                            padding: '0 2px',
                                                                            borderRadius: '2px'
                                                                        }}
                                                                    >
                                                                        {preview.match}
                                                                    </span>
                                                                    <span style={{ opacity: 0.6 }}>{preview.after}</span>
                                                                </Typography>
                                                            }
                                                            primaryTypographyProps={{
                                                                component: 'div'
                                                            }}
                                                            secondaryTypographyProps={{
                                                                component: 'div'
                                                            }}
                                                        />
                                                    </ListItemButton>
                                                </ListItem>
                                            );
                                        })}
                                    </List>
                                </Box>
                            </Collapse>
                        </Box>
                    </>
                )}
                <Divider sx={{ mx: 0, borderColor: 'common.black', opacity: 1, mt: 2 }} />
                <Stack spacing={1} sx={{ px: 2, pt: 1, pb: 2 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <KeyboardIcon color="primary" />
                        <Typography variant="subtitle2" fontWeight={600}>
                            Keyboard Shortcuts
                        </Typography>
                    </Stack>
                    <Box>
                        <Typography variant="body2" color="text.secondary">
                            Cmd + Shift + F
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
            </Box>
            <Box
                sx={{
                    position: 'sticky',
                    bottom: 0,
                    textAlign: 'center',
                    py: 1,
                    bgcolor: 'background.paper',
                    borderTop: '1px solid',
                    borderColor: 'common.black'
                }}
            >
                <Typography variant="caption" color="text.secondary">
                    Keyboard shortcuts available
                </Typography>
            </Box>
        </Paper>
    );
};

export default PopupApp;

