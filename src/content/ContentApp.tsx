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
    Stack,
    Switch,
    TextField,
    Tooltip,
    Typography,
    Checkbox,
    ScopedCssBaseline
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { keyframes } from '@emotion/react';
import translateRegex from './regexDescribe';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
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
const WHOLE_WORDS_SETTING_KEY = 'regex-highlight-setting-wholeWords';

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
    const inputDirtyRef = useRef(false);

    const [highlighterState, setHighlighterState] = useState<HighlighterState>(defaultState);
    const [searchInput, setSearchInput] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isMinimized, setIsMinimized] = useState(() => loadBooleanSetting(MINIMIZED_SETTING_KEY, true));
    const [isHidden, setIsHidden] = useState(false);
    const [wholeWords, setWholeWords] = useState(() => loadBooleanSetting(WHOLE_WORDS_SETTING_KEY, false));
    const [flagsExpanded, setFlagsExpanded] = useState(() =>
        loadBooleanSetting(COLLAPSIBLE_SETTING_KEY, true)
    );
    const [patternsExpanded, setPatternsExpanded] = useState(() =>
        loadBooleanSetting(PATTERN_COLLAPSIBLE_SETTING_KEY, true)
    );
    const [overlayPosition, setOverlayPosition] = useState<OverlayPosition>(() => {
        const fallback: OverlayPosition = { top: 0, left: 36 };
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
    const [computedScale, setComputedScale] = useState(1);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const regexTranslation = useMemo(
        () => translateRegex(searchInput, highlighterState.regexFlags),
        [searchInput, highlighterState.regexFlags]
    );

    const containsLookaround = useCallback((pattern: string): boolean => {
        const targets = ['(?=', '(?!', '(?<=', '(?<!'];
        for (let i = 0; i < pattern.length; i++) {
            const char = pattern[i];
            if (char === '\\') {
                i++;
                continue;
            }
            if (char === '(' && i + 2 < pattern.length && pattern[i + 1] === '?') {
                const slice4 = pattern.slice(i, i + 4);
                const slice3 = pattern.slice(i, i + 3);
                if (targets.includes(slice4) || targets.includes(slice3)) {
                    return true;
                }
            }
        }
        return false;
    }, []);

    // Check if a pattern part already has word boundaries at start and end
    const hasWordBoundaries = useCallback((part: string): boolean => {
        // Check if starts with \b and ends with \b
        const startsWithBoundary = part.startsWith('\\b');
        const endsWithBoundary = part.endsWith('\\b');
        return startsWithBoundary && endsWithBoundary;
    }, []);

    const wrapWithWordBoundaries = useCallback((pattern: string): string => {
        // Split by top-level alternation (|) and wrap each item individually
        // Only add word boundaries to items that don't already have them
        const parts: string[] = [];
        let current = '';
        let depth = 0; // Track nesting depth for groups () and character classes []
        let inCharClass = false;

        for (let i = 0; i < pattern.length; i++) {
            const char = pattern[i];

            // Handle escape sequences
            if (char === '\\' && i + 1 < pattern.length) {
                current += char + pattern[i + 1];
                i++;
                continue;
            }

            // Track character class
            if (char === '[' && !inCharClass) {
                inCharClass = true;
                current += char;
                continue;
            }
            if (char === ']' && inCharClass) {
                inCharClass = false;
                current += char;
                continue;
            }

            // Track group nesting (only outside character classes)
            if (!inCharClass) {
                if (char === '(') {
                    depth++;
                } else if (char === ')') {
                    depth--;
                }
            }

            // Split on top-level pipe
            if (char === '|' && depth === 0 && !inCharClass) {
                parts.push(current);
                current = '';
                continue;
            }

            current += char;
        }

        // Don't forget the last part
        if (current) {
            parts.push(current);
        }

        // Wrap each part with word boundaries only if not already present
        return parts.map(part => {
            if (hasWordBoundaries(part)) {
                return part; // Already has word boundaries
            }
            return `\\b${part}\\b`;
        }).join('|');
    }, [hasWordBoundaries]);

    // Translator moved to util (regexDescribe.ts)
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

    const highlightedNavigationItems = useMemo(
        () =>
            regexTranslation.items.map((item) => {
                const matchTypeName = highlighterState.matchTypes[item.index];
                return {
                    ...item,
                    count: matchTypeName ? highlighterState.matchTypeCounts[matchTypeName] ?? 0 : 0
                };
            }),
        [highlighterState.matchTypeCounts, highlighterState.matchTypes, regexTranslation.items]
    );

    const handleHighlightedItemClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, itemIndex: number) => {
        event.preventDefault();
        highlighterRef.current?.jumpToFirstMatchType(itemIndex);
    }, []);

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
            const fixedPosition = { ...position, top: 0 };
            setOverlayPosition(fixedPosition);
            overlay.style.top = '0px';
            overlay.style.left = `${fixedPosition.left}px`;
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
            highlighterRef.current?.saveOverlayPosition(fixedPosition);
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
            },
            onSearchPatternChange: (pattern) => {
                inputDirtyRef.current = false;
                setSearchInput(pattern);
                if (inputRef.current) {
                    inputRef.current.value = pattern;
                }
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
            overlay.style.top = '0px';
            overlay.style.left = `${overlayPosition.left}px`;
            overlay.style.right = 'auto';
        }
    }, [overlayPosition]);

    useEffect(() => {
        const updateComputedScale = () => {
            const zoomLevel = getZoomLevel();
            const totalScale = zoomLevel > 0 ? 1 / zoomLevel : 1;
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
    }, [getZoomLevel]);

    const handleSearch = useCallback(async () => {
        const pattern = searchInput.trim();
        if (!pattern || pattern.length < 2) {
            return;
        }
        if (containsLookaround(pattern)) {
            setValidationError('Lookaheads/lookbehinds are disabled for performance reasons');
            return;
        }
        const highlighter = highlighterRef.current;
        if (!highlighter) {
            return;
        }
        setValidationError(null);
        try {
            const searchPattern = wholeWords ? wrapWithWordBoundaries(pattern) : pattern;
            await highlighter.search(searchPattern);
            inputDirtyRef.current = false;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid regex pattern';
            setValidationError(message);
        }
    }, [searchInput, wholeWords, wrapWithWordBoundaries]);

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

    const handleWholeWordsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const checked = event.target.checked;
        setWholeWords(checked);
        saveBooleanSetting(WHOLE_WORDS_SETTING_KEY, checked);
    }, []);

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
        if (containsLookaround(value)) {
            setValidationError('Lookaheads/lookbehinds are disabled for performance reasons');
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

    const focusInputAtEnd = useCallback(() => {
        if (!inputRef.current) {
            return;
        }
        inputRef.current.focus();
        const end = inputRef.current.value.length;
        requestAnimationFrame(() => {
            inputRef.current?.setSelectionRange(end, end);
        });
    }, []);

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
            if (event.metaKey && event.shiftKey && key === 'f') {
                event.preventDefault();
                if (isHidden) {
                    setIsHidden(false);
                    requestAnimationFrame(() => {
                        if (inputRef.current) {
                            const selected = window.getSelection()?.toString().trim();
                            if (selected) {
                                inputRef.current.value = selected;
                                setSearchInput(selected);
                                focusInputAtEnd();
                                void handleSearch();
                            } else {
                                focusInputAtEnd();
                            }
                        }
                    });
                } else if (isMinimized) {
                    setIsMinimized(false);
                    saveBooleanSetting(MINIMIZED_SETTING_KEY, false);
                    requestAnimationFrame(() => {
                        if (inputRef.current) {
                            const selected = window.getSelection()?.toString().trim();
                            if (selected) {
                                inputRef.current.value = selected;
                                setSearchInput(selected);
                                focusInputAtEnd();
                                void handleSearch();
                            } else {
                                focusInputAtEnd();
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
    }, [focusInputAtEnd, handleSearch, isMinimized, isHidden]);


    useEffect(() => {
        const handleResize = () => {
            const overlay = overlayRef.current;
            if (!overlay) {
                return;
            }
            const rect = overlay.getBoundingClientRect();
            const maxLeft = window.innerWidth - rect.width;
            const newLeft = clamp(rect.left, 0, Math.max(0, maxLeft));
            updateOverlayPosition({
                top: 0,
                left: newLeft
            });
            highlighterRef.current?.updateUIScale();
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [overlayPosition.left, updateOverlayPosition]);

    // Helper to escape regex special characters for literal matching
    const escapeRegexChars = useCallback((text: string): string => {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }, []);

    // Handle adding alternation from context menu
    const handleAddAlternation = useCallback((text: string) => {
        const escapedText = escapeRegexChars(text);
        // Get current pattern from the input ref to avoid stale closure issues
        const currentPattern = (inputRef.current?.value ?? searchInput).trim();

        let newPattern: string;
        if (!currentPattern) {
            // No existing pattern - start with just the selected text
            newPattern = escapedText;
        } else {
            // Add as alternation (no parentheses)
            newPattern = currentPattern + '|' + escapedText;
        }

        // Update both state and DOM
        setSearchInput(newPattern);
        if (inputRef.current) {
            inputRef.current.value = newPattern;
        }
        inputDirtyRef.current = true;
        setValidationError(null);

        // Show the widget if hidden (but don't change minimized state)
        if (isHidden) {
            setIsHidden(false);
        }

        // Auto-search if pattern is long enough.
        if (newPattern.length >= 2) {
            const searchPattern = wholeWords ? wrapWithWordBoundaries(newPattern) : newPattern;
            void highlighterRef.current?.search(searchPattern);
        }
    }, [searchInput, escapeRegexChars, isHidden, wholeWords, wrapWithWordBoundaries]);

    useEffect(() => {
        const messageHandler = (
            message: { action: string; pattern?: string; matchIndex?: number; text?: string },
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
                        const searchPattern = wholeWords ? wrapWithWordBoundaries(trimmed) : trimmed;
                        void highlighterRef.current?.search(searchPattern).then(
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
                case 'addAlternation':
                    if (message.text) {
                        handleAddAlternation(message.text);
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

        try {
            chrome.runtime.onMessage.addListener(messageHandler);
        } catch {
            // Extension context may be invalidated
        }
        return () => {
            try {
                chrome.runtime.onMessage.removeListener(messageHandler);
            } catch {
                // Extension context may be invalidated
            }
        };
    }, [highlighterState, handleAddAlternation, wholeWords, wrapWithWordBoundaries]);

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

    const handleHide = useCallback(() => {
        setIsHidden(true);
    }, []);

    const marqueeAnim = keyframes`
        0% { transform: translateX(0); }
        100% { transform: translateX(-100%); }
    `;

    return (
        <ScopedCssBaseline>
            <Paper
                id={OVERLAY_ID}
                ref={overlayRef}
                className={isMinimized ? 'minimized' : ''}
                elevation={12}
                sx={{
                    position: 'fixed',
                    top: 0,
                    left: overlayPosition.left,
                    right: 'auto',
                    bottom: 'auto',
                    display: isHidden ? 'none' : 'flex',
                    flexDirection: 'column',
                    width: overlayWidth,
                    maxHeight: '85vh',
                    overflow: 'hidden',
                    border: '1px solid #000000',
                    borderRadius: '0 0 12px 0',
                    zIndex: 2147483647
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: 1.25,
                        py: 0.75,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        userSelect: 'none'
                    }}
                >
                    <Stack direction="row" spacing={1} alignItems="center">
                        {!isMinimized && (
                            <Typography variant="subtitle2" fontWeight={600}>
                                Regex Highlight
                            </Typography>
                        )}
                        {isMinimized && (
                            <Typography
                                variant="caption"
                                sx={{
                                    ml: 0.5,
                                    px: 0.75,
                                    py: 0.25,
                                    borderRadius: 1,
                                    bgcolor: 'common.white',
                                    color: 'common.black',
                                    border: '1px solid',
                                    borderColor: theme.palette.grey[300],
                                    fontWeight: 700,
                                    lineHeight: 1.2
                                }}
                            >
                                {chipLabel}
                            </Typography>
                        )}
                    </Stack>
                    <Stack direction="row" spacing={1}>
                        <IconButton
                            size="small"
                            color="inherit"
                            onClick={handleHide}
                            aria-label="Hide widget"
                            sx={{
                                bgcolor: 'rgba(255,255,255,0.15)',
                                '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' }
                            }}
                        >
                            <VisibilityOffIcon fontSize="small" />
                        </IconButton>
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
                                <Box sx={{ position: 'relative' }}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="outlined"
                                        label="Regex pattern"
                                        placeholder="Enter regex (e.g. (dog|cat))"
                                        value={searchInput}
                                        onFocus={() => {
                                            setIsInputFocused(true);
                                            focusInputAtEnd();
                                        }}
                                        onBlur={() => setIsInputFocused(false)}
                                        onChange={handleInputChange}
                                        onKeyDown={handleInputKeyPress}
                                        inputRef={inputRef}
                                        error={Boolean(validationError)}
                                        helperText={helperText}
                                        spellCheck={false}
                                        InputProps={{
                                            endAdornment: (
                                                <InputAdornment position="end">
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
                                                </InputAdornment>
                                            )
                                        }}
                                        sx={{
                                            ...(isInputFocused
                                                ? {}
                                                : {
                                                    '& input': {
                                                        color: 'transparent',
                                                        textShadow: '0 0 0 currentColor',
                                                        caretColor: 'transparent'
                                                    }
                                                })
                                        }}
                                    />
                                    {!isInputFocused && regexTranslation.html && (
                                        <Box
                                            sx={{
                                                pointerEvents: 'none',
                                                position: 'absolute',
                                                left: 12,
                                                right: 36,
                                                top: 3,
                                                bottom: 26,
                                                display: 'flex',
                                                alignItems: 'center',
                                                overflow: 'hidden',
                                                color: 'text.primary',
                                                borderRadius: 1
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    display: 'inline-block',
                                                    whiteSpace: 'nowrap',
                                                    pr: 4,
                                                    animation: `${marqueeAnim} 24s linear infinite`
                                                }}
                                                dangerouslySetInnerHTML={{
                                                    __html: `${regexTranslation.html}<span style="padding-left: 32px;"></span>${regexTranslation.html}`
                                                }}
                                            />
                                        </Box>
                                    )}
                                </Box>
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
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={wholeWords}
                                        onChange={handleWholeWordsChange}
                                    />
                                }
                                label="Match whole words only"
                            />
                            {highlightedNavigationItems.length > 0 && (
                                <Box>
                                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                        Jump to highlighted item
                                    </Typography>
                                    <Stack
                                        direction="row"
                                        spacing={1}
                                        useFlexGap
                                        sx={{
                                            flexWrap: 'wrap',
                                            mt: 0.75
                                        }}
                                    >
                                        {highlightedNavigationItems.map((item) => (
                                            <Button
                                                component="a"
                                                href={`#regex-highlight-item-${item.index}`}
                                                key={`${item.index}-${item.pattern}`}
                                                size="small"
                                                variant="outlined"
                                                disabled={item.count === 0}
                                                onClick={(event) => handleHighlightedItemClick(event, item.index)}
                                                sx={{
                                                    minHeight: 28,
                                                    maxWidth: '100%',
                                                    px: 1,
                                                    py: 0.25,
                                                    borderColor: alpha(item.color, 0.8),
                                                    bgcolor: item.count > 0 ? item.color : alpha(item.color, 0.16),
                                                    color: '#000',
                                                    fontWeight: 700,
                                                    textTransform: 'none',
                                                    '&:hover': {
                                                        bgcolor: item.color,
                                                        borderColor: item.color
                                                    },
                                                    '&.Mui-disabled': {
                                                        borderColor: alpha(item.color, 0.36),
                                                        bgcolor: alpha(item.color, 0.16),
                                                        color: 'text.disabled'
                                                    }
                                                }}
                                            >
                                                <Typography
                                                    component="span"
                                                    variant="caption"
                                                    noWrap
                                                    sx={{ maxWidth: 180, fontWeight: 700 }}
                                                >
                                                    {item.label}
                                                </Typography>
                                                <Typography component="span" variant="caption" sx={{ ml: 0.75 }}>
                                                    ({item.count})
                                                </Typography>
                                            </Button>
                                        ))}
                                    </Stack>
                                </Box>
                            )}
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

        </ScopedCssBaseline>
    );
};

export default ContentApp;
