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
    const [computedScale, setComputedScale] = useState(1);
    const [isInputFocused, setIsInputFocused] = useState(false);

    const buildFlagDescription = (flags: RegexFlags) => {
        const parts: string[] = [];
        if (flags.ignoreCase) parts.push('case-insensitive');
        if (flags.multiline) parts.push('multi-line');
        if (flags.dotAll) parts.push('dot matches newline');
        return parts.length ? ` (${parts.join(', ')})` : '';
    };

    // A light-weight semantic translator for common regex constructs.
    const translateRegex = useCallback((pattern: string, flags: RegexFlags): string => {
        const trimmed = pattern.trim();
        if (!trimmed) return '';
        // Helper: split by unescaped pipes outside of parentheses and character classes
        const splitAlternation = (input: string): string[] => {
            const parts: string[] = [];
            let buf = '';
            let depth = 0;
            let inClass = false;
            let escaped = false;
            for (let i = 0; i < input.length; i++) {
                const ch = input[i];
                if (escaped) {
                    buf += ch;
                    escaped = false;
                    continue;
                }
                if (ch === '\\') {
                    buf += ch;
                    escaped = true;
                    continue;
                }
                if (!inClass && ch === '(') depth++;
                if (!inClass && ch === ')') depth = Math.max(0, depth - 1);
                if (ch === '[' && !inClass) inClass = true;
                else if (ch === ']' && inClass) inClass = false;
                if (ch === '|' && depth === 0 && !inClass) {
                    parts.push(buf);
                    buf = '';
                } else {
                    buf += ch;
                }
            }
            parts.push(buf);
            return parts;
        };

        // Basic tokens
        const tokenMap: Array<{ re: RegExp; desc: (m: RegExpMatchArray) => string }> = [
            { re: /^\\d$/, desc: () => 'a digit' },
            { re: /^\\D$/, desc: () => 'a non-digit' },
            { re: /^\\w$/, desc: () => 'a word character' },
            { re: /^\\W$/, desc: () => 'a non-word character' },
            { re: /^\\s$/, desc: () => 'a whitespace character' },
            { re: /^\\S$/, desc: () => 'a non-whitespace character' },
            { re: /^\.$/, desc: () => 'any character' },
            { re: /^\\b$/, desc: () => 'a word boundary' },
            { re: /^\\B$/, desc: () => 'a non-word boundary' }
        ];

        const describeClass = (cls: string): string => {
            // Remove brackets
            const negated = cls.startsWith('^');
            const body = negated ? cls.slice(1) : cls;
            const items: string[] = [];
            // Simple ranges and common escapes
            if (/[a-z]-[a-z]/i.test(body)) items.push('letters');
            if (/[0-9]-[0-9]/.test(body)) items.push('digits');
            if (/\\s/.test(body)) items.push('whitespace');
            if (/\\w/.test(body)) items.push('word chars');
            if (/\\d/.test(body)) items.push('digits');
            if (!items.length) items.push('listed characters');
            return negated ? `any character except ${items.join(' or ')}` : `any of ${items.join(' or ')}`;
        };

        const describeAtom = (atom: string): string => {
            // Character class
            const classMatch = atom.match(/^\[(.*)\]$/s);
            if (classMatch) return describeClass(classMatch[1]);
            // Grouped expression: return inner description
            const groupMatch = atom.match(/^\((\?:)?(.*)\)$/s);
            if (groupMatch) return describeSequence(groupMatch[2]);
            // Escaped or single-char tokens
            for (const t of tokenMap) {
                if (t.re.test(atom)) return t.desc(['' as any] as any);
            }
            if (atom.length === 1) {
                if (atom === '^') return 'start of line';
                if (atom === '$') return 'end of line';
                return `'${atom}'`;
            }
            // Fallback: literal string (strip escapes)
            const literal = atom.replace(/\\(.)/g, '$1');
            return `'${literal}'`;
        };

        const describeQuantified = (base: string, quant?: string): string => {
            const baseDesc = describeAtom(base);
            if (!quant) return baseDesc;
            if (quant === '*') return `${baseDesc} zero or more times`;
            if (quant === '+') return `${baseDesc} one or more times`;
            if (quant === '?') return `${baseDesc} zero or one time`;
            const m = quant.match(/^\{(\d+)(?:,(\d+)?)?\}$/);
            if (m) {
                const a = m[1];
                const b = m[2];
                if (b === undefined) return `${baseDesc} exactly ${a} times`;
                if (b === '') return `${baseDesc} at least ${a} times`;
                return `${baseDesc} between ${a} and ${b} times`;
            }
            return `${baseDesc} ${quant}`;
        };

        const describeSequence = (seq: string): string => {
            // Tokenize: atoms can be () [] \. ^ $ literals, plus quantifiers following atoms
            const out: string[] = [];
            let i = 0;
            while (i < seq.length) {
                let ch = seq[i];
                if (ch === '\\') {
                    const atom = seq.slice(i, i + 2);
                    const next = seq[i + 2];
                    if (next && /[\*\+\?\{]/.test(next)) {
                        // quantifier after escaped token
                        let quant = next;
                        let j = i + 3;
                        if (quant === '{') {
                            while (j < seq.length && seq[j] !== '}') j++;
                            if (seq[j] === '}') quant = seq.slice(i + 2, j + 1);
                            else quant = '{';
                            i = j + 1;
                        } else {
                            i = i + 3;
                        }
                        out.push(describeQuantified(atom, quant));
                    } else {
                        out.push(describeQuantified(atom));
                        i += 2;
                    }
                    continue;
                }
                if (ch === '[') {
                    let j = i + 1, inEsc = false;
                    while (j < seq.length) {
                        const cj = seq[j];
                        if (!inEsc && cj === '\\') { inEsc = true; j++; continue; }
                        if (!inEsc && cj === ']') break;
                        inEsc = false;
                        j++;
                    }
                    const atom = seq.slice(i, Math.min(seq.length, j + 1));
                    const next = seq[j + 1];
                    if (next && /[\*\+\?\{]/.test(next)) {
                        let quant = next;
                        let k = j + 2;
                        if (quant === '{') {
                            while (k < seq.length && seq[k] !== '}') k++;
                            if (seq[k] === '}') quant = seq.slice(j + 1, k + 1);
                            else quant = '{';
                            i = k + 1;
                        } else {
                            i = j + 2;
                        }
                        out.push(describeQuantified(atom, quant));
                    } else {
                        out.push(describeQuantified(atom));
                        i = j + 1;
                    }
                    continue;
                }
                if (ch === '(') {
                    let j = i + 1, depth = 1, inEsc = false;
                    while (j < seq.length && depth > 0) {
                        const cj = seq[j];
                        if (!inEsc && cj === '\\') { inEsc = true; j++; continue; }
                        if (!inEsc && cj === '(') depth++;
                        else if (!inEsc && cj === ')') depth--;
                        inEsc = false;
                        j++;
                    }
                    const atom = seq.slice(i, Math.min(seq.length, j));
                    const next = seq[j];
                    if (next && /[\*\+\?\{]/.test(next)) {
                        let quant = next;
                        let k = j + 1;
                        if (quant === '{') {
                            while (k < seq.length && seq[k] !== '}') k++;
                            if (seq[k] === '}') quant = seq.slice(j, k + 1);
                            else quant = '{';
                            i = k + 1;
                        } else {
                            i = j + 1;
                        }
                        out.push(describeQuantified(atom, quant));
                    } else {
                        out.push(describeQuantified(atom));
                        i = j;
                    }
                    continue;
                }
                // Single char with optional quantifier
                let quant: string | undefined;
                const next = seq[i + 1];
                if (next && /[\*\+\?\{]/.test(next)) {
                    if (next === '{') {
                        let j = i + 2;
                        while (j < seq.length && seq[j] !== '}') j++;
                        if (seq[j] === '}') quant = seq.slice(i + 1, j + 1);
                        else quant = '{';
                        i = j + 1;
                    } else {
                        quant = next;
                        i = i + 2;
                    }
                } else {
                    i = i + 1;
                }
                out.push(describeQuantified(ch, quant));
            }
            // Merge obvious literals like 'a' 'b' 'c' into a word when contiguous
            const merged: string[] = [];
            let literalRun: string[] = [];
            const flushRun = () => {
                if (literalRun.length === 0) return;
                const text = literalRun.map((t) => t.slice(1, -1)).join('');
                merged.push(`'${text}'`);
                literalRun = [];
            };
            for (const part of out) {
                const m = part.match(/^'(.*)'$/);
                if (m) {
                    literalRun.push(part);
                } else {
                    flushRun();
                    merged.push(part);
                }
            }
            flushRun();
            return merged.join(', ');
        };

        try {
            // High level: alternation
            const parts = splitAlternation(trimmed).filter(Boolean);
            let desc: string;
            if (parts.length > 1) {
                const alts = parts.map((p) => describeSequence(p));
                desc = `pattern searches for ${alts.join(' or ')}`;
            } else {
                const body = trimmed.replace(/^\^/, '').replace(/\$$/, '');
                const anchors = [
                    trimmed.startsWith('^') ? 'from the start' : '',
                    trimmed.endsWith('$') ? 'to the end' : ''
                ].filter(Boolean);
                const core = describeSequence(body);
                desc = `pattern searches for ${core}`;
                if (anchors.length) desc += ` (${anchors.join(', ')})`;
            }
            desc += buildFlagDescription(flags);
            return desc;
        } catch {
            // On failure, just show the raw pattern
            return trimmed;
        }
    }, []);
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
                                        onFocus={() => setIsInputFocused(true)}
                                        onBlur={() => setIsInputFocused(false)}
                                        onChange={handleInputChange}
                                        onKeyDown={handleInputKeyPress}
                                        inputRef={inputRef}
                                        error={Boolean(validationError)}
                                        helperText={helperText}
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
                                                        textShadow: '0 0 0 currentColor'
                                                    }
                                                })
                                        }}
                                    />
                                    {!isInputFocused && searchInput.trim().length > 0 && (
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
                                            >
                                                {translateRegex(searchInput, highlighterState.regexFlags)}
                                                <span style={{ paddingLeft: 32 }} />
                                                {translateRegex(searchInput, highlighterState.regexFlags)}
                                            </Box>
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

