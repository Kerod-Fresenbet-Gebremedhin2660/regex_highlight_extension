/* eslint-disable @typescript-eslint/no-explicit-any */
export type RegexFlags = {
    global: boolean;
    ignoreCase: boolean;
    multiline: boolean;
    dotAll: boolean;
};

export type MatchEntry = {
    node: Text;
    index: number;
    length: number;
    matchType: number | null;
    span?: HTMLElement;
};

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
};

export type HighlighterState = {
    searchPattern: string;
    matchesTotal: number;
    currentIndex: number;
    matchTypes: string[];
    matchTypeCounts: Record<string, number>;
    savedPatterns: string[];
    regexFlags: RegexFlags;
    scrollOnSearch: boolean;
};

type CallbackEvents = {
    onStateChange?: (state: HighlighterState) => void;
    onActiveMatchSpanChange?: (span: HTMLElement | null) => void;
    onMatchesUpdated?: (matches: MatchEntry[]) => void;
    onPatternRestored?: (pattern: string) => void;
    onSearchPatternChange?: (pattern: string) => void;
};

type CollectTextNode = { text: string };

class SearchCancelledError extends Error {
    constructor() {
        super('Search cancelled');
        this.name = 'SearchCancelledError';
    }
}

const HIGHLIGHT_CLASS = 'regex-highlight-match';
const ACTIVE_CLASS = 'regex-highlight-active';
const HIGHLIGHT_WRAPPER_CLASS = 'regex-highlight-wrapper';
const REMOVE_BUTTON_CLASS = 'regex-highlight-remove';
const POSITION_STORAGE_KEY = 'regex-highlight-position';
const PATTERN_STORAGE_KEY = 'regex-highlight-patterns';
const SETTINGS_PREFIX = 'regex-highlight-setting-';
const SEARCH_STATE_KEY = 'regex-search-state';
const MAX_SCROLLBAR_MARKERS = 400;
const EXCLUDED_TAG_NAMES = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'OPTION',
    'BUTTON'
]);

export class RegexHighlighter {
    private matches: MatchEntry[] = [];
    private currentIndex = -1;
    private searchPattern = '';
    private matchTypes: string[] = [];
    private matchTypeCounts: Record<string, number> = {};
    private savedPatterns: string[] = [];
    private maxSavedPatterns = 8;
    private worker: Worker | null = null;
    private workerPendingRequests = new Map<number, PendingRequest>();
    private isPerformingSearch = false;
    private searchGeneration = 0;
    private isScrollingProgrammatically = false;
    private scrollHandler?: () => void;
    private scrollTimeout?: number;
    private matchVisibilityObserver: IntersectionObserver | null = null;
    private visibleMatchIndices = new Set<number>();
    private callbacks: CallbackEvents;
    private textNodeMap = new Map<number, Text>();
    private scrollOnSearch: boolean;
    private regexFlags: RegexFlags;
    private useZoomFallback = false;
    private zoomHandlingSetup = false;
    private currentUIScale = 1;
    private updateUIScaleBound: (() => void) | null = null;
    private sortIdleCallbackId: number | null = null;
    private sortTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private overlayElement: HTMLElement | null = null;
    private markerContainer: HTMLElement | null = null;
    private navigationCleanup?: () => void;
    private patternStorageListener?: (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void;

    constructor(callbacks: CallbackEvents = {}) {
        this.callbacks = callbacks;
        this.savedPatterns = this.loadSavedPatterns();
        this.scrollOnSearch = this.loadSetting('scrollOnSearch', false);
        this.regexFlags = {
            global: this.loadSetting('regexFlagGlobal', true),
            ignoreCase: this.loadSetting('regexFlagIgnoreCase', true),
            multiline: this.loadSetting('regexFlagMultiline', false),
            dotAll: this.loadSetting('regexFlagDotAll', false)
        };
        this.initializeSavedPatternsSync();
        this.initWorker();
        this.setupZoomHandling();
        this.setupNavigationListener();
    }

    attachOverlayElements(overlay: HTMLElement, markerContainer: HTMLElement) {
        this.overlayElement = overlay;
        this.markerContainer = markerContainer;
        this.applyOverlayTransform();
        this.applyMarkerScale(this.currentUIScale);
    }

    destroy() {
        const generation = ++this.searchGeneration;
        void this.clearHighlights(generation);
        this.cancelPendingWorkerRequests(false);
        this.worker?.terminate();
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler, true);
        }
        if (this.updateUIScaleBound && this.zoomHandlingSetup) {
            window.removeEventListener('resize', this.updateUIScaleBound);
            if (window.visualViewport && typeof window.visualViewport.removeEventListener === 'function') {
                window.visualViewport.removeEventListener('resize', this.updateUIScaleBound);
            }
        }
        if (this.sortIdleCallbackId !== null && 'cancelIdleCallback' in window) {
            (window as unknown as { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback(
                this.sortIdleCallbackId
            );
        }
        if (this.sortTimeoutId) {
            clearTimeout(this.sortTimeoutId);
        }
        if (this.navigationCleanup) {
            this.navigationCleanup();
        }
        if (this.patternStorageListener) {
            try {
                chrome.storage.onChanged.removeListener(this.patternStorageListener);
            } catch {
                // Extension context may be invalidated
            }
        }
    }

    getState(): HighlighterState {
        return {
            searchPattern: this.searchPattern,
            matchesTotal: this.matches.length,
            currentIndex: this.currentIndex,
            matchTypes: this.matchTypes.slice(),
            matchTypeCounts: { ...this.matchTypeCounts },
            savedPatterns: this.savedPatterns.slice(),
            regexFlags: { ...this.regexFlags },
            scrollOnSearch: this.scrollOnSearch
        };
    }

    setCallbacks(callbacks: CallbackEvents) {
        this.callbacks = callbacks;
    }

    setScrollOnSearch(value: boolean) {
        this.scrollOnSearch = value;
        this.saveSetting('scrollOnSearch', value);
        this.notifyStateChange();
    }

    setRegexFlag(flag: keyof RegexFlags, value: boolean) {
        this.regexFlags = { ...this.regexFlags, [flag]: value };
        this.saveSetting(`regexFlag${flag.charAt(0).toUpperCase()}${flag.slice(1)}`, value);
        this.notifyStateChange();
    }

    setRegexFlags(flags: Partial<RegexFlags>) {
        this.regexFlags = { ...this.regexFlags, ...flags };
        (Object.keys(flags) as (keyof RegexFlags)[]).forEach((flag) => {
            this.saveSetting(`regexFlag${flag.charAt(0).toUpperCase()}${flag.slice(1)}`, this.regexFlags[flag]);
        });
        this.notifyStateChange();
    }

    getRegexFlags(): RegexFlags {
        return { ...this.regexFlags };
    }

    async search(pattern: string) {
        if (!pattern.trim()) {
            return;
        }

        const flags = this.getRegexFlagsString();
        try {
            // Validate regex
            // eslint-disable-next-line no-new
            new RegExp(pattern, flags);
        } catch (error) {
            throw error instanceof Error ? error : new Error('Invalid regex pattern');
        }

        const generation = ++this.searchGeneration;
        this.cancelPendingWorkerRequests();

        this.searchPattern = pattern;
        this.savePattern(pattern);
        this.saveSearchState(pattern);

        this.isPerformingSearch = true;

        try {
            if (!(await this.clearHighlights(generation))) {
                return;
            }
            if (!(await this.findMatches(pattern, flags, generation))) {
                return;
            }
            if (!(await this.highlightMatches(generation))) {
                return;
            }

            if (!this.isSearchCurrent(generation)) {
                return;
            }

            this.currentIndex = this.matches.length > 0 ? 0 : -1;
            this.notifyStateChange();

            if (this.currentIndex >= 0 && this.scrollOnSearch) {
                this.scrollToMatch(this.currentIndex);
            }

            this.setupScrollTracking();
            this.scheduleSortPatternsByMatchCount();
            this.updateScrollbarMarkers();
        } finally {
            if (this.isSearchCurrent(generation)) {
                this.isPerformingSearch = false;
            }
        }
    }

    async clear() {
        const generation = ++this.searchGeneration;
        this.cancelPendingWorkerRequests();
        if (!(await this.clearHighlights(generation)) || !this.isSearchCurrent(generation)) {
            return;
        }
        this.isPerformingSearch = false;
        this.searchPattern = '';
        this.currentIndex = -1;
        this.matchTypes = [];
        this.clearSearchState();
        this.notifyStateChange();
        this.clearScrollbarMarkers();
    }

    private isSearchCurrent(generation: number) {
        return generation === this.searchGeneration;
    }

    private cancelPendingWorkerRequests(restartWorker = true) {
        if (this.workerPendingRequests.size === 0) {
            return;
        }
        this.workerPendingRequests.forEach(({ reject }) => reject(new SearchCancelledError()));
        this.workerPendingRequests.clear();
        this.worker?.terminate();
        this.worker = null;
        if (restartWorker) {
            this.initWorker();
        }
    }

    next() {
        if (this.matches.length === 0) {
            return;
        }
        if (this.currentIndex >= 0) {
            const prevSpan = this.matches[this.currentIndex].span;
            prevSpan?.classList.remove(ACTIVE_CLASS);
        }
        this.currentIndex = (this.currentIndex + 1) % this.matches.length;
        this.scrollToMatch(this.currentIndex);
        this.notifyStateChange();
        this.updateScrollbarMarkers();
    }

    previous() {
        if (this.matches.length === 0) {
            return;
        }
        if (this.currentIndex >= 0) {
            const prevSpan = this.matches[this.currentIndex].span;
            prevSpan?.classList.remove(ACTIVE_CLASS);
        }
        this.currentIndex = this.currentIndex <= 0 ? this.matches.length - 1 : this.currentIndex - 1;
        this.scrollToMatch(this.currentIndex);
        this.notifyStateChange();
        this.updateScrollbarMarkers();
    }

    highlightActiveMatch(index: number) {
        if (index < 0 || index >= this.matches.length) {
            return;
        }
        const nextSpan = this.matches[index].span;
        const activeSpan = document.querySelector(`.${HIGHLIGHT_CLASS}.${ACTIVE_CLASS}`) as HTMLElement | null;
        if (activeSpan !== nextSpan) {
            activeSpan?.classList.remove(ACTIVE_CLASS);
            nextSpan?.classList.add(ACTIVE_CLASS);
        }
    }

    jumpToMatch(index: number) {
        if (index < 0 || index >= this.matches.length) {
            return;
        }
        this.currentIndex = index;
        this.highlightActiveMatch(index);
        this.scrollToMatch(index);
        this.updateScrollbarMarkers();
        this.notifyStateChange();
    }

    jumpToFirstMatchType(matchType: number) {
        const selector =
            this.matchTypes.length > 1
                ? `.${HIGHLIGHT_CLASS}.regex-highlight-type-${matchType}`
                : `.${HIGHLIGHT_CLASS}`;
        const span = document.querySelector(selector) as HTMLElement | null;
        if (!span) {
            return;
        }
        this.activateMatchElement(span, 'start');
    }

    getMatches(): MatchEntry[] {
        return this.matches;
    }

    getMatchPreview(matchIndex: number, contextLength = 50): {
        before: string;
        match: string;
        after: string;
        fullText: string;
    } | null {
        if (matchIndex < 0 || matchIndex >= this.matches.length) {
            return null;
        }
        const match = this.matches[matchIndex];
        if (!match.span) {
            return null;
        }
        const matchText = match.span.textContent ?? '';
        const wrapper = match.span.parentElement?.classList.contains(HIGHLIGHT_WRAPPER_CLASS)
            ? match.span.parentElement
            : null;
        const matchNode = wrapper ?? match.span;
        const parent = matchNode.parentElement;
        if (!parent) {
            return { before: '', match: matchText, after: '', fullText: matchText };
        }
        let fullText = '';
        let matchPosition = -1;
        let currentPos = 0;
        parent.childNodes.forEach((child) => {
            if (child === matchNode) {
                matchPosition = currentPos;
                fullText += matchText;
                currentPos += matchText.length;
            } else if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent ?? '';
                fullText += text;
                currentPos += text.length;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const text = (child as HTMLElement).textContent ?? '';
                fullText += text;
                currentPos += text.length;
            }
        });
        if (matchPosition === -1) {
            fullText = parent.textContent ?? '';
            matchPosition = fullText.indexOf(matchText);
        }
        if (matchPosition === -1) {
            return { before: '', match: matchText, after: '', fullText: matchText };
        }
        const beforeStart = Math.max(0, matchPosition - contextLength);
        const afterEnd = Math.min(fullText.length, matchPosition + matchText.length + contextLength);
        const before = fullText.substring(beforeStart, matchPosition);
        const after = fullText.substring(matchPosition + matchText.length, afterEnd);
        return {
            before: beforeStart > 0 ? `...${before}` : before,
            match: matchText,
            after: afterEnd < fullText.length ? `${after}...` : after,
            fullText: fullText.substring(beforeStart, afterEnd)
        };
    }

    getAllMatchPreviews(contextLength = 50): Array<{
        index: number;
        before: string;
        match: string;
        after: string;
        fullText: string;
    }> {
        return this.matches.map((_, index) => {
            const preview = this.getMatchPreview(index, contextLength);
            if (!preview) {
                return {
                    index,
                    before: '',
                    match: '',
                    after: '',
                    fullText: ''
                };
            }
            return {
                index,
                ...preview
            };
        });
    }

    saveOverlayPosition(position: { top: number; left: number }) {
        try {
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
        } catch (error) {
            console.warn('Could not save position to localStorage', error);
        }
    }

    loadOverlayPosition(): { top: number; left: number } | null {
        try {
            const saved = localStorage.getItem(POSITION_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as { top: number; left: number };
                return parsed;
            }
        } catch (error) {
            console.warn('Could not load position from localStorage', error);
        }
        return null;
    }

    getSavedPatterns(): string[] {
        return this.savedPatterns.slice();
    }

    deletePattern(index: number) {
        if (index < 0 || index >= this.savedPatterns.length) {
            return;
        }
        this.savedPatterns.splice(index, 1);
        this.persistSavedPatterns();
        this.notifyStateChange();
    }

    async restoreSearchIfSameDomain() {
        try {
            const result = await chrome.storage.local.get(SEARCH_STATE_KEY);
            const state = result[SEARCH_STATE_KEY] as
                | {
                    pattern: string;
                    domain: string;
                    flags: RegexFlags;
                }
                | undefined;

            if (!state) {
                return;
            }

            if (state.domain !== this.getDomain() || !state.pattern) {
                return;
            }

            if (state.flags) {
                this.regexFlags = { ...this.regexFlags, ...state.flags };
            }

            this.notifyStateChange();
            await this.search(state.pattern);
            this.callbacks.onPatternRestored?.(state.pattern);
        } catch (error) {
            console.warn('Could not restore search state:', error);
        }
    }

    private initWorker() {
        try {
            const workerCode = `
        self.onmessage = function(e) {
          const { type, pattern, flags, textNodes, alternatives, requestId } = e.data;

          const determineMatchType = (matchedText, alternatives) => {
            if (!alternatives || alternatives.length === 0) return null;
            const altFlags = flags.includes('i') ? 'i' : '';
            for (let i = 0; i < alternatives.length; i++) {
              try {
                const altRegex = new RegExp('^' + alternatives[i] + '$', altFlags);
                if (altRegex.test(matchedText)) return i;
              } catch (err) {
                if (flags.includes('i')) {
                  if (matchedText.toLowerCase() === alternatives[i].toLowerCase()) return i;
                } else if (matchedText === alternatives[i]) {
                  return i;
                }
              }
            }
            return 0;
          };

          if (type === 'findMatches') {
            try {
              const regex = new RegExp(pattern, flags);
              const matches = [];
              for (let nodeIndex = 0; nodeIndex < textNodes.length; nodeIndex++) {
                const textNode = textNodes[nodeIndex];
                const text = textNode.text;
                if (!text) continue;
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                  const matchedText = match[0];
                  const matchType = determineMatchType(matchedText, alternatives || []);
                  matches.push({
                    nodeIndex: nodeIndex,
                    index: match.index,
                    length: matchedText.length,
                    matchType: matchType
                  });
                  if (!flags.includes('g')) {
                    break;
                  }
                  if (matchedText.length === 0) {
                    regex.lastIndex++;
                  }
                }
                if (!flags.includes('g') && matches.length > 0) {
                  break;
                }
              }
              self.postMessage({ type: 'matches', matches, requestId });
            } catch (error) {
              self.postMessage({ type: 'error', error: error.message, requestId });
            }
          } else if (type === 'countMatches') {
            try {
              const regex = new RegExp(pattern, flags);
              let count = 0;
              for (const textNode of textNodes) {
                const text = textNode.text;
                if (!text) continue;
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                  count++;
                  if (!flags.includes('g')) {
                    break;
                  }
                  if (match[0].length === 0) {
                    regex.lastIndex++;
                  }
                }
                if (!flags.includes('g') && count > 0) {
                  break;
                }
              }
              self.postMessage({ type: 'count', count, requestId });
            } catch (error) {
              self.postMessage({ type: 'error', error: error.message, requestId });
            }
          }
        };
      `;

            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));

            this.worker.onmessage = (event) => {
                const { type, matches, count, error, requestId } = event.data;
                const pendingRequest = this.workerPendingRequests.get(requestId);
                if (!pendingRequest) {
                    return;
                }
                this.workerPendingRequests.delete(requestId);
                if (type === 'matches') {
                    pendingRequest.resolve(matches);
                } else if (type === 'count') {
                    pendingRequest.resolve(count);
                } else if (type === 'error') {
                    pendingRequest.reject(new Error(error));
                }
            };

            this.worker.onerror = (error) => {
                console.error('Worker error:', error);
                this.workerPendingRequests.forEach(({ reject }) => reject(error));
                this.workerPendingRequests.clear();
                this.worker = null;
            };
        } catch (error) {
            console.warn('Could not create Web Worker, falling back to main thread:', error);
            this.worker = null;
        }
    }

    private getRegexFlagsString() {
        let flags = '';
        if (this.regexFlags.global) flags += 'g';
        if (this.regexFlags.ignoreCase) flags += 'i';
        if (this.regexFlags.multiline) flags += 'm';
        if (this.regexFlags.dotAll) flags += 's';
        return flags;
    }

    private extractAlternatives(pattern: string) {
        if (!pattern.includes('|')) {
            return [] as string[];
        }
        let cleanPattern = pattern.trim();
        if (cleanPattern.startsWith('(') && !cleanPattern.startsWith('(?') && cleanPattern.endsWith(')')) {
            let depth = 0;
            let isWrapped = true;
            for (let i = 0; i < cleanPattern.length; i++) {
                if (cleanPattern[i] === '(' && (i === 0 || cleanPattern[i - 1] !== '\\')) {
                    depth++;
                } else if (cleanPattern[i] === ')' && (i === 0 || cleanPattern[i - 1] !== '\\')) {
                    depth--;
                    if (depth === 0 && i < cleanPattern.length - 1) {
                        isWrapped = false;
                        break;
                    }
                }
            }
            if (isWrapped && depth === 0) {
                cleanPattern = cleanPattern.slice(1, -1);
            }
        }

        const parts: string[] = [];
        let currentPart = '';
        let escaped = false;
        let depth = 0;
        let inCharacterClass = false;
        for (let i = 0; i < cleanPattern.length; i++) {
            const char = cleanPattern[i];
            if (escaped) {
                currentPart += char;
                escaped = false;
            } else if (char === '\\') {
                currentPart += char;
                escaped = true;
            } else if (char === '[' && !inCharacterClass) {
                inCharacterClass = true;
                currentPart += char;
            } else if (char === ']' && inCharacterClass) {
                inCharacterClass = false;
                currentPart += char;
            } else if (!inCharacterClass && char === '(') {
                depth++;
                currentPart += char;
            } else if (!inCharacterClass && char === ')') {
                depth = Math.max(0, depth - 1);
                currentPart += char;
            } else if (char === '|' && depth === 0 && !inCharacterClass) {
                parts.push(currentPart.trim());
                currentPart = '';
            } else {
                currentPart += char;
            }
        }
        parts.push(currentPart.trim());

        const alternatives = parts.filter(Boolean);
        return alternatives.length > 1 ? alternatives : [];
    }

    private async removeMatchTypeFromSearch(matchType: number | null) {
        if (this.isPerformingSearch) {
            return;
        }

        const alternatives = this.extractAlternatives(this.searchPattern);
        if (alternatives.length <= 1 || matchType === null || !alternatives[matchType]) {
            await this.clear();
            this.callbacks.onSearchPatternChange?.('');
            return;
        }

        const nextPattern = alternatives.filter((_, index) => index !== matchType).join('|');
        this.callbacks.onSearchPatternChange?.(nextPattern);
        await this.search(nextPattern);
    }

    private determineMatchType(matchedText: string, alternatives: string[], ignoreCase = this.regexFlags.ignoreCase) {
        if (alternatives.length === 0) {
            return null;
        }
        const altFlags = ignoreCase ? 'i' : '';
        for (let i = 0; i < alternatives.length; i++) {
            try {
                const regex = new RegExp(`^${alternatives[i]}$`, altFlags);
                if (regex.test(matchedText)) {
                    return i;
                }
            } catch (error) {
                if (ignoreCase) {
                    if (matchedText.toLowerCase() === alternatives[i].toLowerCase()) {
                        return i;
                    }
                } else if (matchedText === alternatives[i]) {
                    return i;
                }
            }
        }
        return 0;
    }

    private async findMatches(pattern: string, flags: string, generation: number) {
        const nextMatches: MatchEntry[] = [];
        const alternatives = this.extractAlternatives(pattern);
        const nextMatchTypes = alternatives.length > 0 ? alternatives : [];
        const ignoreCase = flags.includes('i');

        const overlay = this.overlayElement;
        const textNodes: CollectTextNode[] = [];
        const textNodeMap = new Map<number, Text>();
        if (!(await this.collectTextNodesInBatches(overlay, textNodes, textNodeMap, generation))) {
            return false;
        }

        if (this.worker && textNodes.length > 0) {
            try {
                const requestId = Date.now() + Math.random();
                const promise = new Promise((resolve, reject) => {
                    this.workerPendingRequests.set(requestId, { resolve, reject });
                });
                this.worker.postMessage({
                    type: 'findMatches',
                    pattern,
                    flags,
                    textNodes,
                    alternatives,
                    requestId
                });
                const workerMatches = (await promise) as {
                    nodeIndex: number;
                    index: number;
                    length: number;
                    matchType: number | null;
                }[];
                if (!this.isSearchCurrent(generation)) {
                    return false;
                }
                workerMatches.forEach((match) => {
                    const node = textNodeMap.get(match.nodeIndex);
                    if (node) {
                        nextMatches.push({
                            node,
                            index: match.index,
                            length: match.length,
                            matchType: match.matchType
                        });
                    }
                });
                this.matches = nextMatches;
                this.matchTypes = nextMatchTypes;
                this.matchTypeCounts = this.computeMatchTypeCounts(nextMatches, nextMatchTypes);
                this.textNodeMap = textNodeMap;
                return true;
            } catch (error) {
                if (!this.isSearchCurrent(generation) || error instanceof SearchCancelledError) {
                    return false;
                }
                console.warn('Worker error, falling back to main thread:', error);
            }
        }

        const regex = new RegExp(pattern, flags);
        const isGlobal = flags.includes('g');
        const BATCH_SIZE = 100;
        let foundNonGlobalMatch = false;
        for (let start = 0; start < textNodes.length && !foundNonGlobalMatch; start += BATCH_SIZE) {
            if (!this.isSearchCurrent(generation)) {
                return false;
            }
            const end = Math.min(start + BATCH_SIZE, textNodes.length);
            for (let nodeIndex = start; nodeIndex < end; nodeIndex++) {
                const node = textNodeMap.get(nodeIndex);
                const text = textNodes[nodeIndex]?.text;
                if (!node || !text) {
                    continue;
                }
                let match: RegExpExecArray | null;
                regex.lastIndex = 0;
                while ((match = regex.exec(text)) !== null) {
                    const matchedText = match[0];
                    const matchType = this.determineMatchType(matchedText, alternatives, ignoreCase);
                    nextMatches.push({
                        node,
                        index: match.index,
                        length: matchedText.length,
                        matchType
                    });
                    if (!isGlobal) {
                        foundNonGlobalMatch = true;
                        break;
                    }
                    if (matchedText.length === 0) {
                        regex.lastIndex++;
                    }
                }
                if (foundNonGlobalMatch) {
                    break;
                }
            }
            if (!foundNonGlobalMatch && end < textNodes.length) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        if (!this.isSearchCurrent(generation)) {
            return false;
        }
        this.matches = nextMatches;
        this.matchTypes = nextMatchTypes;
        this.matchTypeCounts = this.computeMatchTypeCounts(nextMatches, nextMatchTypes);
        this.textNodeMap = textNodeMap;
        return true;
    }

    private collectTextNodesInBatches(
        overlay: HTMLElement | null,
        textNodes: CollectTextNode[],
        textNodeMap: Map<number, Text>,
        generation?: number
    ) {
        return new Promise<boolean>((resolve) => {
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            return this.shouldExcludeElement(node as HTMLElement, overlay)
                                ? NodeFilter.FILTER_REJECT
                                : NodeFilter.FILTER_SKIP;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            const BATCH_SIZE = 100;
            let node: Text | null;

            const processBatch = () => {
                if (generation !== undefined && !this.isSearchCurrent(generation)) {
                    resolve(false);
                    return;
                }
                let count = 0;
                while (count < BATCH_SIZE && (node = walker.nextNode() as Text | null)) {
                    const text = node.textContent;
                    if (text && text.trim()) {
                        const index = textNodes.length;
                        textNodes.push({ text });
                        textNodeMap.set(index, node);
                    }
                    count++;
                }
                if (node) {
                    setTimeout(processBatch, 0);
                } else {
                    resolve(true);
                }
            };
            processBatch();
        });
    }

    private shouldExcludeElement(element: HTMLElement, overlay: HTMLElement | null) {
        if (element === overlay || (overlay && overlay.contains(element))) {
            return true;
        }
        if (EXCLUDED_TAG_NAMES.has(element.tagName) || element.namespaceURI !== document.documentElement.namespaceURI) {
            return true;
        }
        if (
            element.hidden ||
            element.inert ||
            element.getAttribute('aria-hidden') === 'true' ||
            (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false')
        ) {
            return true;
        }
        const style = window.getComputedStyle(element);
        return (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.visibility === 'collapse' ||
            style.contentVisibility === 'hidden' ||
            Number.parseFloat(style.opacity) === 0
        );
    }

    private async highlightMatches(generation: number) {
        const matchesByNode = new Map<Text, (MatchEntry & { originalIndex: number })[]>();
        this.matches.forEach((match, idx) => {
            const nodeMatches = matchesByNode.get(match.node) ?? [];
            nodeMatches.push({ ...match, originalIndex: idx });
            matchesByNode.set(match.node, nodeMatches);
        });

        const nodes = Array.from(matchesByNode.keys());
        const BATCH_SIZE = 50;
        for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
            if (!this.isSearchCurrent(generation)) {
                return false;
            }
            const batch = nodes.slice(i, i + BATCH_SIZE);
            if (i > 0) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            if (!this.isSearchCurrent(generation)) {
                return false;
            }
            batch.forEach((node) => {
                const nodeMatches = matchesByNode.get(node);
                if (!nodeMatches || nodeMatches.length === 0) {
                    return;
                }
                nodeMatches.sort((a, b) => a.index - b.index);
                const text = node.textContent ?? '';
                const parent = node.parentNode;
                if (!parent) {
                    return;
                }
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                nodeMatches.forEach((match) => {
                    if (match.index > lastIndex) {
                        fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                    }
                    const wrapper = document.createElement('span');
                    wrapper.className = HIGHLIGHT_WRAPPER_CLASS;

                    const span = document.createElement('a');
                    let className = HIGHLIGHT_CLASS;
                    if (match.matchType !== null && this.matchTypes.length > 1) {
                        className += ` regex-highlight-type-${match.matchType}`;
                    }
                    span.className = className;
                    span.href = `#regex-highlight-match-${match.originalIndex}`;
                    span.setAttribute('aria-label', `Jump to regex match ${match.originalIndex + 1}`);
                    span.dataset.matchIndex = String(match.originalIndex);
                    span.textContent = text.substring(match.index, match.index + match.length);
                    span.addEventListener('click', (event) => {
                        event.preventDefault();
                        this.activateMatchElement(span, 'start');
                    });

                    const removeButton = document.createElement('button');
                    removeButton.type = 'button';
                    removeButton.className = REMOVE_BUTTON_CLASS;
                    removeButton.textContent = '×';
                    removeButton.setAttribute('aria-label', `Remove "${span.textContent}" from search`);
                    removeButton.title = 'Remove from search';
                    removeButton.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void this.removeMatchTypeFromSearch(match.matchType);
                    });

                    wrapper.append(span, removeButton);
                    fragment.appendChild(wrapper);
                    this.matches[match.originalIndex].span = span;
                    lastIndex = match.index + match.length;
                });
                if (lastIndex < text.length) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
                }
                parent.replaceChild(fragment, node);
            });
        }
        this.callbacks.onMatchesUpdated?.(this.matches);
        return true;
    }

    private async clearHighlights(generation?: number) {
        this.teardownScrollTracking();
        const highlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
        const parentsToNormalize = new Set<Node>();
        const highlightArray = Array.from(highlights);
        const BATCH_SIZE = 100;
        for (let i = 0; i < highlightArray.length; i += BATCH_SIZE) {
            if (generation !== undefined && !this.isSearchCurrent(generation)) {
                return false;
            }
            const batch = highlightArray.slice(i, i + BATCH_SIZE);
            if (i > 0) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            if (generation !== undefined && !this.isSearchCurrent(generation)) {
                return false;
            }
            batch.forEach((span) => {
                const wrapper = span.parentElement?.classList.contains(HIGHLIGHT_WRAPPER_CLASS)
                    ? span.parentElement
                    : null;
                const nodeToReplace = wrapper ?? span;
                const parent = nodeToReplace.parentNode;
                if (parent) {
                    parent.replaceChild(document.createTextNode(span.textContent ?? ''), nodeToReplace);
                    parentsToNormalize.add(parent);
                }
            });
        }
        const parentsArray = Array.from(parentsToNormalize);
        for (let i = 0; i < parentsArray.length; i += BATCH_SIZE) {
            if (generation !== undefined && !this.isSearchCurrent(generation)) {
                return false;
            }
            const batch = parentsArray.slice(i, i + BATCH_SIZE);
            if (i > 0) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            if (generation !== undefined && !this.isSearchCurrent(generation)) {
                return false;
            }
            batch.forEach((parent) => {
                if ('normalize' in parent && typeof (parent as ParentNode).normalize === 'function') {
                    (parent as ParentNode).normalize();
                }
            });
        }
        this.matches = [];
        this.currentIndex = -1;
        this.matchTypes = [];
        this.matchTypeCounts = {};
        this.callbacks.onMatchesUpdated?.(this.matches);
        return true;
    }

    private async rerunActiveSearch() {
        if (!this.searchPattern.trim()) {
            return;
        }
        const pattern = this.searchPattern;
        const flags = this.getRegexFlagsString();
        const generation = ++this.searchGeneration;
        this.cancelPendingWorkerRequests();
        this.isPerformingSearch = true;

        try {
            if (!(await this.clearHighlights(generation))) {
                return;
            }
            if (!(await this.findMatches(pattern, flags, generation))) {
                return;
            }
            if (!(await this.highlightMatches(generation)) || !this.isSearchCurrent(generation)) {
                return;
            }
            this.currentIndex = this.matches.length > 0 ? 0 : -1;
            if (this.currentIndex >= 0 && this.scrollOnSearch) {
                this.scrollToMatch(this.currentIndex);
            }
            this.setupScrollTracking();
            this.updateScrollbarMarkers();
            this.notifyStateChange();
        } catch (error) {
            console.warn('Could not refresh regex highlights:', error);
        } finally {
            if (this.isSearchCurrent(generation)) {
                this.isPerformingSearch = false;
            }
        }
    }

    private scrollToMatch(index: number, block: ScrollLogicalPosition = 'center') {
        if (index < 0 || index >= this.matches.length) {
            return;
        }
        this.isScrollingProgrammatically = true;
        const match = this.matches[index];
        const span =
            match.span ??
            (document.querySelector(`.${HIGHLIGHT_CLASS}[data-match-index="${index}"]`) as HTMLElement | null);
        if (!span) {
            return;
        }
        match.span = span;
        this.highlightActiveMatch(index);
        span.scrollIntoView({ behavior: 'smooth', block });
        this.callbacks.onActiveMatchSpanChange?.(span);
        setTimeout(() => {
            this.isScrollingProgrammatically = false;
            this.updateScrollbarMarkers();
        }, 500);
    }

    private activateMatchElement(span: HTMLElement, block: ScrollLogicalPosition = 'center') {
        const index = this.matches.findIndex((match) => match.span === span);
        if (index >= 0) {
            this.currentIndex = index;
            this.highlightActiveMatch(index);
            this.scrollToMatch(index, block);
            this.updateScrollbarMarkers();
            this.notifyStateChange();
            return;
        }

        this.isScrollingProgrammatically = true;
        document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((entry) => {
            entry.classList.toggle(ACTIVE_CLASS, entry === span);
        });
        span.scrollIntoView({ behavior: 'smooth', block });
        this.callbacks.onActiveMatchSpanChange?.(span);
        setTimeout(() => {
            this.isScrollingProgrammatically = false;
            this.updateScrollbarMarkers();
        }, 500);
    }

    private setupScrollTracking() {
        this.teardownScrollTracking();
        if (this.matches.length === 0) {
            return;
        }
        const scheduleUpdate = () => {
            if (this.isScrollingProgrammatically) {
                return;
            }
            if (this.scrollTimeout) {
                clearTimeout(this.scrollTimeout);
            }
            this.scrollTimeout = window.setTimeout(() => {
                this.updateActiveMatchFromScroll();
            }, 100);
        };

        if ('IntersectionObserver' in window) {
            this.matchVisibilityObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const index = Number((entry.target as HTMLElement).dataset.matchIndex);
                    if (!Number.isInteger(index)) {
                        return;
                    }
                    if (entry.isIntersecting) {
                        this.visibleMatchIndices.add(index);
                    } else {
                        this.visibleMatchIndices.delete(index);
                    }
                });
                scheduleUpdate();
            });
            this.matches.forEach((match) => {
                if (match.span) {
                    this.matchVisibilityObserver?.observe(match.span);
                }
            });
        }

        this.scrollHandler = () => {
            scheduleUpdate();
        };
        window.addEventListener('scroll', this.scrollHandler, true);
        setTimeout(() => this.updateActiveMatchFromScroll(), 200);
    }

    private teardownScrollTracking() {
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler, true);
            this.scrollHandler = undefined;
        }
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = undefined;
        }
        this.matchVisibilityObserver?.disconnect();
        this.matchVisibilityObserver = null;
        this.visibleMatchIndices.clear();
    }

    private updateActiveMatchFromScroll() {
        if (this.matches.length === 0 || this.isScrollingProgrammatically) {
            return;
        }
        const viewportTop = 0;
        const viewportBottom = window.innerHeight;
        let firstVisibleIndex = -1;
        let firstVisibleTop = Infinity;
        const candidateIndices = this.matchVisibilityObserver
            ? Array.from(this.visibleMatchIndices)
            : this.matches.map((_, index) => index);

        candidateIndices.forEach((index) => {
            const match = this.matches[index];
            if (!match) {
                return;
            }
            const rect = match.span?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            const elementTop = rect.top;
            const elementBottom = rect.bottom;
            if (elementBottom > viewportTop && elementTop < viewportBottom) {
                if (elementTop <= 50 && elementTop < firstVisibleTop) {
                    firstVisibleTop = elementTop;
                    firstVisibleIndex = index;
                }
            }
        });
        if (firstVisibleIndex === -1) {
            let minTopInViewport = Infinity;
            candidateIndices.forEach((index) => {
                const match = this.matches[index];
                if (!match) {
                    return;
                }
                const rect = match.span?.getBoundingClientRect();
                if (!rect) {
                    return;
                }
                const elementTop = rect.top;
                const elementBottom = rect.bottom;
                if (elementBottom > viewportTop && elementTop < viewportBottom) {
                    const relativeTop = Math.max(0, elementTop);
                    if (relativeTop < minTopInViewport) {
                        minTopInViewport = relativeTop;
                        firstVisibleIndex = index;
                    }
                }
            });
        }
        if (firstVisibleIndex >= 0 && firstVisibleIndex !== this.currentIndex) {
            if (this.currentIndex >= 0 && this.currentIndex < this.matches.length) {
                this.matches[this.currentIndex].span?.classList.remove(ACTIVE_CLASS);
            }
            this.currentIndex = firstVisibleIndex;
            const newSpan = this.matches[this.currentIndex].span;
            newSpan?.classList.add(ACTIVE_CLASS);
            this.notifyStateChange();
            this.updateScrollbarMarkers();
            this.callbacks.onActiveMatchSpanChange?.(newSpan ?? null);
        }
    }

    private updateScrollbarMarkers() {
        if (!this.markerContainer) {
            return;
        }
        if (this.matches.length === 0) {
            this.clearScrollbarMarkers();
            return;
        }
        const container = this.markerContainer;
        container.innerHTML = '';
        container.style.position = 'fixed';
        container.style.pointerEvents = 'none';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.justifyContent = 'flex-start';
        container.style.right = '16px';
        container.style.top = '12px';
        container.style.bottom = '12px';
        container.style.width = '12px';
        container.style.padding = '10px 2px';
        container.style.zIndex = '2147483646';
        const documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        const viewportHeight = window.innerHeight;
        if (documentHeight <= viewportHeight) {
            return;
        }
        const scrollbarTrackHeight = viewportHeight - 20;
        const markerFragment = document.createDocumentFragment();
        this.getMarkerMatchIndices().forEach((index) => {
            const match = this.matches[index];
            const span = match.span;
            if (!span) {
                return;
            }
            const rect = span.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const elementTop = scrollTop + rect.top;
            const positionPercent = (elementTop / documentHeight) * 100;
            const markerTop = (positionPercent / 100) * scrollbarTrackHeight;
            const marker = document.createElement('div');
            marker.dataset.matchIndex = String(index);
            marker.style.pointerEvents = 'auto';
            marker.style.position = 'absolute';
            marker.style.left = '50%';
            marker.style.transform = 'translate(-50%, -50%)';
            marker.style.width = '6px';
            marker.style.height = '6px';
            marker.style.borderRadius = '999px';
            marker.style.cursor = 'pointer';
            marker.style.transition = 'transform 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease';
            marker.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.18)';
            marker.style.backgroundColor =
                match.matchType !== null && this.matchTypes.length > 1
                    ? this.getMarkerColor(match.matchType)
                    : '#fff59d';
            marker.style.top = `${markerTop}px`;
            marker.title = this.getMatchContext(match, 50);
            if (index === this.currentIndex) {
                marker.style.transform = 'translate(-50%, -50%) scale(1.35)';
                marker.style.backgroundColor = '#ff9800';
                marker.style.boxShadow = '0 0 0 4px rgba(255, 152, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.25)';
            }
            marker.addEventListener('click', () => {
                this.currentIndex = index;
                this.scrollToMatch(index);
                this.notifyStateChange();
            });
            markerFragment.appendChild(marker);
        });
        container.appendChild(markerFragment);
    }

    private getMarkerMatchIndices() {
        if (this.matches.length <= MAX_SCROLLBAR_MARKERS) {
            return this.matches.map((_, index) => index);
        }

        const indices = new Set<number>();
        const sampleSlots = Math.max(2, MAX_SCROLLBAR_MARKERS - 1);
        for (let slot = 0; slot < sampleSlots; slot++) {
            indices.add(Math.round((slot * (this.matches.length - 1)) / (sampleSlots - 1)));
        }
        if (this.currentIndex >= 0) {
            indices.add(this.currentIndex);
        }
        return Array.from(indices).sort((a, b) => a - b);
    }

    private getMarkerColor(typeIndex: number) {
        const colors = [
            '#fdd835',
            '#7cb342',
            '#42a5f5',
            '#ec407a',
            '#ab47bc',
            '#ffa726',
            '#26a69a',
            '#8d6e63',
            '#ffee58',
            '#9ccc65',
            '#29b6f6',
            '#f06292',
            '#ba68c8',
            '#ff8a65',
            '#66bb6a',
            '#90a4ae',
            '#ffca28',
            '#8bc34a',
            '#03a9f4',
            '#e91e63',
            '#9c27b0',
            '#ff7043',
            '#009688',
            '#795548'
        ];
        return colors[typeIndex % colors.length];
    }

    clearScrollbarMarkers() {
        if (this.markerContainer) {
            this.markerContainer.innerHTML = '';
        }
    }

    private getMatchContext(match: MatchEntry, contextLength = 50) {
        if (!match.span) {
            return '';
        }
        const matchText = match.span.textContent ?? '';
        const wrapper = match.span.parentElement?.classList.contains(HIGHLIGHT_WRAPPER_CLASS)
            ? match.span.parentElement
            : null;
        const matchNode = wrapper ?? match.span;
        const parent = matchNode.parentElement;
        if (!parent) {
            return matchText;
        }
        let fullText = '';
        let matchPosition = -1;
        let currentPos = 0;
        parent.childNodes.forEach((child) => {
            if (child === matchNode) {
                matchPosition = currentPos;
                fullText += matchText;
                currentPos += matchText.length;
            } else if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent ?? '';
                fullText += text;
                currentPos += text.length;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const text = (child as HTMLElement).textContent ?? '';
                fullText += text;
                currentPos += text.length;
            }
        });
        if (matchPosition === -1) {
            fullText = parent.textContent ?? '';
            matchPosition = fullText.indexOf(matchText);
        }
        if (matchPosition === -1) {
            return matchText;
        }
        const start = Math.max(0, matchPosition - contextLength);
        const end = Math.min(fullText.length, matchPosition + matchText.length + contextLength);
        let context = fullText.substring(start, end);
        if (start > 0) {
            context = `...${context}`;
        }
        if (end < fullText.length) {
            context = `${context}...`;
        }
        const matchStartInContext = start > 0 ? matchPosition - start + 3 : matchPosition - start;
        const matchEndInContext = matchStartInContext + matchText.length;
        if (matchStartInContext >= 0 && matchEndInContext <= context.length) {
            context =
                context.substring(0, matchStartInContext) +
                `[${matchText}]` +
                context.substring(matchEndInContext, context.length);
        }
        return `Match ${this.currentIndex + 1} of ${this.matches.length}\n${context}`;
    }

    private savePattern(pattern: string) {
        this.savedPatterns = this.savedPatterns.filter((p) => p !== pattern);
        this.savedPatterns.unshift(pattern);
        if (this.savedPatterns.length > this.maxSavedPatterns) {
            this.savedPatterns = this.savedPatterns.slice(0, this.maxSavedPatterns);
        }
        this.persistSavedPatterns();
        this.notifyStateChange();
    }

    private loadSavedPatterns() {
        try {
            const saved = localStorage.getItem(PATTERN_STORAGE_KEY);
            return saved ? (JSON.parse(saved) as string[]) : [];
        } catch (error) {
            console.warn('Could not load saved patterns', error);
            return [];
        }
    }

    private initializeSavedPatternsSync() {
        try {
            chrome.storage.local.get(PATTERN_STORAGE_KEY, (result) => {
                if (chrome.runtime.lastError) {
                    // Extension context may be invalidated
                    return;
                }
                const saved = result?.[PATTERN_STORAGE_KEY];
                if (Array.isArray(saved)) {
                    this.savedPatterns = saved
                        .filter((value): value is string => typeof value === 'string')
                        .slice(0, this.maxSavedPatterns);
                    this.notifyStateChange();
                    return;
                }
                // First run migration: seed chrome.storage.local from existing localStorage.
                if (this.savedPatterns.length > 0) {
                    this.persistSavedPatterns();
                }
            });

            this.patternStorageListener = (
                changes: { [key: string]: chrome.storage.StorageChange },
                areaName: string
            ) => {
                if (areaName !== 'local' || !changes[PATTERN_STORAGE_KEY]) {
                    return;
                }
                const nextValue = changes[PATTERN_STORAGE_KEY].newValue;
                if (!Array.isArray(nextValue)) {
                    this.savedPatterns = [];
                    this.notifyStateChange();
                    return;
                }
                this.savedPatterns = nextValue
                    .filter((value): value is string => typeof value === 'string')
                    .slice(0, this.maxSavedPatterns);
                this.notifyStateChange();
            };
            chrome.storage.onChanged.addListener(this.patternStorageListener);
        } catch {
            // Extension context may be invalidated
        }
    }

    private persistSavedPatterns() {
        // Keep localStorage write for compatibility with existing code paths/migration fallback.
        try {
            localStorage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(this.savedPatterns));
        } catch (error) {
            console.warn('Could not save patterns to localStorage', error);
        }
        try {
            chrome.storage.local.set({ [PATTERN_STORAGE_KEY]: this.savedPatterns }, () => {
                if (chrome.runtime.lastError) {
                    // Extension context may be invalidated
                }
            });
        } catch {
            // Extension context may be invalidated
        }
    }

    private loadSetting<T>(key: string, defaultValue: T) {
        try {
            const saved = localStorage.getItem(`${SETTINGS_PREFIX}${key}`);
            return saved !== null ? (JSON.parse(saved) as T) : defaultValue;
        } catch (error) {
            return defaultValue;
        }
    }

    private saveSetting(key: string, value: unknown) {
        try {
            localStorage.setItem(`${SETTINGS_PREFIX}${key}`, JSON.stringify(value));
        } catch (error) {
            console.warn('Could not save setting to localStorage', error);
        }
    }

    private saveSearchState(pattern: string) {
        if (!pattern) {
            return;
        }
        const state = {
            pattern,
            domain: this.getDomain(),
            flags: this.regexFlags,
            timestamp: Date.now()
        };
        try {
            chrome.storage.local.set({ [SEARCH_STATE_KEY]: state }, () => {
                if (chrome.runtime.lastError) {
                    // Extension context may be invalidated
                }
            });
        } catch {
            // Extension context invalidated
        }
    }

    private clearSearchState() {
        try {
            chrome.storage.local.remove(SEARCH_STATE_KEY, () => {
                if (chrome.runtime.lastError) {
                    // Extension context may be invalidated
                }
            });
        } catch {
            // Extension context invalidated
        }
    }

    private getDomain() {
        return window.location.hostname;
    }

    private computeMatchTypeCounts(matches = this.matches, matchTypes = this.matchTypes) {
        const counts: Record<string, number> = {};
        if (matchTypes.length <= 1) {
            return counts;
        }
        matches.forEach((match) => {
            if (match.matchType !== null && matchTypes[match.matchType]) {
                const key = matchTypes[match.matchType];
                counts[key] = (counts[key] ?? 0) + 1;
            }
        });
        return counts;
    }

    private notifyStateChange() {
        const state = this.getState();
        this.callbacks.onStateChange?.(state);
    }

    private setupNavigationListener() {
        let lastUrl = location.href;
        let lastPathname = location.pathname;
        let lastSearch = location.search;
        let lastHash = location.hash;
        let navigationTimeout: ReturnType<typeof setTimeout> | null = null;
        let domChangeTimeout: ReturnType<typeof setTimeout> | null = null;
        let urlPollInterval: ReturnType<typeof setInterval> | null = null;
        let mutationObserver: MutationObserver | null = null;

        const checkNavigation = () => {
            const currentUrl = location.href;
            const currentPathname = location.pathname;
            const currentSearch = location.search;
            const currentHash = location.hash;
            const currentDomain = this.getDomain();

            // Check if URL actually changed
            const urlChanged =
                currentUrl !== lastUrl ||
                currentPathname !== lastPathname ||
                currentSearch !== lastSearch ||
                currentHash !== lastHash;

            if (!urlChanged) {
                return;
            }

            lastUrl = currentUrl;
            lastPathname = currentPathname;
            lastSearch = currentSearch;
            lastHash = currentHash;

            if (navigationTimeout) {
                clearTimeout(navigationTimeout);
            }

            try {
                chrome.storage.local.get(SEARCH_STATE_KEY, (result) => {
                    if (chrome.runtime.lastError) {
                        // Extension context may be invalidated
                        return;
                    }
                    const state = result[SEARCH_STATE_KEY] as
                        | {
                            pattern: string;
                            domain: string;
                            flags: RegexFlags;
                        }
                        | undefined;
                    if (!state) {
                        return;
                    }
                    if (state.domain !== currentDomain) {
                        void this.clear();
                        return;
                    }
                    navigationTimeout = setTimeout(() => {
                        this.searchPattern = state.pattern;
                        if (state.flags) {
                            this.regexFlags = { ...this.regexFlags, ...state.flags };
                        }
                        this.notifyStateChange();
                        void this.rerunActiveSearch();
                    }, 300);
                });
            } catch {
                // Extension context invalidated
            }
        };

        // Handle DOM changes that might indicate SPA navigation
        const handleDOMChange = () => {
            if (domChangeTimeout) {
                clearTimeout(domChangeTimeout);
            }
            // Debounce DOM changes - only trigger if URL also changed
            domChangeTimeout = setTimeout(() => {
                const currentUrl = location.href;
                if (currentUrl !== lastUrl) {
                    checkNavigation();
                }
            }, 500);
        };

        // Set up MutationObserver to watch for significant DOM changes
        mutationObserver = new MutationObserver((mutations) => {
            let shouldCheck = false;
            for (const mutation of mutations) {
                // Check for significant changes that might indicate SPA navigation
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if a significant portion of the page changed
                    for (const node of Array.from(mutation.addedNodes)) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node as HTMLElement;
                            // Check for common SPA container elements
                            if (
                                element.tagName === 'MAIN' ||
                                element.tagName === 'ARTICLE' ||
                                element.tagName === 'SECTION' ||
                                element.id?.includes('app') ||
                                element.id?.includes('root') ||
                                element.id?.includes('content') ||
                                element.classList.contains('router-view') ||
                                element.classList.contains('page-content')
                            ) {
                                shouldCheck = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldCheck) break;
            }
            if (shouldCheck) {
                handleDOMChange();
            }
        });

        // Start observing the document body for changes
        if (document.body) {
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        } else {
            // If body doesn't exist yet, wait for it
            const bodyObserver = new MutationObserver(() => {
                if (document.body && mutationObserver) {
                    mutationObserver.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    bodyObserver.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, {
                childList: true
            });
        }

        // Listen to standard navigation events
        window.addEventListener('popstate', checkNavigation);
        window.addEventListener('hashchange', checkNavigation);

        // Intercept history API calls
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        history.pushState = function pushState(...args) {
            originalPushState.apply(history, args);
            setTimeout(checkNavigation, 0);
        };
        history.replaceState = function replaceState(...args) {
            originalReplaceState.apply(history, args);
            setTimeout(checkNavigation, 0);
        };

        // Fallback: Poll URL changes as a last resort (for SPAs that don't use standard APIs)
        urlPollInterval = setInterval(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                checkNavigation();
            }
        }, 1000);

        // Cleanup function (called in destroy)
        this.navigationCleanup = () => {
            if (navigationTimeout) {
                clearTimeout(navigationTimeout);
            }
            if (domChangeTimeout) {
                clearTimeout(domChangeTimeout);
            }
            if (urlPollInterval) {
                clearInterval(urlPollInterval);
            }
            if (mutationObserver) {
                mutationObserver.disconnect();
            }
            window.removeEventListener('popstate', checkNavigation);
            window.removeEventListener('hashchange', checkNavigation);
            history.pushState = originalPushState;
            history.replaceState = originalReplaceState;
        };
    }

    private getCurrentZoomScale() {
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
    }

    private setupZoomHandling() {
        if (!this.updateUIScaleBound) {
            this.updateUIScaleBound = this.updateUIScale.bind(this);
        }
        this.useZoomFallback = !('zoom' in document.body.style);
        if (!this.zoomHandlingSetup) {
            window.addEventListener('resize', this.updateUIScaleBound);
            if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
                window.visualViewport.addEventListener('resize', this.updateUIScaleBound);
            }
            this.zoomHandlingSetup = true;
        }
        this.updateUIScale();
    }

    updateUIScale() {
        const zoomScale = this.getCurrentZoomScale();
        const scale = zoomScale > 0 ? 1 / zoomScale : 1;
        this.currentUIScale = scale;
        this.applyOverlayTransform();
        this.applyMarkerScale(scale);
    }

    applyOverlayTransform(translateY?: number) {
        if (!this.overlayElement) {
            return;
        }
        const overlay = this.overlayElement;
        if (typeof translateY === 'number' && !Number.isNaN(translateY)) {
            overlay.dataset.translateY = String(translateY);
        }
        const translateValue = overlay.dataset.translateY ? Number(overlay.dataset.translateY) : 0;
        if (this.useZoomFallback) {
            const scale = this.currentUIScale || 1;
            overlay.style.transformOrigin = 'top right';
            overlay.style.transform = `translateY(${translateValue}px) scale(${scale})`;
            overlay.style.zoom = '';
        } else {
            overlay.style.transformOrigin = '';
            overlay.style.transform = `translateY(${translateValue}px)`;
            overlay.style.zoom = `${this.currentUIScale}`;
        }
    }

    applyMarkerScale(_scale?: number) {
        if (!this.markerContainer) {
            return;
        }
        const container = this.markerContainer;
        // Let the page zoom affect the marker bar naturally; do not apply reverse scaling here.
        container.style.transformOrigin = '';
        container.style.transform = '';
        container.style.zoom = '';
    }

    scheduleSortPatternsByMatchCount() {
        const runSort = () => {
            this.sortIdleCallbackId = null;
            this.sortTimeoutId = null;
            this.sortPatternsByMatchCount().catch((error) => console.warn('Error sorting patterns:', error));
        };
        if ('requestIdleCallback' in window) {
            if (this.sortIdleCallbackId !== null && 'cancelIdleCallback' in window) {
                (window as unknown as { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback(
                    this.sortIdleCallbackId
                );
            }
            this.sortIdleCallbackId = (window as unknown as { requestIdleCallback: (cb: () => void, options?: any) => number }).requestIdleCallback(
                runSort,
                { timeout: 2000 }
            );
        } else {
            if (this.sortTimeoutId !== null) {
                clearTimeout(this.sortTimeoutId);
            }
            this.sortTimeoutId = setTimeout(runSort, 100);
        }
    }

    private async sortPatternsByMatchCount() {
        if (!this.searchPattern || this.savedPatterns.length <= 1) {
            return;
        }
        try {
            const textNodes: CollectTextNode[] = [];
            const nodeMap = new Map<number, Text>();
            await this.collectTextNodesInBatches(this.overlayElement, textNodes, nodeMap);
            const patternCounts = await Promise.all(
                this.savedPatterns.map((pattern) => this.countMatches(pattern, textNodes))
            );
            const patternWithCounts = this.savedPatterns.map((pattern, index) => ({
                pattern,
                count: patternCounts[index]
            }));
            patternWithCounts.sort((a, b) => b.count - a.count);
            this.savedPatterns = patternWithCounts.map((item) => item.pattern);
            this.persistSavedPatterns();
            this.notifyStateChange();
        } catch (error) {
            console.warn('Could not sort patterns by match count:', error);
        }
    }

    private async countMatches(pattern: string, textNodes: CollectTextNode[]) {
        const flags = this.getRegexFlagsString();
        try {
            // eslint-disable-next-line no-new
            new RegExp(pattern, flags);
        } catch (error) {
            return 0;
        }
        if (this.worker && textNodes.length > 0) {
            try {
                const requestId = Date.now() + Math.random();
                const promise = new Promise((resolve, reject) => {
                    this.workerPendingRequests.set(requestId, { resolve, reject });
                });
                this.worker.postMessage({
                    type: 'countMatches',
                    pattern,
                    flags,
                    textNodes,
                    requestId
                });
                const count = (await promise) as number;
                return count;
            } catch (error) {
                if (error instanceof SearchCancelledError) {
                    return 0;
                }
                console.warn('Worker error, falling back to main thread for counting:', error);
            }
        }
        const regex = new RegExp(pattern, flags);
        const isGlobal = flags.includes('g');
        let count = 0;
        for (const textNode of textNodes) {
            const text = textNode.text;
            if (!text) {
                continue;
            }
            let match: RegExpExecArray | null;
            regex.lastIndex = 0;
            // eslint-disable-next-line no-cond-assign
            while ((match = regex.exec(text)) !== null) {
                count++;
                if (!isGlobal) {
                    break;
                }
                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }
            if (!isGlobal && count > 0) {
                break;
            }
        }
        return count;
    }
}
