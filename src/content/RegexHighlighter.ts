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
    span?: HTMLSpanElement;
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
    onActiveMatchSpanChange?: (span: HTMLSpanElement | null) => void;
    onMatchesUpdated?: (matches: MatchEntry[]) => void;
    onPatternRestored?: (pattern: string) => void;
};

type CollectTextNode = { text: string };

const HIGHLIGHT_CLASS = 'regex-highlight-match';
const ACTIVE_CLASS = 'regex-highlight-active';
const POSITION_STORAGE_KEY = 'regex-highlight-position';
const PATTERN_STORAGE_KEY = 'regex-highlight-patterns';
const SETTINGS_PREFIX = 'regex-highlight-setting-';
const SEARCH_STATE_KEY = 'regex-search-state';

export class RegexHighlighter {
    private matches: MatchEntry[] = [];
    private currentIndex = -1;
    private searchPattern = '';
    private matchTypes: string[] = [];
    private savedPatterns: string[] = [];
    private maxSavedPatterns = 8;
    private worker: Worker | null = null;
    private workerPendingRequests = new Map<number, PendingRequest>();
    private isScrollingProgrammatically = false;
    private scrollHandler?: () => void;
    private scrollTimeout?: number;
    private callbacks: CallbackEvents;
    private textNodeMap = new Map<number, Text>();
    private scrollOnSearch: boolean;
    private regexFlags: RegexFlags;
    private useZoomFallback = false;
    private baseDevicePixelRatio: number;
    private zoomHandlingSetup = false;
    private currentUIScale = 1;
    private updateUIScaleBound: (() => void) | null = null;
    private sortIdleCallbackId: number | null = null;
    private sortTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private overlayElement: HTMLElement | null = null;
    private markerContainer: HTMLElement | null = null;

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
        this.baseDevicePixelRatio = window.devicePixelRatio || 1;
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
        void this.clearHighlights();
        this.worker?.terminate();
        this.workerPendingRequests.clear();
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
    }

    getState(): HighlighterState {
        return {
            searchPattern: this.searchPattern,
            matchesTotal: this.matches.length,
            currentIndex: this.currentIndex,
            matchTypes: this.matchTypes.slice(),
            matchTypeCounts: this.computeMatchTypeCounts(),
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

        this.searchPattern = pattern;
        this.savePattern(pattern);
        this.saveSearchState(pattern);

        await this.clearHighlights();
        await this.findMatches();
        await this.highlightMatches();

        this.currentIndex = this.matches.length > 0 ? 0 : -1;
        this.notifyStateChange();

        if (this.currentIndex >= 0 && this.scrollOnSearch) {
            this.scrollToMatch(this.currentIndex);
        }

        this.setupScrollTracking();
        this.scheduleSortPatternsByMatchCount();
        this.updateScrollbarMarkers();
    }

    async clear() {
        await this.clearHighlights();
        this.searchPattern = '';
        this.currentIndex = -1;
        this.matchTypes = [];
        this.clearSearchState();
        this.notifyStateChange();
        this.clearScrollbarMarkers();
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
        this.matches.forEach((match, idx) => {
            match.span?.classList.toggle(ACTIVE_CLASS, idx === index);
        });
    }

    getMatches(): MatchEntry[] {
        return this.matches;
    }

    saveOverlayPosition(position: { top: number; right: number }) {
        try {
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
        } catch (error) {
            console.warn('Could not save position to localStorage', error);
        }
    }

    loadOverlayPosition(): { top: number; right: number } | null {
        try {
            const saved = localStorage.getItem(POSITION_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as { top: number; right: number };
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
        try {
            localStorage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(this.savedPatterns));
        } catch (error) {
            console.warn('Could not save patterns to localStorage', error);
        }
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
              textNodes.forEach((textNode, nodeIndex) => {
                const text = textNode.text;
                if (!text) return;
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
                  if (matchedText.length === 0) {
                    regex.lastIndex++;
                  }
                }
              });
              self.postMessage({ type: 'matches', matches, requestId });
            } catch (error) {
              self.postMessage({ type: 'error', error: error.message, requestId });
            }
          } else if (type === 'countMatches') {
            try {
              const regex = new RegExp(pattern, flags);
              let count = 0;
              textNodes.forEach((textNode) => {
                const text = textNode.text;
                if (!text) return;
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                  count++;
                  if (match[0].length === 0) {
                    regex.lastIndex++;
                  }
                }
              });
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
        if (cleanPattern.startsWith('(') && cleanPattern.endsWith(')')) {
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
        for (let i = 0; i < cleanPattern.length; i++) {
            const char = cleanPattern[i];
            if (escaped) {
                currentPart += char;
                escaped = false;
            } else if (char === '\\') {
                currentPart += char;
                escaped = true;
            } else if (char === '|') {
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

    private determineMatchType(matchedText: string, alternatives: string[]) {
        if (alternatives.length === 0) {
            return null;
        }
        const altFlags = this.regexFlags.ignoreCase ? 'i' : '';
        for (let i = 0; i < alternatives.length; i++) {
            try {
                const regex = new RegExp(`^${alternatives[i]}$`, altFlags);
                if (regex.test(matchedText)) {
                    return i;
                }
            } catch (error) {
                if (this.regexFlags.ignoreCase) {
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

    private async findMatches() {
        this.matches = [];
        this.matchTypes = [];
        const flags = this.getRegexFlagsString();
        const alternatives = this.extractAlternatives(this.searchPattern);
        if (alternatives.length > 0) {
            this.matchTypes = alternatives;
        }

        const overlay = this.overlayElement;
        const textNodes: CollectTextNode[] = [];
        this.textNodeMap = new Map();
        await this.collectTextNodesInBatches(overlay, textNodes, this.textNodeMap);

        if (this.worker && textNodes.length > 0) {
            try {
                const requestId = Date.now() + Math.random();
                const promise = new Promise((resolve, reject) => {
                    this.workerPendingRequests.set(requestId, { resolve, reject });
                });
                this.worker.postMessage({
                    type: 'findMatches',
                    pattern: this.searchPattern,
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
                workerMatches.forEach((match) => {
                    const node = this.textNodeMap.get(match.nodeIndex);
                    if (node) {
                        this.matches.push({
                            node,
                            index: match.index,
                            length: match.length,
                            matchType: match.matchType
                        });
                    }
                });
                return;
            } catch (error) {
                console.warn('Worker error, falling back to main thread:', error);
            }
        }

        const regex = new RegExp(this.searchPattern, flags);
        textNodes.forEach((textNode, nodeIndex) => {
            const node = this.textNodeMap.get(nodeIndex);
            if (!node) {
                return;
            }
            const text = textNode.text;
            if (!text) {
                return;
            }
            let match: RegExpExecArray | null;
            regex.lastIndex = 0;
            while ((match = regex.exec(text)) !== null) {
                const matchedText = match[0];
                const matchType = this.determineMatchType(matchedText, alternatives);
                this.matches.push({
                    node,
                    index: match.index,
                    length: matchedText.length,
                    matchType
                });
                if (matchedText.length === 0) {
                    regex.lastIndex++;
                }
            }
        });
    }

    private collectTextNodesInBatches(
        overlay: HTMLElement | null,
        textNodes: CollectTextNode[],
        textNodeMap: Map<number, Text>
    ) {
        return new Promise<void>((resolve) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            const BATCH_SIZE = 100;
            let node: Text | null;

            const processBatch = () => {
                let count = 0;
                while (count < BATCH_SIZE && (node = walker.nextNode() as Text | null)) {
                    if (overlay && overlay.contains(node)) {
                        continue;
                    }
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
                    resolve();
                }
            };
            processBatch();
        });
    }

    private async highlightMatches() {
        const matchesByNode = new Map<Text, (MatchEntry & { originalIndex: number })[]>();
        this.matches.forEach((match, idx) => {
            const nodeMatches = matchesByNode.get(match.node) ?? [];
            nodeMatches.push({ ...match, originalIndex: idx });
            matchesByNode.set(match.node, nodeMatches);
        });

        const nodes = Array.from(matchesByNode.keys());
        const BATCH_SIZE = 50;
        for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
            const batch = nodes.slice(i, i + BATCH_SIZE);
            if (i > 0) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => requestAnimationFrame(resolve));
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
                    const span = document.createElement('span');
                    let className = HIGHLIGHT_CLASS;
                    if (match.matchType !== null && this.matchTypes.length > 1) {
                        className += ` regex-highlight-type-${match.matchType}`;
                    }
                    span.className = className;
                    span.dataset.matchIndex = String(match.originalIndex);
                    span.textContent = text.substring(match.index, match.index + match.length);
                    fragment.appendChild(span);
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
    }

    private async clearHighlights() {
        const highlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
        const parentsToNormalize = new Set<Node>();
        const highlightArray = Array.from(highlights);
        const BATCH_SIZE = 100;
        for (let i = 0; i < highlightArray.length; i += BATCH_SIZE) {
            const batch = highlightArray.slice(i, i + BATCH_SIZE);
            if (i > 0) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            batch.forEach((span) => {
                const parent = span.parentNode;
                if (parent) {
                    parent.replaceChild(document.createTextNode(span.textContent ?? ''), span);
                    parentsToNormalize.add(parent);
                }
            });
        }
        const parentsArray = Array.from(parentsToNormalize);
        for (let i = 0; i < parentsArray.length; i += BATCH_SIZE) {
            const batch = parentsArray.slice(i, i + BATCH_SIZE);
            if (i > 0) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            batch.forEach((parent) => {
                if ('normalize' in parent && typeof (parent as ParentNode).normalize === 'function') {
                    (parent as ParentNode).normalize();
                }
            });
        }
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler, true);
            this.scrollHandler = undefined;
        }
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = undefined;
        }
        this.matches = [];
        this.currentIndex = -1;
        this.matchTypes = [];
        this.callbacks.onMatchesUpdated?.(this.matches);
    }

    private scrollToMatch(index: number) {
        if (index < 0 || index >= this.matches.length) {
            return;
        }
        this.isScrollingProgrammatically = true;
        const match = this.matches[index];
        const span =
            match.span ??
            (document.querySelector(`.${HIGHLIGHT_CLASS}[data-match-index="${index}"]`) as HTMLSpanElement | null);
        if (!span) {
            return;
        }
        match.span = span;
        this.matches.forEach((entry, idx) => {
            entry.span?.classList.toggle(ACTIVE_CLASS, idx === index);
        });
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this.callbacks.onActiveMatchSpanChange?.(span);
        setTimeout(() => {
            this.isScrollingProgrammatically = false;
            this.updateScrollbarMarkers();
        }, 500);
    }

    private setupScrollTracking() {
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler, true);
        }
        if (this.matches.length === 0) {
            return;
        }
        this.scrollHandler = () => {
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
        window.addEventListener('scroll', this.scrollHandler, true);
        setTimeout(() => this.updateActiveMatchFromScroll(), 200);
    }

    private updateActiveMatchFromScroll() {
        if (this.matches.length === 0 || this.isScrollingProgrammatically) {
            return;
        }
        const viewportTop = 0;
        const viewportBottom = window.innerHeight;
        let firstVisibleIndex = -1;
        let firstVisibleTop = Infinity;
        this.matches.forEach((match, index) => {
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
            this.matches.forEach((match, index) => {
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
        this.matches.forEach((match, index) => {
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
            let markerClass = 'regex-scrollbar-marker';
            if (match.matchType !== null && this.matchTypes.length > 1) {
                markerClass += ` regex-scrollbar-marker-type-${match.matchType}`;
            }
            marker.className = markerClass;
            marker.dataset.matchIndex = String(index);
            if (index === this.currentIndex) {
                marker.classList.add('active');
            }
            marker.style.top = `${markerTop}px`;
            marker.title = this.getMatchContext(match, 50);
            marker.addEventListener('click', () => {
                this.currentIndex = index;
                this.scrollToMatch(index);
                this.notifyStateChange();
            });
            container.appendChild(marker);
        });
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
        const parent = match.span.parentElement;
        if (!parent) {
            return matchText;
        }
        let fullText = '';
        let matchPosition = -1;
        let currentPos = 0;
        parent.childNodes.forEach((child) => {
            if (child === match.span) {
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
        try {
            localStorage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(this.savedPatterns));
        } catch (error) {
            console.warn('Could not save pattern to localStorage', error);
        }
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
        chrome.storage.local.set({ [SEARCH_STATE_KEY]: state }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Could not save search state:', chrome.runtime.lastError);
            }
        });
    }

    private clearSearchState() {
        chrome.storage.local.remove(SEARCH_STATE_KEY, () => {
            if (chrome.runtime.lastError) {
                console.warn('Could not clear search state:', chrome.runtime.lastError);
            }
        });
    }

    private getDomain() {
        return window.location.hostname;
    }

    private computeMatchTypeCounts() {
        const counts: Record<string, number> = {};
        if (this.matchTypes.length <= 1) {
            return counts;
        }
        this.matches.forEach((match) => {
            if (match.matchType !== null && this.matchTypes[match.matchType]) {
                const key = this.matchTypes[match.matchType];
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
        let navigationTimeout: ReturnType<typeof setTimeout> | null = null;

        const checkNavigation = () => {
            const currentUrl = location.href;
            const currentDomain = this.getDomain();
            if (currentUrl === lastUrl) {
                return;
            }
            lastUrl = currentUrl;
            if (navigationTimeout) {
                clearTimeout(navigationTimeout);
            }
            chrome.storage.local.get(SEARCH_STATE_KEY, (result) => {
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
                    this.clearSearchState();
                    void this.clearHighlights();
                    this.searchPattern = '';
                    this.notifyStateChange();
                    return;
                }
                navigationTimeout = setTimeout(() => {
                    this.searchPattern = state.pattern;
                    if (state.flags) {
                        this.regexFlags = { ...this.regexFlags, ...state.flags };
                    }
                    this.notifyStateChange();
                    void (async () => {
                        await this.clearHighlights();
                        await this.findMatches();
                        await this.highlightMatches();
                        this.currentIndex = this.matches.length > 0 ? 0 : -1;
                        if (this.currentIndex >= 0 && this.scrollOnSearch) {
                            this.scrollToMatch(this.currentIndex);
                        }
                        this.setupScrollTracking();
                        this.updateScrollbarMarkers();
                        this.notifyStateChange();
                    })();
                }, 500);
            });
        };

        window.addEventListener('popstate', checkNavigation);
        window.addEventListener('hashchange', checkNavigation);

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

        let domObserver: MutationObserver | null = null;
        const setupObserver = () => {
            if (domObserver) {
                domObserver.disconnect();
            }
            domObserver = new MutationObserver((mutations) => {
                let shouldCheck = false;
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        for (const node of Array.from(mutation.addedNodes)) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const tagName = (node as HTMLElement).tagName.toLowerCase();
                                if (!['script', 'style', 'link', 'meta', 'noscript'].includes(tagName)) {
                                    shouldCheck = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (shouldCheck) {
                        break;
                    }
                }
                if (shouldCheck) {
                    if (navigationTimeout) {
                        clearTimeout(navigationTimeout);
                    }
                    navigationTimeout = setTimeout(checkNavigation, 300);
                }
            });
            if (document.body) {
                domObserver.observe(document.body, { childList: true, subtree: true });
            }
        };
        if (document.body) {
            setupObserver();
        } else {
            const bodyObserver = new MutationObserver(() => {
                if (document.body) {
                    setupObserver();
                    bodyObserver.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
        }
    }

    private getCurrentZoomScale() {
        if (window.visualViewport && typeof window.visualViewport.scale === 'number') {
            const viewportScale = window.visualViewport.scale;
            return viewportScale && viewportScale > 0 ? viewportScale : 1;
        }
        const baseRatio = this.baseDevicePixelRatio || 1;
        const currentRatio = window.devicePixelRatio || baseRatio;
        if (baseRatio <= 0) {
            return 1;
        }
        return currentRatio / baseRatio;
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

    applyMarkerScale(scale?: number) {
        if (!this.markerContainer) {
            return;
        }
        const container = this.markerContainer;
        const effectiveScale = typeof scale === 'number' && scale > 0 ? scale : this.currentUIScale || 1;
        if (this.useZoomFallback) {
            container.style.transformOrigin = 'top right';
            container.style.transform = `scale(${effectiveScale})`;
            container.style.zoom = '';
        } else {
            container.style.transformOrigin = '';
            container.style.transform = '';
            container.style.zoom = `${effectiveScale}`;
        }
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
            localStorage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(this.savedPatterns));
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
                console.warn('Worker error, falling back to main thread for counting:', error);
            }
        }
        const regex = new RegExp(pattern, flags);
        let count = 0;
        textNodes.forEach((textNode) => {
            const text = textNode.text;
            if (!text) {
                return;
            }
            let match: RegExpExecArray | null;
            regex.lastIndex = 0;
            // eslint-disable-next-line no-cond-assign
            while ((match = regex.exec(text)) !== null) {
                count++;
                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }
        });
        return count;
    }
}

