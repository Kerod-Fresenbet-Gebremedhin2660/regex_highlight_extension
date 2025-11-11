import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

    const statusIndicatorClass = useMemo(() => {
        if (!highlighterState.searchPattern.trim()) {
            return 'regex-search-status';
        }
        if (highlighterState.matchesTotal > 0) {
            return 'regex-search-status regex-search-status-has-matches';
        }
        return 'regex-search-status regex-search-status-no-matches';
    }, [highlighterState.matchesTotal, highlighterState.searchPattern]);

    const matchTypeSummary = useMemo(() => {
        const entries = Object.entries(highlighterState.matchTypeCounts);
        if (!entries.length) {
            return '';
        }
        return entries.map(([name, count]) => `${name}: ${count}`).join(', ');
    }, [highlighterState.matchTypeCounts]);

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
        if (markerContainerRef.current && document.body.contains(markerContainerRef.current)) {
            return markerContainerRef.current;
        }
        const container = document.createElement('div');
        container.id = MARKERS_ID;
        container.className = 'regex-scrollbar-markers';
        document.body.appendChild(container);
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
            if (container && document.body.contains(container)) {
                container.remove();
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
        if (!pattern) {
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

    const handleNext = useCallback(() => {
        highlighterRef.current?.next();
    }, []);

    const handlePrevious = useCallback(() => {
        highlighterRef.current?.previous();
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
        void highlighterRef.current?.search(pattern);
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
            if (event.key === 'F3') {
                event.preventDefault();
                if (event.shiftKey) {
                    highlighterRef.current?.previous();
                } else {
                    highlighterRef.current?.next();
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
            message: { action: string; pattern?: string },
            _sender: chrome.runtime.MessageSender,
            sendResponse: (response: { success: boolean; isHidden?: boolean }) => void
        ) => {
            switch (message.action) {
                case 'search':
                    if (message.pattern) {
                        setSearchInput(message.pattern);
                        void highlighterRef.current?.search(message.pattern).then(
                            () => sendResponse({ success: true }),
                            () => sendResponse({ success: false })
                        );
                        return true;
                    }
                    break;
                case 'clear':
                    void highlighterRef.current?.clear().then(() => sendResponse({ success: true }));
                    return true;
                case 'next':
                    highlighterRef.current?.next();
                    sendResponse({ success: true });
                    return true;
                case 'previous':
                    highlighterRef.current?.previous();
                    sendResponse({ success: true });
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
    }, [isHidden]);

    const renderPatternHistory = () => {
        if (!highlighterState.savedPatterns.length) {
            return null;
        }
        return (
            <div id="regex-pattern-history" className="regex-pattern-history" style={{ display: 'block' }}>
                {highlighterState.savedPatterns.map((pattern, index) => (
                    <button
                        key={`${pattern}-${index}`}
                        className="regex-pattern-chip"
                        data-pattern={pattern}
                        title={`Click to use: ${pattern}`}
                        onClick={(event) => {
                            if ((event.target as HTMLElement).classList.contains('regex-pattern-delete')) {
                                return;
                            }
                            handlePatternChipClick(pattern);
                        }}
                        type="button"
                    >
                        <span className="regex-pattern-text">{pattern}</span>
                        <span
                            className="regex-pattern-delete"
                            data-delete-index={index}
                            title="Delete pattern"
                            onClick={(event) => {
                                event.stopPropagation();
                                handlePatternDelete(index);
                            }}
                        >
                            ×
                        </span>
                    </button>
                ))}
            </div>
        );
    };

    return (
        <div
            id={OVERLAY_ID}
            ref={overlayRef}
            className={isMinimized ? 'minimized' : ''}
            style={{
                top: overlayPosition.top,
                right: overlayPosition.right,
                left: 'auto',
                bottom: 'auto',
                display: isHidden ? 'none' : 'block'
            }}
        >
            <div className="regex-drag-handle">
                <span className="regex-drag-icon">⋮⋮</span>
                <button
                    id="regex-minimize-btn"
                    className="regex-minimize-btn"
                    title={isMinimized ? 'Expand' : 'Minimize'}
                    onClick={toggleMinimize}
                    type="button"
                >
                    {isMinimized ? '+' : '−'}
                </button>
                <button
                    className="regex-hide-btn"
                    title={isHidden ? 'Show widget' : 'Hide widget'}
                    onClick={handleToggleVisibility}
                    type="button"
                >
                    {isHidden ? '☰' : '×'}
                </button>
            </div>
            <div className="regex-search-container">
                <div className="regex-search-input-wrapper">
                    <input
                        ref={inputRef}
                        id="regex-search-input"
                        type="text"
                        placeholder="Enter regex pattern (e.g., (dog|cat))"
                        value={searchInput}
                        onChange={handleInputChange}
                        onKeyDown={handleInputKeyPress}
                        className={validationError ? 'regex-input-invalid' : ''}
                        disabled={isHidden}
                    />
                    <span
                        id="regex-search-status"
                        className={statusIndicatorClass}
                        title={
                            !highlighterState.searchPattern.trim()
                                ? 'No active search'
                                : highlighterState.matchesTotal > 0
                                    ? `Search active: ${highlighterState.matchesTotal} matches found`
                                    : 'Search active: No matches found'
                        }
                    />
                </div>
                {validationError ? (
                    <div id="regex-pattern-error" className="regex-pattern-error">
                        Invalid regex: {validationError}
                    </div>
                ) : null}
                <div className="regex-search-buttons-container">
                    <button
                        id="regex-search-btn"
                        onClick={() => void handleSearch()}
                        disabled={!searchInput.trim()}
                        type="button"
                    >
                        Search
                    </button>
                    <button
                        id="regex-clear-btn"
                        onClick={() => void handleClear()}
                        disabled={!highlighterState.matchesTotal}
                        type="button"
                    >
                        Clear
                    </button>
                </div>
                <div className="regex-settings">
                    <label className="regex-setting-toggle">
                        <input
                            type="checkbox"
                            id="regex-scroll-on-search"
                            checked={highlighterState.scrollOnSearch}
                            onChange={handleScrollOnSearchChange}
                        />
                        <span>Scroll to first match on search</span>
                    </label>
                    <div className="regex-collapsible-section">
                        <div>
                            <button
                                className="regex-collapsible-header"
                                id="regex-collapsible-toggle"
                                onClick={toggleCollapsible}
                                type="button"
                            >
                                <span className="regex-collapsible-icon">{collapsibleExpanded ? '▼' : '▶'}</span>
                                <span className="regex-collapsible-title" id="regex-collapsible-title">
                                    {highlighterState.savedPatterns.length > 0 ? 'Flags & Patterns' : 'Flags'}
                                </span>
                            </button>
                        </div>
                        <div
                            className="regex-collapsible-content"
                            id="regex-collapsible-content"
                            style={{ display: collapsibleExpanded ? 'block' : 'none' }}
                        >
                            <div className="regex-flags-container">
                                <label className="regex-flag-label" title="Global: Find all matches (not just first)">
                                    <input
                                        type="checkbox"
                                        id="regex-flag-global"
                                        checked={highlighterState.regexFlags.global}
                                        onChange={handleFlagChange('global')}
                                    />
                                    <span>g (Global)</span>
                                </label>
                                <label className="regex-flag-label" title="Case-insensitive">
                                    <input
                                        type="checkbox"
                                        id="regex-flag-ignorecase"
                                        checked={highlighterState.regexFlags.ignoreCase}
                                        onChange={handleFlagChange('ignoreCase')}
                                    />
                                    <span>i (Ignore Case)</span>
                                </label>
                                <label className="regex-flag-label" title="Multiline: ^ and $ match line breaks">
                                    <input
                                        type="checkbox"
                                        id="regex-flag-multiline"
                                        checked={highlighterState.regexFlags.multiline}
                                        onChange={handleFlagChange('multiline')}
                                    />
                                    <span>m (Multiline)</span>
                                </label>
                                <label className="regex-flag-label" title="DotAll: . matches newline">
                                    <input
                                        type="checkbox"
                                        id="regex-flag-dotall"
                                        checked={highlighterState.regexFlags.dotAll}
                                        onChange={handleFlagChange('dotAll')}
                                    />
                                    <span>s (DotAll)</span>
                                </label>
                            </div>
                            {renderPatternHistory()}
                        </div>
                    </div>
                </div>
                <div className="regex-navigation">
                    <button id="regex-prev-btn" onClick={handlePrevious} disabled={!hasMatches} type="button">
                        ◀ Prev
                    </button>
                    <div className="regex-match-counter-container">
                        <span id="regex-match-counter" title={`Match ${currentDisplayIndex} of ${highlighterState.matchesTotal}`}>
                            {currentDisplayIndex} / {highlighterState.matchesTotal}
                        </span>
                    </div>
                    <button id="regex-next-btn" onClick={handleNext} disabled={!hasMatches} type="button">
                        Next ▶
                    </button>
                </div>
                <div>
                    <span
                        id="regex-match-type-counts"
                        className="regex-match-type-counts"
                        style={{ display: matchTypeSummary ? 'block' : 'none' }}
                    >
                        {matchTypeSummary ? `(${matchTypeSummary})` : ''}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default ContentApp;

