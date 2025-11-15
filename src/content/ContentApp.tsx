import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Chip,
    Divider,
    FormControlLabel,
    FormGroup,
    IconButton,
    InputAdornment,
    Paper,
    Slider,
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
const PATTERN_COLLAPSIBLE_SETTING_KEY = 'regex-highlight-setting-patternsExpanded';
const MINIMIZED_SETTING_KEY = 'regex-highlight-setting-minimized';

type OverlayPosition = {
    top: number;
    left: number;
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
        startX: number;
        startLeft: number;
        deltaX: number;
    }>({
        isDragging: false,
        startX: 0,
        startLeft: 36,
        deltaX: 0
    });
    const inputDirtyRef = useRef(false);

    const [highlighterState, setHighlighterState] = useState<HighlighterState>(defaultState);
    const [searchInput, setSearchInput] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isMinimized, setIsMinimized] = useState(() => loadBooleanSetting(MINIMIZED_SETTING_KEY, true));
    const [flagsExpanded, setFlagsExpanded] = useState(() =>
        loadBooleanSetting(COLLAPSIBLE_SETTING_KEY, true)
    );
    const [patternsExpanded, setPatternsExpanded] = useState(() =>
        loadBooleanSetting(PATTERN_COLLAPSIBLE_SETTING_KEY, true)
    );
    const [overlayPosition, setOverlayPosition] = useState<OverlayPosition>(() => {
        const fallback: OverlayPosition = { top: 10, left: 36 };
        try {
            const stored = localStorage.getItem('regex-highlight-position');
            if (stored) {
                const parsed = JSON.parse(stored) as Partial<OverlayPosition>;
                return {
                    top: typeof parsed.top === 'number' ? parsed.top : fallback.top,
                    left: typeof parsed.left === 'number' ? parsed.left : fallback.left
                };
            }
        } catch {
            // ignore
        }
        return fallback;
    });
    const hasMatches = highlighterState.matchesTotal > 0;
    const [manualScaleSteps, setManualScaleSteps] = useState(0);
    const manualScaleFactor = useMemo(() => 1 + manualScaleSteps * 0.1, [manualScaleSteps]);
    const [computedScale, setComputedScale] = useState(1);
    const getZoomLevel = useCallback(() => {
        if (window.devicePixelRatio) {
            return window.devicePixelRatio;
        }
        const screenObj = window.screen as typeof window.screen & {
            deviceXDPI?: number;
            logicalXDPI?: number;
        };
        if (screenObj.deviceXDPI && screenObj.logicalXDPI && screenObj.logicalXDPI > 0) {
            return screenObj.deviceXDPI / screenObj.logicalXDPI;
        }
        return 1;
    }, []);

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

    const showMiniChip = isMinimized && highlighterState.searchPattern.trim();
    const chipLabel = highlighterState.searchPattern.trim()
        ? highlighterState.matchesTotal > 0
            ? `${currentDisplayIndex}/${highlighterState.matchesTotal}`
            : 'No matches'
        : 'Regex ready';

    const handleMiniChipClick = useCallback(() => {
        if (isMinimized) {
            setIsMinimized(false);
            saveBooleanSetting(MINIMIZED_SETTING_KEY, false);
        }
    }, [isMinimized]);

    const updateOverlayPosition = useCallback(
        (position: OverlayPosition) => {
            const overlay = overlayRef.current;
            if (!overlay) {
                return;
            }
            setOverlayPosition(position);
            overlay.style.top = `${position.top}px`;
            overlay.style.left = `${position.left}px`;
            overlay.style.right = 'auto';
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
                    left: savedPosition.left
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
            overlay.style.left = `${overlayPosition.left}px`;
            overlay.style.right = 'auto';
        }
    }, [overlayPosition]);

    useEffect(() => {
        const updateComputedScale = () => {
            const zoomLevel = getZoomLevel();
            const totalScale = manualScaleFactor / zoomLevel;
            setComputedScale((prev) => {
                if (Math.abs(prev - totalScale) > 0.0001) {
                    return totalScale;
                }
                return prev;
            });
        };

        const viewport = window.visualViewport;
        updateComputedScale();
        window.addEventListener('resize', updateComputedScale);
        viewport?.addEventListener('resize', updateComputedScale);
        viewport?.addEventListener('scroll', updateComputedScale);

        return () => {
            window.removeEventListener('resize', updateComputedScale);
            viewport?.removeEventListener('resize', updateComputedScale);
            viewport?.removeEventListener('scroll', updateComputedScale);
        };
    }, [getZoomLevel, manualScaleFactor]);

    useEffect(() => {
        highlighterRef.current?.setManualScaleFactor(manualScaleFactor);
    }, [manualScaleFactor]);

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

    const handleFlagsAccordionChange = useCallback((_event: React.SyntheticEvent, expanded: boolean) => {
        setFlagsExpanded(expanded);
        saveBooleanSetting(COLLAPSIBLE_SETTING_KEY, expanded);
    }, []);

    const handlePatternsAccordionChange = useCallback((_event: React.SyntheticEvent, expanded: boolean) => {
        setPatternsExpanded(expanded);
        saveBooleanSetting(PATTERN_COLLAPSIBLE_SETTING_KEY, expanded);
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

    useEffect(() => {
        const keydownHandler = (event: KeyboardEvent) => {
            const overlay = overlayRef.current;
            if (!overlay) {
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
    }, [handleSearch, isMinimized]);

    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) {
            return;
        }
        const dragHandle = overlay.querySelector('.regex-drag-handle') as HTMLElement | null;
        if (!dragHandle) {
            return;
        }

        const startDrag = (clientX: number) => {
            if (!overlay) return;
            dragStateRef.current.isDragging = true;
            dragStateRef.current.startX = clientX;
            dragStateRef.current.startLeft = overlayPosition.left;
            dragStateRef.current.deltaX = 0;
            overlay.style.transition = 'none';
        };

        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('#regex-minimize-btn')) {
                return;
            }
            startDrag(event.clientX);
            event.preventDefault();
        };

        const handleMouseMove = (event: MouseEvent) => {
            if (!dragStateRef.current.isDragging || !overlay) {
                return;
            }
            const deltaX = event.clientX - dragStateRef.current.startX;
            const width = overlay.getBoundingClientRect().width;
            const maxLeft = Math.max(0, window.innerWidth - width);
            const newLeft = clamp(dragStateRef.current.startLeft + deltaX, 0, maxLeft);
            dragStateRef.current.deltaX = newLeft - dragStateRef.current.startLeft;
            overlay.style.left = `${newLeft}px`;
            overlay.style.right = 'auto';
        };

        const endDrag = () => {
            if (!dragStateRef.current.isDragging || !overlay) {
                return;
            }
            dragStateRef.current.isDragging = false;
            overlay.style.transition = '';
            const width = overlay.getBoundingClientRect().width;
            const maxLeft = Math.max(0, window.innerWidth - width);
            const finalLeft = clamp(dragStateRef.current.startLeft + dragStateRef.current.deltaX, 0, maxLeft);
            dragStateRef.current.deltaX = 0;
            updateOverlayPosition({
                top: overlayPosition.top,
                left: finalLeft
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
            startDrag(touch.clientX);
            event.preventDefault();
        };

        const handleTouchMove = (event: TouchEvent) => {
            if (!dragStateRef.current.isDragging || !overlay) {
                return;
            }
            const touch = event.touches[0];
            const deltaX = touch.clientX - dragStateRef.current.startX;
            const width = overlay.getBoundingClientRect().width;
            const maxLeft = Math.max(0, window.innerWidth - width);
            const newLeft = clamp(dragStateRef.current.startLeft + deltaX, 0, maxLeft);
            dragStateRef.current.deltaX = newLeft - dragStateRef.current.startLeft;
            overlay.style.left = `${newLeft}px`;
            overlay.style.right = 'auto';
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
    }, [overlayPosition.left, overlayPosition.top, updateOverlayPosition]);

    useEffect(() => {
        const handleResize = () => {
            const overlay = overlayRef.current;
            if (!overlay) {
                return;
            }
            const rect = overlay.getBoundingClientRect();
            const maxTop = window.innerHeight - rect.height;
            const maxLeft = window.innerWidth - rect.width;
            const newTop = clamp(rect.top, 0, Math.max(0, maxTop));
            const newLeft = clamp(rect.left, 0, Math.max(0, maxLeft));
            updateOverlayPosition({
                top: newTop,
                left: newLeft
            });
            highlighterRef.current?.updateUIScale();
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [overlayPosition.left, updateOverlayPosition]);

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
    }, [highlighterState]);

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
                    left: overlayPosition.left,
                    right: 'auto',
                    bottom: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    width: overlayWidth,
                    maxHeight: '85vh',
                    overflow: 'hidden',
                    border: '1px solid #000000',
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
                    </Stack>
                </Box>
                {!isMinimized && (
                    <Box
                        sx={{
                            p: 2,
                            flex: 1,
                            overflowY: 'auto'
                        }}
                    >
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
                            <Stack spacing={1}>
                                <Typography variant="subtitle2" fontWeight={600}>
                                    Widget scale ({manualScaleFactor.toFixed(2)}x)
                                </Typography>
                                <Slider
                                    value={manualScaleSteps}
                                    onChange={(_event, value) => {
                                        if (typeof value === 'number') {
                                            setManualScaleSteps(value);
                                        }
                                    }}
                                    min={-5}
                                    max={5}
                                    step={1}
                                    marks={[
                                        { value: -5, label: '-5' },
                                        { value: 0, label: '0' },
                                        { value: 5, label: '+5' }
                                    ]}
                                    sx={{
                                        color: 'primary.main',
                                        height: 6,
                                        '& .MuiSlider-thumb': {
                                            width: 16,
                                            height: 16,
                                            backgroundColor: 'common.white',
                                            border: '2px solid currentColor',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                        },
                                        '& .MuiSlider-rail': {
                                            opacity: 0.3
                                        },
                                        '& .MuiSlider-mark': {
                                            backgroundColor: 'primary.main'
                                        },
                                        '& .MuiSlider-markLabel': {
                                            fontSize: 12,
                                            fontWeight: 600,
                                            color: 'text.secondary'
                                        }
                                    }}
                                />
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
                            <Accordion
                                expanded={flagsExpanded}
                                onChange={handleFlagsAccordionChange}
                                disableGutters
                                square
                                elevation={0}
                                sx={{
                                    border: '1px solid rgba(0,0,0,0.12)',
                                    borderRadius: 1,
                                    '&:before': { display: 'none' }
                                }}
                            >
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography fontWeight={600}>Flags</Typography>
                                </AccordionSummary>
                                <AccordionDetails>
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
                                </AccordionDetails>
                            </Accordion>
                            {highlighterState.savedPatterns.length > 0 && (
                                <Accordion
                                    expanded={patternsExpanded}
                                    onChange={handlePatternsAccordionChange}
                                    disableGutters
                                    square
                                    elevation={0}
                                    sx={{
                                        border: '1px solid rgba(0,0,0,0.12)',
                                        borderRadius: 1,
                                        '&:before': { display: 'none' }
                                    }}
                                >
                                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                        <Typography fontWeight={600}>Saved Patterns</Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>{renderPatternHistory()}</AccordionDetails>
                                </Accordion>
                            )}
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
                )}
            </Paper>
            {showMiniChip && (
                <Box
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        left: `${overlayPosition.left}px`,
                        zIndex: 2147483647,
                        pointerEvents: 'auto',
                        transform: `scale(${computedScale})`,
                        transformOrigin: 'bottom left'
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

