import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    Chip,
    Collapse,
    Divider,
    FormControlLabel,
    FormGroup,
    IconButton,
    InputAdornment,
    Paper,
    Stack,
    Switch,
    TextField,
    Tooltip,
    Typography,
    Checkbox,
    ScopedCssBaseline
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import {
    RegexHighlighter,
    RegexFlags,
    HighlighterState
} from './RegexHighlighter';

const OVERLAY_ID = 'regex-highlight-ui';
const MARKERS_ID = 'regex-scrollbar-markers';
const COLLAPSIBLE_SETTING_KEY = 'regex-highlight-setting-collapsibleExpanded';
const MINIMIZED_SETTING_KEY = 'regex-highlight-setting-minimized';
const HIDDEN_SETTING_KEY = 'regex-highlight-setting-hidden';

type OverlayPosition = {
    top: number;
    right: number;
};

const defaultState: HighlighterState = {
    searchPattern: '',
    matchesTotal: 0,
    currentIndex: -1,
    matchTypes: [],
    matchTypeCounts: {},
    savedPatterns: [],
    regexFlags: {
        global: true,
        ignoreCase: true,
        multiline: false,
        dotAll: false
    },
    scrollOnSearch: false
};

const loadBooleanSetting = (key: string, fallback: boolean) => {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }
        return JSON.parse(raw) as boolean;
    } catch {
        return fallback;
    }
};

const saveBooleanSetting = (key: string, value: boolean) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn('Unable to persist setting', key, error);
    }
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const ContentApp = () => {
    const theme = useTheme();
    const highlighterRef = useRef<RegexHighlighter | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const markerContainerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const dragStateRef = useRef<{
        isDragging: boolean;
        startY: number;
        startTop: number;
        startRight: number;
        deltaY: number;
    }>({
        isDragging: false,
        startY: 0,
        startTop: 0,
        startRight: 36,
        deltaY: 0
    });
    const inputDirtyRef = useRef(false);

    const [highlighterState, setHighlighterState] = useState<HighlighterState>(defaultState);
    const [searchInput, setSearchInput] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isMinimized, setIsMinimized] = useState(() => loadBooleanSetting(MINIMIZED_SETTING_KEY, true));
    const [isHidden, setIsHidden] = useState(() => loadBooleanSetting(HIDDEN_SETTING_KEY, false));
    const [collapsibleExpanded, setCollapsibleExpanded] = useState(() =>
        loadBooleanSetting(COLLAPSIBLE_SETTING_KEY, true)
    );
    const [overlayPosition, setOverlayPosition] = useState<OverlayPosition>(() => {
        const fallback: OverlayPosition = { top: 10, right: 36 };
        try {
            const stored = localStorage.getItem('regex-highlight-position');
            if (stored) {
                const parsed = JSON.parse(stored) as Partial<OverlayPosition>;
                return {
                    top: typeof parsed.top === 'number' ? parsed.top : fallback.top,
                    right: typeof parsed.right === 'number' ? parsed.right : fallback.right
                };
            }
        } catch {
            // ignore
        }
        return fallback;
    });
    const hasMatches = highlighterState.matchesTotal > 0;
    const currentDisplayIndex = hasMatches ? highlighterState.currentIndex + 1 : 0;

    const statusInfo = useMemo(() => {
        if (!highlighterState.searchPattern.trim()) {
            return {
                color: theme.palette.grey[400],
                shadow: alpha(theme.palette.grey[500], 0.35),
                title: 'No active search'
            };
        }
        if (highlighterState.matchesTotal > 0) {
            return {
                color: theme.palette.success.main,
                shadow: alpha(theme.palette.success.main, 0.35),
                title: `Search active: ${highlighterState.matchesTotal} match${highlighterState.matchesTotal === 1 ? '' : 'es'} found`
            };
        }
        return {
            color: theme.palette.error.main,
            shadow: alpha(theme.palette.error.main, 0.35),
            title: 'Search active: No matches found'
        };
    }, [highlighterState.matchesTotal, highlighterState.searchPattern, theme]);

    const matchTypeSummary = useMemo(() => {
        const entries = Object.entries(highlighterState.matchTypeCounts);
        if (!entries.length) {
            return '';
        }
        return entries.map(([name, count]) => `${name}: ${count}`).join(', ');
    }, [highlighterState.matchTypeCounts]);

    const showMiniChip = (isHidden || isMinimized) && highlighterState.searchPattern.trim();
    const chipLabel = highlighterState.searchPattern.trim()
        ? highlighterState.matchesTotal > 0
            ? `${currentDisplayIndex}/${highlighterState.matchesTotal}`
            : 'No matches'
        : 'Regex ready';

    const handleMiniChipClick = useCallback(() => {
        if (isHidden) {
            setIsHidden(false);
            saveBooleanSetting(HIDDEN_SETTING_KEY, false);
        } else if (isMinimized) {
            setIsMinimized(false);
            saveBooleanSetting(MINIMIZED_SETTING_KEY, false);
        }
    }, [isHidden, isMinimized]);

    const updateOverlayPosition = useCallback(
        (position: OverlayPosition) => {
            const overlay = overlayRef.current;
            if (!overlay) {
                return;
            }
            setOverlayPosition(position);
            overlay.style.top = `${position.top}px`;
            overlay.style.right = `${position.right}px`;
            overlay.style.left = 'auto';
            overlay.style.bottom = 'auto';
            highlighterRef.current?.saveOverlayPosition(position);
        },
        []
    );

    const ensureMarkerContainer = useCallback(() => {
        const overlay = overlayRef.current;
        const rootNode = overlay?.getRootNode() ?? document;
        const parent =
            rootNode instanceof ShadowRoot ? rootNode : document.body;

        if (
            markerContainerRef.current &&
            parent.contains(markerContainerRef.current)
        ) {
            return markerContainerRef.current;
        }

        const container = document.createElement('div');
        container.id = MARKERS_ID;
        container.className = 'regex-scrollbar-markers';
        parent.appendChild(container);
        markerContainerRef.current = container;
        return container;
    }, []);

    useEffect(() => {
        const container = ensureMarkerContainer();
        const highlighter = new RegexHighlighter({
            onStateChange: (state) => {
                setHighlighterState(state);
                if (!inputDirtyRef.current) {
                    setSearchInput(state.searchPattern);
                }
            },
            onPatternRestored: (pattern) => {
                inputDirtyRef.current = false;
                setSearchInput(pattern);
            }
        });
        highlighterRef.current = highlighter;

        const overlay = overlayRef.current;
        if (overlay) {
            highlighter.attachOverlayElements(overlay, container);
            const savedPosition = highlighter.loadOverlayPosition();
            if (savedPosition) {
                updateOverlayPosition({
                    top: savedPosition.top,
                    right: savedPosition.right
                });
            }
        }

        void highlighter.restoreSearchIfSameDomain();

        return () => {
            highlighter.destroy();
            if (markerContainerRef.current?.isConnected) {
                markerContainerRef.current.remove();
                markerContainerRef.current = null;
            }
        };
    }, [ensureMarkerContainer, updateOverlayPosition]);

    useEffect(() => {
        const overlay = overlayRef.current;
        const container = markerContainerRef.current;
        const highlighter = highlighterRef.current;
        if (overlay && container && highlighter) {
            highlighter.attachOverlayElements(overlay, container);
            overlay.style.top = `${overlayPosition.top}px`;
            overlay.style.right = `${overlayPosition.right}px`;
            overlay.style.left = 'auto';
        }
    }, [overlayPosition]);

    const handleSearch = useCallback(async () => {
        const pattern = searchInput.trim();
        if (!pattern || pattern.length < 2) {
            return;
        }
        const highlighter = highlighterRef.current;
        if (!highlighter) {
            return;
        }
        setValidationError(null);
        try {
            await highlighter.search(pattern);
            inputDirtyRef.current = false;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid regex pattern';
            setValidationError(message);
        }
    }, [searchInput]);

    const handleClear = useCallback(async () => {
        const highlighter = highlighterRef.current;
        if (!highlighter) {
            return;
        }
        await highlighter.clear();
        setSearchInput('');
        inputDirtyRef.current = false;
        setValidationError(null);
    }, []);

    const handleScrollOnSearchChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const checked = event.target.checked;
            highlighterRef.current?.setScrollOnSearch(checked);
            setHighlighterState((prev) => ({
                ...prev,
                scrollOnSearch: checked
            }));
        },
        []
    );

    const handleFlagChange = useCallback((flag: keyof RegexFlags) => {
        return (event: React.ChangeEvent<HTMLInputElement>) => {
            const checked = event.target.checked;
            highlighterRef.current?.setRegexFlag(flag, checked);
            setHighlighterState((prev) => ({
                ...prev,
                regexFlags: {
                    ...prev.regexFlags,
                    [flag]: checked
                }
            }));
        };
    }, []);

    const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setSearchInput(value);
        inputDirtyRef.current = true;
        if (!value.trim()) {
            setValidationError(null);
            return;
        }
        try {
            const flags = highlighterState.regexFlags;
            const flagString =
                `${flags.global ? 'g' : ''}` +
                `${flags.ignoreCase ? 'i' : ''}` +
                `${flags.multiline ? 'm' : ''}` +
                `${flags.dotAll ? 's' : ''}`;
            // eslint-disable-next-line no-new
            new RegExp(value, flagString);
            setValidationError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid regex pattern';
            setValidationError(message);
        }
    }, [highlighterState.regexFlags]);

    const handleInputKeyPress = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void handleSearch();
            }
        },
        [handleSearch]
    );

    const toggleMinimize = useCallback(() => {
        setIsMinimized((prev) => {
            const next = !prev;
            saveBooleanSetting(MINIMIZED_SETTING_KEY, next);
            return next;
        });
    }, []);

    const toggleCollapsible = useCallback(() => {
        setCollapsibleExpanded((prev) => {
            const next = !prev;
            saveBooleanSetting(COLLAPSIBLE_SETTING_KEY, next);
            return next;
        });
    }, []);


    const handlePatternChipClick = useCallback((pattern: string) => {
        setSearchInput(pattern);
        inputDirtyRef.current = false;
        setValidationError(null);
        if (pattern.trim().length >= 2) {
            void highlighterRef.current?.search(pattern);
        }
    }, []);

    const handlePatternDelete = useCallback((index: number) => {
        highlighterRef.current?.deletePattern(index);
    }, []);

    const handleToggleVisibility = useCallback(() => {
        setIsHidden((prev) => {
            const next = !prev;
            saveBooleanSetting(HIDDEN_SETTING_KEY, next);
            return next;
        });
    }, []);

    useEffect(() => {
        const keydownHandler = (event: KeyboardEvent) => {
            const overlay = overlayRef.current;
            if (!overlay || isHidden) {
                return;
            }
            const key = event.key ? event.key.toLowerCase() : '';
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'f') {
                event.preventDefault();
                if (isMinimized) {
                    setIsMinimized(false);
                    saveBooleanSetting(MINIMIZED_SETTING_KEY, false);
                    requestAnimationFrame(() => {
                        if (inputRef.current) {
                            const selected = window.getSelection()?.toString().trim();
                            if (selected) {
                                inputRef.current.value = selected;
                                setSearchInput(selected);
                                void handleSearch();
                            } else {
                                inputRef.current.focus();
                                inputRef.current.select();
                            }
                        }
                    });
                } else {
                    setIsMinimized(true);
                    saveBooleanSetting(MINIMIZED_SETTING_KEY, true);
                }
            }
        };
        document.addEventListener('keydown', keydownHandler, true);
        return () => {
            document.removeEventListener('keydown', keydownHandler, true);
        };
    }, [handleSearch, isHidden, isMinimized]);

    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) {
            return;
        }
        const dragHandle = overlay.querySelector('.regex-drag-handle') as HTMLElement | null;
        if (!dragHandle) {
            return;
        }

        const startDrag = (clientY: number) => {
            if (!overlay) return;
            dragStateRef.current.isDragging = true;
            dragStateRef.current.startY = clientY;
            dragStateRef.current.startTop = overlayPosition.top;
            dragStateRef.current.startRight = overlayPosition.right;
            dragStateRef.current.deltaY = 0;
            overlay.style.transition = 'none';
        };

        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('#regex-minimize-btn')) {
                return;
            }
            startDrag(event.clientY);
            event.preventDefault();
        };

        const handleMouseMove = (event: MouseEvent) => {
            if (!dragStateRef.current.isDragging || !overlay) {
                return;
            }
            const deltaY = event.clientY - dragStateRef.current.startY;
            const height = overlay.getBoundingClientRect().height;
            const maxTop = window.innerHeight - height;
            const newTop = clamp(dragStateRef.current.startTop + deltaY, 0, maxTop);
            dragStateRef.current.deltaY = newTop - dragStateRef.current.startTop;
            highlighterRef.current?.applyOverlayTransform(dragStateRef.current.deltaY);
        };

        const endDrag = () => {
            if (!dragStateRef.current.isDragging || !overlay) {
                return;
            }
            dragStateRef.current.isDragging = false;
            overlay.style.transition = '';
            const height = overlay.getBoundingClientRect().height;
            const maxTop = window.innerHeight - height;
            const finalTop = clamp(dragStateRef.current.startTop + dragStateRef.current.deltaY, 0, maxTop);
            dragStateRef.current.deltaY = 0;
            highlighterRef.current?.applyOverlayTransform(0);
            updateOverlayPosition({
                top: finalTop,
                right: dragStateRef.current.startRight
            });
        };

        dragHandle.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', endDrag);

        const handleTouchStart = (event: TouchEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('#regex-minimize-btn')) {
                return;
            }
            const touch = event.touches[0];
            startDrag(touch.clientY);
            event.preventDefault();
        };

        const handleTouchMove = (event: TouchEvent) => {
            if (!dragStateRef.current.isDragging || !overlay) {
                return;
            }
            const touch = event.touches[0];
            const deltaY = touch.clientY - dragStateRef.current.startY;
            const height = overlay.getBoundingClientRect().height;
            const maxTop = window.innerHeight - height;
            const newTop = clamp(dragStateRef.current.startTop + deltaY, 0, maxTop);
            dragStateRef.current.deltaY = newTop - dragStateRef.current.startTop;
            highlighterRef.current?.applyOverlayTransform(dragStateRef.current.deltaY);
            event.preventDefault();
        };

        const handleTouchEnd = () => {
            endDrag();
        };

        dragHandle.addEventListener('touchstart', handleTouchStart, { passive: false });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
            dragHandle.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', endDrag);
            dragHandle.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
    }, [overlayPosition.top, updateOverlayPosition]);

    useEffect(() => {
        const handleResize = () => {
            const overlay = overlayRef.current;
            if (!overlay) {
                return;
            }
            const rect = overlay.getBoundingClientRect();
            const maxTop = window.innerHeight - rect.height;
            const newTop = clamp(rect.top, 0, Math.max(0, maxTop));
            updateOverlayPosition({
                top: newTop,
                right: overlayPosition.right
            });
            highlighterRef.current?.updateUIScale();
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [overlayPosition.right, updateOverlayPosition]);

    useEffect(() => {
        const messageHandler = (
            message: { action: string; pattern?: string; matchIndex?: number },
            _sender: chrome.runtime.MessageSender,
            sendResponse: (response: any) => void
        ) => {
            switch (message.action) {
                case 'search':
                    if (message.pattern) {
                        const trimmed = message.pattern.trim();
                        if (trimmed.length < 2) {
                            setValidationError('Enter at least two characters');
                            sendResponse({ success: false });
                            return true;
                        }
                        setSearchInput(trimmed);
                        void highlighterRef.current?.search(trimmed).then(
                            () => sendResponse({ success: true }),
                            () => sendResponse({ success: false })
                        );
                        return true;
                    }
                    break;
                case 'clear':
                    void highlighterRef.current?.clear().then(() => sendResponse({ success: true }));
                    return true;
                case 'getWidgetState':
                    sendResponse({ success: true, isHidden });
                    return true;
                case 'hideWidget':
                    setIsHidden(true);
                    saveBooleanSetting(HIDDEN_SETTING_KEY, true);
                    sendResponse({ success: true });
                    return true;
                case 'showWidget':
                    setIsHidden(false);
                    saveBooleanSetting(HIDDEN_SETTING_KEY, false);
                    sendResponse({ success: true });
                    return true;
                case 'getMatchPreviews':
                    if (highlighterRef.current) {
                        const previews = highlighterRef.current.getAllMatchPreviews(40);
                        sendResponse({
                            success: true,
                            previews,
                            state: {
                                matchesTotal: highlighterState.matchesTotal,
                                currentIndex: highlighterState.currentIndex,
                                searchPattern: highlighterState.searchPattern
                            }
                        });
                    } else {
                        sendResponse({ success: false, previews: [], state: null });
                    }
                    return true;
                case 'jumpToMatch':
                    if (typeof message.matchIndex === 'number' && highlighterRef.current) {
                        highlighterRef.current.jumpToMatch(message.matchIndex);
                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false });
                    }
                    return true;
                default:
                    break;
            }
            sendResponse({ success: false });
            return false;
        };

        chrome.runtime.onMessage.addListener(messageHandler);
        return () => {
            chrome.runtime.onMessage.removeListener(messageHandler);
        };
    }, [isHidden, highlighterState]);

    const renderPatternHistory = () => {
        if (!highlighterState.savedPatterns.length) {
            return (
                <Typography variant="body2" color="text.secondary">
                    Saved searches will appear here.
                </Typography>
            );
        }
        return (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {highlighterState.savedPatterns.map((pattern, index) => (
                    <Chip
                        key={`${pattern}-${index}`}
                        label={pattern}
                        size="small"
                        color="primary"
                        variant="outlined"
                        onClick={() => handlePatternChipClick(pattern)}
                        onDelete={() => handlePatternDelete(index)}
                    />
                ))}
            </Stack>
        );
    };

    const helperText = validationError ? `Invalid regex: ${validationError}` : ' ';
    const overlayWidth = isMinimized ? 132 : 288;
    const headerCursor = dragStateRef.current.isDragging ? 'grabbing' : 'grab';

    return (
        <ScopedCssBaseline>
            <Paper
                id={OVERLAY_ID}
                ref={overlayRef}
                className={isMinimized ? 'minimized' : ''}
                elevation={12}
                sx={{
                    position: 'fixed',
                    top: overlayPosition.top,
                    right: overlayPosition.right,
                    left: 'auto',
                    bottom: 'auto',
                    display: isHidden ? 'none' : 'flex',
                    flexDirection: 'column',
                    width: overlayWidth,
                    maxHeight: '85vh',
                    overflow: 'hidden',
                    border: '1px solid rgba(0,0,0,0.08)',
                    zIndex: 2147483647
                }}
            >
                <Box
                    className="regex-drag-handle"
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 1.25,
                        py: 0.75,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        cursor: headerCursor,
                        userSelect: 'none'
                    }}
                >
                    <Stack direction="row" spacing={1} alignItems="center">
                        <DragIndicatorIcon fontSize="small" />
                        {!isMinimized && (
                            <Typography variant="subtitle2" fontWeight={600}>
                                Regex Highlight
                            </Typography>
                        )}
                    </Stack>
                    <Stack direction="row" spacing={1}>
                        <IconButton
                            size="small"
                            color="inherit"
                            onClick={toggleMinimize}
                            aria-label={isMinimized ? 'Expand widget' : 'Minimize widget'}
                            sx={{
                                bgcolor: 'rgba(255,255,255,0.15)',
                                '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' }
                            }}
                        >
                            {isMinimized ? <UnfoldMoreIcon fontSize="small" /> : <UnfoldLessIcon fontSize="small" />}
                        </IconButton>
                        <IconButton
                            size="small"
                            color="inherit"
                            onClick={handleToggleVisibility}
                            aria-label={isHidden ? 'Show widget' : 'Hide widget'}
                            sx={{
                                bgcolor: 'rgba(255,255,255,0.15)',
                                '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' }
                            }}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Stack>
                </Box>
                <Collapse in={!isMinimized} unmountOnExit>
                    <Box sx={{ p: 2 }}>
                        <Stack spacing={2}>
                            <Stack spacing={1}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    variant="outlined"
                                    label="Regex pattern"
                                    placeholder="Enter regex (e.g. (dog|cat))"
                                    value={searchInput}
                                    onChange={handleInputChange}
                                    onKeyDown={handleInputKeyPress}
                                    inputRef={inputRef}
                                    disabled={isHidden}
                                    error={Boolean(validationError)}
                                    helperText={helperText}
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <Tooltip title={statusInfo.title} arrow>
                                                    <Box
                                                        sx={{
                                                            width: 12,
                                                            height: 12,
                                                            borderRadius: '50%',
                                                            bgcolor: statusInfo.color,
                                                            boxShadow: `0 0 0 4px ${statusInfo.shadow}`,
                                                            cursor: 'help'
                                                        }}
                                                    />
                                                </Tooltip>
                                            </InputAdornment>
                                        )
                                    }}
                                />
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        onClick={() => void handleSearch()}
                                        disabled={searchInput.trim().length < 2}
                                        startIcon={<SearchIcon fontSize="small" />}
                                        size="medium"
                                        sx={{
                                            flex: 1,
                                            minWidth: 0,
                                            height: 38,
                                            bgcolor: 'primary.main',
                                            color: 'primary.contrastText',
                                            '&:hover': { bgcolor: 'primary.light' },
                                            '&.Mui-disabled': {
                                                bgcolor: 'rgba(0,0,0,0.06)',
                                                color: 'text.secondary'
                                            },
                                            boxShadow: '0 6px 18px rgba(100,181,246,0.35)'
                                        }}
                                    >
                                        Search
                                    </Button>
                                    <Button
                                        onClick={() => void handleClear()}
                                        color="secondary"
                                        startIcon={<ClearIcon fontSize="small" />}
                                        size="medium"
                                        sx={{
                                            flex: 1,
                                            minWidth: 0,
                                            height: 38,
                                            bgcolor: 'secondary.main',
                                            color: 'common.black',
                                            '&:hover': { bgcolor: 'secondary.light' },
                                            '&.Mui-disabled': {
                                                bgcolor: 'rgba(0,0,0,0.06)',
                                                color: 'text.secondary'
                                            },
                                            boxShadow: '0 6px 18px rgba(255,183,77,0.35)'
                                        }}
                                        disabled={!highlighterState.matchesTotal && !highlighterState.searchPattern}
                                    >
                                        Clear
                                    </Button>
                                </Stack>
                            </Stack>
                            <Divider />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={highlighterState.scrollOnSearch}
                                        onChange={handleScrollOnSearchChange}
                                    />
                                }
                                label="Scroll to first match on search"
                            />
                            <Box>
                                <Button
                                    variant="text"
                                    size="small"
                                    onClick={toggleCollapsible}
                                    endIcon={collapsibleExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                    sx={{ fontWeight: 600 }}
                                >
                                    {highlighterState.savedPatterns.length > 0 ? 'Flags & Saved Patterns' : 'Flags'}
                                </Button>
                                <Collapse in={collapsibleExpanded}>
                                    <Stack spacing={1} sx={{ mt: 1 }}>
                                        <FormGroup row>
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={highlighterState.regexFlags.global}
                                                        onChange={handleFlagChange('global')}
                                                    />
                                                }
                                                label="g (Global)"
                                            />
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={highlighterState.regexFlags.ignoreCase}
                                                        onChange={handleFlagChange('ignoreCase')}
                                                    />
                                                }
                                                label="i (Ignore Case)"
                                            />
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={highlighterState.regexFlags.multiline}
                                                        onChange={handleFlagChange('multiline')}
                                                    />
                                                }
                                                label="m (Multiline)"
                                            />
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={highlighterState.regexFlags.dotAll}
                                                        onChange={handleFlagChange('dotAll')}
                                                    />
                                                }
                                                label="s (DotAll)"
                                            />
                                        </FormGroup>
                                        {renderPatternHistory()}
                                    </Stack>
                                </Collapse>
                            </Box>
                            <Divider />
                            <Box textAlign="center">
                                <Typography variant="body1" fontWeight={600}>
                                    {currentDisplayIndex} / {highlighterState.matchesTotal}
                                </Typography>
                                {matchTypeSummary ? (
                                    <Typography variant="caption" color="text.secondary">
                                        ({matchTypeSummary})
                                    </Typography>
                                ) : null}
                            </Box>
                        </Stack>
                    </Box>
                </Collapse>
            </Paper>
            {showMiniChip && (
                <Box
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        right: `${overlayPosition.right}px`,
                        zIndex: 2147483647,
                        pointerEvents: 'auto'
                    }}
                >
                    <Chip
                        label={chipLabel}
                        size="small"
                        color={highlighterState.matchesTotal > 0 ? 'success' : 'default'}
                        variant="filled"
                        onClick={handleMiniChipClick}
                        clickable
                        title={statusInfo.title}
                        sx={{
                            fontWeight: 600,
                            bgcolor:
                                highlighterState.matchesTotal > 0
                                    ? alpha(theme.palette.success.main, 0.9)
                                    : alpha(theme.palette.grey[500], 0.25),
                            color:
                                highlighterState.matchesTotal > 0
                                    ? theme.palette.success.contrastText
                                    : theme.palette.text.primary,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                            '&:hover': {
                                bgcolor:
                                    highlighterState.matchesTotal > 0
                                        ? alpha(theme.palette.success.main, 1)
                                        : alpha(theme.palette.grey[500], 0.35)
                            }
                        }}
                    />
                </Box>
            )}
        </ScopedCssBaseline>
    );
};

export default ContentApp;

