// Regex Highlight & Search Extension
class RegexHighlighter {
    constructor() {
        this.matches = [];
        this.currentIndex = -1;
        this.searchPattern = '';
        this.highlightClass = 'regex-highlight-match';
        this.activeClass = 'regex-highlight-active';
        this.isMinimized = true;
        this.isScrollingProgrammatically = false;
        this.intersectionObserver = null;
        this.scrollTimeout = null;
        this.scrollHandler = null;
        this.savedPatterns = this.loadSavedPatterns();
        this.maxSavedPatterns = 8;
        this.isDragging = false;
        this.collapsibleExpanded = this.loadSetting('collapsibleExpanded', true);
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartLeft = 0;
        this.dragStartTop = 0;
        this.scrollbarMarkerContainer = null;
        this.scrollOnSearch = this.loadSetting('scrollOnSearch', false);
        this.matchTypes = []; // Store alternative types for multi-type coloring
        // Regex flags - default to 'gi' (global and case-insensitive) to match current behavior
        this.regexFlags = {
            global: this.loadSetting('regexFlagGlobal', true),
            ignoreCase: this.loadSetting('regexFlagIgnoreCase', true),
            multiline: this.loadSetting('regexFlagMultiline', false),
            dotAll: this.loadSetting('regexFlagDotAll', false)
        };
        this.init();
    }

    getRegexFlagsString() {
        let flags = '';
        if (this.regexFlags.global) flags += 'g';
        if (this.regexFlags.ignoreCase) flags += 'i';
        if (this.regexFlags.multiline) flags += 'm';
        if (this.regexFlags.dotAll) flags += 's';
        return flags;
    }

    init() {
        // Create UI overlay first
        this.createUI();

        // Check for persisted search on same domain (after UI is created)
        this.restoreSearchIfSameDomain();

        // Sort patterns by match count on page load (after UI is ready)
        // Use setTimeout to ensure DOM is fully ready
        setTimeout(() => {
            this.sortPatternsByMatchCount();
        }, 100);

        // Listen for navigation events (for SPAs)
        this.setupNavigationListener();

        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'search') {
                this.search(message.pattern);
            } else if (message.action === 'clear') {
                this.clear();
            } else if (message.action === 'next') {
                this.next();
            } else if (message.action === 'previous') {
                this.previous();
            }
            sendResponse({ success: true });
        });
    }

    createUI() {
        // Check if UI already exists
        if (document.getElementById('regex-highlight-ui')) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'regex-highlight-ui';
        if (this.isMinimized) {
            overlay.classList.add('minimized');
        }
        overlay.innerHTML = `
      <div class="regex-drag-handle">
        <span class="regex-drag-icon">⋮⋮</span>
        <button id="regex-minimize-btn" class="regex-minimize-btn">${this.isMinimized ? '+' : '−'}</button>
      </div>
      <div class="regex-search-container">
        <div class="regex-search-input-wrapper">
          <input type="text" id="regex-search-input" placeholder="Enter regex pattern (e.g., (dog|cat))" />
          <span id="regex-search-status" class="regex-search-status" title="Search status indicator"></span>
        </div>
        <div class="regex-search-buttons-container">
            <button id="regex-search-btn">Search</button>
            <button id="regex-clear-btn">Clear</button>
        </div>
        <div class="regex-settings">
          <label class="regex-setting-toggle">
            <input type="checkbox" id="regex-scroll-on-search" ${this.scrollOnSearch ? 'checked' : ''}>
            <span>Scroll to first match on search</span>
          </label>
          <div class="regex-collapsible-section">
            <button class="regex-collapsible-header" id="regex-collapsible-toggle">
              <span class="regex-collapsible-icon">${this.collapsibleExpanded ? '▼' : '▶'}</span>
              <span class="regex-collapsible-title">Flags & Patterns</span>
            </button>
            <div class="regex-collapsible-content" id="regex-collapsible-content" style="display: ${this.collapsibleExpanded ? 'block' : 'none'};">
              <div class="regex-flags-container">
                <label class="regex-flag-label" title="Global: Find all matches (not just first)">
                  <input type="checkbox" id="regex-flag-global" ${this.regexFlags.global ? 'checked' : ''}>
                  <span>g (Global)</span>
                </label>
                <label class="regex-flag-label" title="Case-insensitive">
                  <input type="checkbox" id="regex-flag-ignorecase" ${this.regexFlags.ignoreCase ? 'checked' : ''}>
                  <span>i (Ignore Case)</span>
                </label>
                <label class="regex-flag-label" title="Multiline: ^ and $ match line breaks">
                  <input type="checkbox" id="regex-flag-multiline" ${this.regexFlags.multiline ? 'checked' : ''}>
                  <span>m (Multiline)</span>
                </label>
                <label class="regex-flag-label" title="DotAll: . matches newline">
                  <input type="checkbox" id="regex-flag-dotall" ${this.regexFlags.dotAll ? 'checked' : ''}>
                  <span>s (DotAll)</span>
                </label>
              </div>
              <div id="regex-pattern-history" class="regex-pattern-history"></div>
            </div>
          </div>
        </div>
        <div class="regex-navigation">
          <button id="regex-prev-btn" disabled>◀ Prev</button>
          <div class="regex-match-counter-container">
            <span id="regex-match-counter">0 / 0</span>
          </div>
          <button id="regex-next-btn" disabled>Next ▶</button>
        </div>
        <div>
            <span id="regex-match-type-counts" class="regex-match-type-counts"></span>
        </div>
      </div>
    `;
        document.body.appendChild(overlay);

        // Load saved position
        this.loadPosition(overlay);

        // Setup drag functionality
        this.setupDragging(overlay);

        // Event listeners
        const minimizeBtn = document.getElementById('regex-minimize-btn');

        // Set initial button title
        if (minimizeBtn) {
            minimizeBtn.title = this.isMinimized ? 'Expand' : 'Minimize';
        }

        // Store overlay reference for dragging
        this.overlay = overlay;
        const searchInput = document.getElementById('regex-search-input');
        const searchBtn = document.getElementById('regex-search-btn');
        const clearBtn = document.getElementById('regex-clear-btn');
        const prevBtn = document.getElementById('regex-prev-btn');
        const nextBtn = document.getElementById('regex-next-btn');
        const scrollOnSearchCheckbox = document.getElementById('regex-scroll-on-search');

        // Pattern validation on input
        searchInput.addEventListener('input', (e) => {
            this.validatePattern(e.target.value);
        });
        const flagGlobalCheckbox = document.getElementById('regex-flag-global');
        const flagIgnoreCaseCheckbox = document.getElementById('regex-flag-ignorecase');
        const flagMultilineCheckbox = document.getElementById('regex-flag-multiline');
        const flagDotAllCheckbox = document.getElementById('regex-flag-dotall');

        // Setting toggle handler
        if (scrollOnSearchCheckbox) {
            scrollOnSearchCheckbox.addEventListener('change', (e) => {
                this.scrollOnSearch = e.target.checked;
                this.saveSetting('scrollOnSearch', this.scrollOnSearch);
            });
        }

        // Regex flag handlers
        if (flagGlobalCheckbox) {
            flagGlobalCheckbox.addEventListener('change', (e) => {
                this.regexFlags.global = e.target.checked;
                this.saveSetting('regexFlagGlobal', this.regexFlags.global);
            });
        }
        if (flagIgnoreCaseCheckbox) {
            flagIgnoreCaseCheckbox.addEventListener('change', (e) => {
                this.regexFlags.ignoreCase = e.target.checked;
                this.saveSetting('regexFlagIgnoreCase', this.regexFlags.ignoreCase);
            });
        }
        if (flagMultilineCheckbox) {
            flagMultilineCheckbox.addEventListener('change', (e) => {
                this.regexFlags.multiline = e.target.checked;
                this.saveSetting('regexFlagMultiline', this.regexFlags.multiline);
            });
        }
        if (flagDotAllCheckbox) {
            flagDotAllCheckbox.addEventListener('change', (e) => {
                this.regexFlags.dotAll = e.target.checked;
                this.saveSetting('regexFlagDotAll', this.regexFlags.dotAll);
            });
        }

        minimizeBtn.addEventListener('click', () => this.toggleMinimize());

        searchBtn.addEventListener('click', () => {
            const pattern = searchInput.value.trim();
            if (pattern) {
                this.search(pattern);
            }
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const pattern = searchInput.value.trim();
                if (pattern) {
                    this.search(pattern);
                }
            }
        });

        searchInput.addEventListener('input', () => {
            this.updateButtonStates();
        });

        clearBtn.addEventListener('click', () => {
            this.clear();
            searchInput.value = '';
            // Clear validation errors
            searchInput.classList.remove('regex-input-invalid');
            const errorMessage = document.getElementById('regex-pattern-error');
            if (errorMessage) {
                errorMessage.remove();
            }
            this.updateButtonStates();
        });

        // Initialize button states
        this.updateButtonStates();

        prevBtn.addEventListener('click', () => this.previous());
        nextBtn.addEventListener('click', () => this.next());

        // Collapsible toggle handler
        const collapsibleToggle = document.getElementById('regex-collapsible-toggle');
        if (collapsibleToggle) {
            collapsibleToggle.addEventListener('click', () => this.toggleCollapsible());
        }

        // Render saved patterns
        this.renderSavedPatterns();

        // Create scrollbar markers
        this.createScrollbarMarkers();

        // Setup ripple effects for all buttons
        this.setupRippleEffects();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if ((e.key === 'f' || e.key === 'F') && !e.shiftKey) {
                    e.preventDefault();
                    if (this.isMinimized) {
                        // If minimized: unminimize and focus search
                        // Check for selected text first
                        const selectedText = window.getSelection().toString().trim();

                        this.toggleMinimize();
                        // Small delay to ensure widget is expanded before focusing
                        setTimeout(() => {
                            const input = document.getElementById('regex-search-input');
                            if (input) {
                                // If there's selected text, use it for search
                                if (selectedText) {
                                    input.value = selectedText;
                                    // Trigger search with the selected text
                                    this.search(selectedText);
                                } else {
                                    input.focus();
                                    input.select(); // Select existing text for easy replacement
                                }
                            }
                        }, 50);
                    } else {
                        // If maximized: minimize
                        this.toggleMinimize();
                    }
                }
            }
            if (e.key === 'F3' || (e.shiftKey && e.key === 'F3')) {
                e.preventDefault();
                if (e.shiftKey) {
                    this.previous();
                } else {
                    this.next();
                }
            }
        });
    }

    validatePattern(pattern) {
        const searchInput = document.getElementById('regex-search-input');
        const errorMessage = document.getElementById('regex-pattern-error');

        if (!searchInput) return;

        // Remove existing error message if any
        if (errorMessage) {
            errorMessage.remove();
        }

        // Clear validation styling if pattern is empty
        if (!pattern.trim()) {
            searchInput.classList.remove('regex-input-invalid');
            return;
        }

        try {
            // Test if pattern is valid regex
            const flags = this.getRegexFlagsString();
            new RegExp(pattern, flags);
            // Valid pattern - remove invalid styling
            searchInput.classList.remove('regex-input-invalid');
        } catch (error) {
            // Invalid pattern - add visual feedback
            searchInput.classList.add('regex-input-invalid');

            // Create error message element if it doesn't exist
            if (!errorMessage) {
                const errorDiv = document.createElement('div');
                errorDiv.id = 'regex-pattern-error';
                errorDiv.className = 'regex-pattern-error';
                searchInput.parentNode.insertBefore(errorDiv, searchInput.nextSibling);
            }

            // Update error message
            const errorDiv = document.getElementById('regex-pattern-error');
            if (errorDiv) {
                errorDiv.textContent = `Invalid regex: ${error.message}`;
            }
        }
    }

    search(pattern) {
        // Clear any validation errors first
        const searchInput = document.getElementById('regex-search-input');
        if (searchInput) {
            searchInput.classList.remove('regex-input-invalid');
        }
        const errorMessage = document.getElementById('regex-pattern-error');
        if (errorMessage) {
            errorMessage.remove();
        }

        try {
            // Test if pattern is valid regex
            const flags = this.getRegexFlagsString();
            new RegExp(pattern, flags);
            this.searchPattern = pattern;
            this.savePattern(pattern);

            // Save search state for domain persistence
            this.saveSearchState(pattern);

            this.clearHighlights();
            this.findMatches();
            this.highlightMatches();
            this.currentIndex = this.matches.length > 0 ? 0 : -1;
            this.updateNavigation();
            if (this.currentIndex >= 0 && this.scrollOnSearch) {
                this.scrollToMatch(this.currentIndex);
            }
            // Setup intersection observer for scroll tracking
            this.setupScrollTracking();
            // Sort patterns by match count and update pattern history display
            this.sortPatternsByMatchCount();
            // Update scrollbar markers
            this.updateScrollbarMarkers();
            // Update button states
            this.updateButtonStates();
        } catch (error) {
            // Show validation error
            this.validatePattern(pattern);
        }
    }

    extractAlternatives(pattern) {
        // Simple extraction of alternatives from patterns like "cat|dog" or "(cat|dog)"
        // This handles simple cases - for complex regex patterns, it may not work perfectly
        const alternatives = [];

        // Try to extract alternatives from the pattern
        try {
            // Check if pattern contains alternation
            if (!pattern.includes('|')) {
                return [];
            }

            // Simple case: pattern like "cat|dog" or "(cat|dog)"
            let cleanPattern = pattern.trim();

            // Remove outer parentheses if present (for grouping like "(cat|dog)")
            // But be careful - only remove if the entire pattern is wrapped
            if (cleanPattern.startsWith('(') && cleanPattern.endsWith(')')) {
                // Check if it's balanced - simple check
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

            // Split by | - handle escaped pipes
            // Use a simple approach: split and check for escaped pipes
            const parts = [];
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
            parts.push(currentPart.trim()); // Add the last part

            if (parts.length > 1) {
                // Clean up each part and add if not empty
                parts.forEach(part => {
                    if (part) {
                        alternatives.push(part);
                    }
                });
            }
        } catch (e) {
            // If parsing fails, return empty array (will use single color)
            console.warn('Could not extract alternatives from pattern:', e);
        }

        return alternatives.length > 1 ? alternatives : [];
    }

    determineMatchType(matchedText, alternatives) {
        if (alternatives.length === 0) {
            return null;
        }

        // Test which alternative matches the text
        // Use 'i' flag if ignoreCase is enabled, otherwise no flags
        const altFlags = this.regexFlags.ignoreCase ? 'i' : '';
        for (let i = 0; i < alternatives.length; i++) {
            try {
                const altRegex = new RegExp('^' + alternatives[i] + '$', altFlags);
                if (altRegex.test(matchedText)) {
                    return i;
                }
            } catch (e) {
                // If alternative is not a valid regex, try exact match
                if (this.regexFlags.ignoreCase) {
                    if (matchedText.toLowerCase() === alternatives[i].toLowerCase()) {
                        return i;
                    }
                } else {
                    if (matchedText === alternatives[i]) {
                        return i;
                    }
                }
            }
        }

        // If no match found, return first type as default
        return 0;
    }

    findMatches() {
        this.matches = [];
        const flags = this.getRegexFlagsString();
        const regex = new RegExp(this.searchPattern, flags);

        // Extract alternatives for type-based coloring
        const alternatives = this.extractAlternatives(this.searchPattern);
        this.matchTypes = alternatives.length > 0 ? alternatives : [];

        // Get the widget overlay to exclude from matching
        const widgetOverlay = document.getElementById('regex-highlight-ui');

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while ((node = walker.nextNode())) {
            // Skip text nodes inside the widget overlay
            if (widgetOverlay && widgetOverlay.contains(node)) {
                continue;
            }

            const text = node.textContent;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const matchedText = match[0];
                const matchType = this.determineMatchType(matchedText, alternatives);

                this.matches.push({
                    node: node,
                    index: match.index,
                    length: match[0].length,
                    matchType: matchType // Store which type this match is
                });
                // Reset lastIndex to avoid infinite loop on zero-length matches
                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }
        }
    }

    highlightMatches() {
        // Group matches by text node
        const matchesByNode = new Map();
        this.matches.forEach((match, idx) => {
            if (!matchesByNode.has(match.node)) {
                matchesByNode.set(match.node, []);
            }
            matchesByNode.get(match.node).push({ ...match, originalIndex: idx });
        });

        // Process each node - split once with all matches
        matchesByNode.forEach((nodeMatches, node) => {
            // Sort matches by index
            nodeMatches.sort((a, b) => a.index - b.index);

            const text = node.textContent;
            if (!text) return;

            const parent = node.parentNode;
            if (!parent) return;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            nodeMatches.forEach(match => {
                // Add text before this match
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                }

                // Add highlighted span for the match
                const span = document.createElement('span');
                let className = this.highlightClass;

                // Add type-specific class if we have multiple types
                if (match.matchType !== null && this.matchTypes.length > 1) {
                    className += ` regex-highlight-type-${match.matchType}`;
                }

                span.className = className;
                span.dataset.matchIndex = match.originalIndex.toString();
                span.textContent = text.substring(match.index, match.index + match.length);
                fragment.appendChild(span);

                // Update match reference
                this.matches[match.originalIndex].span = span;

                lastIndex = match.index + match.length;
            });

            // Add remaining text after last match
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }

            // Replace the original node with the fragment
            parent.replaceChild(fragment, node);
        });
    }

    clearHighlights() {
        const highlights = document.querySelectorAll(`.${this.highlightClass}`);
        const parentsToNormalize = new Set();

        highlights.forEach(span => {
            const parent = span.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(span.textContent), span);
                parentsToNormalize.add(parent);
            }
        });

        // Normalize each affected parent once
        parentsToNormalize.forEach(parent => parent.normalize());

        // Remove scroll listener
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler, true);
            this.scrollHandler = null;
        }

        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }

        this.matches = [];
        this.currentIndex = -1;
        this.matchTypes = [];
        this.clearScrollbarMarkers();
    }

    clear() {
        this.clearHighlights();
        this.searchPattern = '';
        // Clear persisted search state
        this.clearSearchState();
        // Clear search input
        const searchInput = document.getElementById('regex-search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        this.updateNavigation();
        this.clearScrollbarMarkers();
        this.updateButtonStates();
    }

    next() {
        if (this.matches.length === 0) return;
        if (this.currentIndex >= 0) {
            const prevSpan = this.matches[this.currentIndex].span;
            if (prevSpan) {
                prevSpan.classList.remove(this.activeClass);
            }
        }
        this.currentIndex = (this.currentIndex + 1) % this.matches.length;
        this.scrollToMatch(this.currentIndex);
        this.updateNavigation();
        this.updateScrollbarMarkers();
    }

    previous() {
        if (this.matches.length === 0) return;
        if (this.currentIndex >= 0) {
            const prevSpan = this.matches[this.currentIndex].span;
            if (prevSpan) {
                prevSpan.classList.remove(this.activeClass);
            }
        }
        this.currentIndex = this.currentIndex <= 0
            ? this.matches.length - 1
            : this.currentIndex - 1;
        this.scrollToMatch(this.currentIndex);
        this.updateNavigation();
        this.updateScrollbarMarkers();
    }

    scrollToMatch(index) {
        if (index < 0 || index >= this.matches.length) return;
        this.isScrollingProgrammatically = true;
        const match = this.matches[index];
        const span = match.span || document.querySelector(
            `.${this.highlightClass}[data-match-index="${index}"]`
        );

        if (span) {
            match.span = span;
            span.classList.add(this.activeClass);
            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Reset flag after scroll animation completes
        setTimeout(() => {
            this.isScrollingProgrammatically = false;
            this.updateScrollbarMarkers();
        }, 500);
    }

    updateNavigation() {
        const prevBtn = document.getElementById('regex-prev-btn');
        const nextBtn = document.getElementById('regex-next-btn');
        const counter = document.getElementById('regex-match-counter');
        const typeCountsElement = document.getElementById('regex-match-type-counts');
        const statusIndicator = document.getElementById('regex-search-status');

        // Update status indicator
        if (statusIndicator) {
            if (this.searchPattern && this.searchPattern.trim()) {
                // Search is active
                if (this.matches.length > 0) {
                    // Has matches - green
                    statusIndicator.classList.remove('regex-search-status-no-matches');
                    statusIndicator.classList.add('regex-search-status-has-matches');
                    statusIndicator.title = `Search active: ${this.matches.length} match${this.matches.length !== 1 ? 'es' : ''} found`;
                } else {
                    // No matches - red
                    statusIndicator.classList.remove('regex-search-status-has-matches');
                    statusIndicator.classList.add('regex-search-status-no-matches');
                    statusIndicator.title = 'Search active: No matches found';
                }
            } else {
                // No search active - remove indicator
                statusIndicator.classList.remove('regex-search-status-has-matches', 'regex-search-status-no-matches');
                statusIndicator.title = 'No active search';
            }
        }

        if (prevBtn && nextBtn && counter) {
            const total = this.matches.length;
            const current = total > 0 ? this.currentIndex + 1 : 0;

            // Set main counter
            counter.textContent = `${current} / ${total}`;
            counter.title = `Match ${current} of ${total}`;

            // Show per-type details below main counter if multiple types exist
            if (typeCountsElement) {
                if (this.matchTypes.length > 1 && total > 0) {
                    // Count matches by type
                    const typeCounts = {};
                    this.matches.forEach(match => {
                        if (match.matchType !== null) {
                            const typeName = this.matchTypes[match.matchType];
                            typeCounts[typeName] = (typeCounts[typeName] || 0) + 1;
                        }
                    });

                    // Build type count string
                    const typeCountStrings = Object.entries(typeCounts)
                        .map(([name, count]) => `${name}: ${count}`)
                        .join(', ');

                    typeCountsElement.textContent = `(${typeCountStrings})`;
                    typeCountsElement.style.display = 'block';
                } else {
                    typeCountsElement.textContent = '';
                    typeCountsElement.style.display = 'none';
                }
            }

            prevBtn.disabled = total === 0;
            nextBtn.disabled = total === 0;
        }
    }

    updateButtonStates() {
        const searchInput = document.getElementById('regex-search-input');
        const searchBtn = document.getElementById('regex-search-btn');
        const clearBtn = document.getElementById('regex-clear-btn');

        if (searchInput && searchBtn) {
            // Disable search button if input is empty
            searchBtn.disabled = !searchInput.value.trim();
        }

        if (clearBtn) {
            // Disable clear button if there are no matches to clear
            clearBtn.disabled = this.matches.length === 0;
        }
    }

    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        const overlay = document.getElementById('regex-highlight-ui');
        const minimizeBtn = document.getElementById('regex-minimize-btn');

        if (overlay) {
            if (this.isMinimized) {
                // Store current position before minimizing (for when we expand)
                const rect = overlay.getBoundingClientRect();
                if (!overlay.dataset.expandedTop) {
                    overlay.dataset.expandedTop = rect.top;
                }
                if (!overlay.dataset.expandedLeft) {
                    overlay.dataset.expandedLeft = rect.left;
                }

                overlay.classList.add('minimized');
                minimizeBtn.textContent = '+';
                minimizeBtn.title = 'Expand';

                // Force to right corner (CSS will handle with !important)
                // Just ensure top is preserved
                overlay.style.top = rect.top + 'px';
            } else {
                overlay.classList.remove('minimized');
                minimizeBtn.textContent = '−';
                minimizeBtn.title = 'Minimize';

                // Restore previous position if available, otherwise use saved position
                const rect = overlay.getBoundingClientRect();
                const savedTop = overlay.dataset.expandedTop;
                const savedLeft = overlay.dataset.expandedLeft;

                if (savedTop !== undefined) {
                    overlay.style.top = savedTop + 'px';
                }

                // Load saved position or use default
                this.loadPosition(overlay);
            }
        }
    }

    toggleCollapsible() {
        this.collapsibleExpanded = !this.collapsibleExpanded;
        const content = document.getElementById('regex-collapsible-content');
        const toggle = document.getElementById('regex-collapsible-toggle');
        const icon = toggle ? toggle.querySelector('.regex-collapsible-icon') : null;

        if (content) {
            content.style.display = this.collapsibleExpanded ? 'block' : 'none';
        }

        if (icon) {
            icon.textContent = this.collapsibleExpanded ? '▼' : '▶';
        }

        // Save state
        this.saveSetting('collapsibleExpanded', this.collapsibleExpanded);
    }

    setupDragging(overlay) {
        const dragHandle = overlay.querySelector('.regex-drag-handle');
        if (!dragHandle) return;

        let rafId = null;

        const handleMove = (clientX, clientY) => {
            if (!this.isDragging) return;

            // Only use vertical movement (deltaY)
            const deltaY = clientY - this.dragStartY;

            // Get current dimensions (before transform)
            const height = overlay.offsetHeight || overlay.getBoundingClientRect().height;

            // Calculate desired vertical position
            let newTop = this.dragStartTop + deltaY;

            // Keep widget within viewport bounds vertically
            const maxTop = window.innerHeight - height;

            // Clamp to bounds
            if (newTop < 0) {
                newTop = 0;
            } else if (newTop > maxTop) {
                newTop = maxTop;
            }

            // Only apply vertical transform - horizontal stays fixed (right-anchored)
            const finalDeltaY = newTop - this.dragStartTop;
            overlay.style.transform = `translateY(${finalDeltaY}px)`;
        };

        const handleMoveRAF = (clientX, clientY) => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            rafId = requestAnimationFrame(() => {
                handleMove(clientX, clientY);
            });
        };

        dragHandle.addEventListener('mousedown', (e) => {
            // Don't drag if clicking the minimize button
            if (e.target.id === 'regex-minimize-btn' || e.target.closest('#regex-minimize-btn')) return;

            this.isDragging = true;
            this.dragStartY = e.clientY;

            const rect = overlay.getBoundingClientRect();
            this.dragStartTop = rect.top;

            // Store the right position to keep it fixed
            const computedStyle = window.getComputedStyle(overlay);
            this.dragStartRight = computedStyle.right !== 'auto' ?
                parseFloat(computedStyle.right) :
                (window.innerWidth - rect.right);

            overlay.style.cursor = 'grabbing';
            dragHandle.style.cursor = 'grabbing';
            overlay.style.transition = 'none'; // Disable transition during drag

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            handleMoveRAF(e.clientX, e.clientY);
            e.preventDefault();
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }

                // Apply final position - only vertical, keep right-anchored at 36px
                const rect = overlay.getBoundingClientRect();
                const finalTop = rect.top;

                // Reset transform and set final position
                overlay.style.transform = '';
                overlay.style.transition = ''; // Re-enable transition
                overlay.style.left = 'auto';
                overlay.style.top = finalTop + 'px';
                overlay.style.right = '36px'; // Always 36px (same spacing as minimized state)
                overlay.style.bottom = 'auto';

                this.isDragging = false;
                overlay.style.cursor = '';
                dragHandle.style.cursor = '';
                this.savePosition(overlay);
            }
        });

        // Touch events for mobile
        dragHandle.addEventListener('touchstart', (e) => {
            if (e.target.id === 'regex-minimize-btn' || e.target.closest('#regex-minimize-btn')) return;

            const touch = e.touches[0];
            this.isDragging = true;
            this.dragStartY = touch.clientY;

            const rect = overlay.getBoundingClientRect();
            this.dragStartTop = rect.top;

            // Store the right position to keep it fixed
            const computedStyle = window.getComputedStyle(overlay);
            this.dragStartRight = computedStyle.right !== 'auto' ?
                parseFloat(computedStyle.right) :
                (window.innerWidth - rect.right);

            overlay.style.transition = 'none';

            e.preventDefault();
        });

        document.addEventListener('touchmove', (e) => {
            if (!this.isDragging) return;

            const touch = e.touches[0];
            handleMoveRAF(touch.clientX, touch.clientY);

            e.preventDefault();
        });

        document.addEventListener('touchend', () => {
            if (this.isDragging) {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }

                // Apply final position - only vertical, keep right-anchored at 36px
                const rect = overlay.getBoundingClientRect();
                const finalTop = rect.top;

                overlay.style.transform = '';
                overlay.style.transition = '';
                overlay.style.left = 'auto';
                overlay.style.top = finalTop + 'px';
                overlay.style.right = '36px'; // Always 36px (same spacing as minimized state)
                overlay.style.bottom = 'auto';

                this.isDragging = false;
                this.savePosition(overlay);
            }
        });

        // Handle window resize to keep widget in bounds (vertical only)
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (!this.isDragging) {
                    const rect = overlay.getBoundingClientRect();
                    const height = rect.height;
                    const currentTop = rect.top;

                    const maxTop = window.innerHeight - height;

                    const newTop = Math.max(0, Math.min(currentTop, maxTop));

                    if (newTop !== currentTop) {
                        overlay.style.top = newTop + 'px';
                        this.savePosition(overlay);
                    }
                }
                // Update scrollbar markers on resize
                this.updateScrollbarMarkers();
            }, 100);
        });
    }

    setupRippleEffects() {
        // Function to create ripple effect on button click/touch
        const createRipple = (e, button) => {
            // Don't create ripple if button is disabled
            if (button.disabled) return;

            const rect = button.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);

            // Get coordinates from either mouse or touch event
            const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : e.changedTouches[0].clientX);
            const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : e.changedTouches[0].clientY);

            const x = clientX - rect.left - size / 2;
            const y = clientY - rect.top - size / 2;

            const ripple = document.createElement('span');
            ripple.classList.add('regex-ripple');
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;

            // Remove any existing ripples
            const existingRipples = button.querySelectorAll('.regex-ripple');
            existingRipples.forEach(r => r.remove());

            button.appendChild(ripple);

            // Remove ripple after animation completes
            ripple.addEventListener('animationend', () => {
                ripple.remove();
            });
        };

        // Apply ripple effect to all buttons in the UI
        const applyRippleToButton = (button) => {
            if (!button) return;
            // Remove existing listeners to avoid duplicates
            if (button._rippleClickHandler) {
                button.removeEventListener('click', button._rippleClickHandler);
            }
            if (button._rippleTouchHandler) {
                button.removeEventListener('touchstart', button._rippleTouchHandler);
            }
            // Create new handlers
            button._rippleClickHandler = (e) => createRipple(e, button);
            button._rippleTouchHandler = (e) => createRipple(e, button);
            button.addEventListener('click', button._rippleClickHandler);
            button.addEventListener('touchstart', button._rippleTouchHandler, { passive: true });
        };

        // Apply to all existing buttons
        const buttons = [
            document.getElementById('regex-minimize-btn'),
            document.getElementById('regex-search-btn'),
            document.getElementById('regex-clear-btn'),
            document.getElementById('regex-prev-btn'),
            document.getElementById('regex-next-btn'),
            document.getElementById('regex-collapsible-toggle')
        ];

        buttons.forEach(applyRippleToButton);

        // Apply to pattern chips (they're created dynamically)
        const patternHistoryContainer = document.getElementById('regex-pattern-history');
        if (patternHistoryContainer) {
            // Use MutationObserver to handle dynamically added pattern chips
            const patternObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Apply ripple to the pattern chip button
                            if (node.classList.contains('regex-pattern-chip')) {
                                applyRippleToButton(node);
                            }
                        }
                    });
                });
            });

            patternObserver.observe(patternHistoryContainer, {
                childList: true,
                subtree: true
            });

            // Also apply to existing pattern chips
            const existingChips = patternHistoryContainer.querySelectorAll('.regex-pattern-chip');
            existingChips.forEach(applyRippleToButton);

            // Store the applyRippleToButton function so it can be called from renderSavedPatterns
            this._applyRippleToButton = applyRippleToButton;
        }
    }

    savePosition(overlay) {
        const rect = overlay.getBoundingClientRect();

        // Always save 36px for right position (same spacing as minimized state)
        // Widget is only draggable vertically, so right position stays fixed
        const right = 36;
        const top = rect.top;

        // Ensure position is within bounds before saving
        const height = rect.height;
        const maxTop = window.innerHeight - height;
        const clampedTop = Math.max(0, Math.min(top, maxTop));

        const position = {
            right: right,
            top: clampedTop
        };
        try {
            localStorage.setItem('regex-highlight-position', JSON.stringify(position));
        } catch (e) {
            console.warn('Could not save position to localStorage', e);
        }
    }

    loadPosition(overlay) {
        try {
            const saved = localStorage.getItem('regex-highlight-position');

            // Always use 36px for right position (same spacing for both minimized and expanded states)
            // Only load saved top position for vertical placement
            let top = 10;
            if (saved) {
                try {
                    const position = JSON.parse(saved);
                    const rect = overlay.getBoundingClientRect();
                    const height = rect.height || 100;
                    const maxTop = window.innerHeight - height;
                    if (position.top !== undefined) {
                        top = Math.max(0, Math.min(position.top, maxTop));
                    }
                } catch (e) {
                    // Ignore parse errors, use default
                }
            }

            overlay.style.left = 'auto';
            overlay.style.right = '36px'; // Always 36px (same spacing as minimized state)
            overlay.style.top = top + 'px';
            overlay.style.bottom = 'auto';
        } catch (e) {
            // Ignore errors, use default position (right-anchored)
            overlay.style.left = 'auto';
            overlay.style.right = '36px';
            overlay.style.top = '10px';
            overlay.style.bottom = 'auto';
        }
    }

    setupScrollTracking() {
        // Remove any existing scroll listeners
        if (this.scrollHandler) {
            window.removeEventListener('scroll', this.scrollHandler, true);
        }

        if (this.matches.length === 0) return;

        // Throttled function to find first match in viewport
        this.scrollHandler = () => {
            // Skip if scrolling programmatically
            if (this.isScrollingProgrammatically) return;

            // Clear existing timeout
            if (this.scrollTimeout) {
                clearTimeout(this.scrollTimeout);
            }

            // Throttle updates to reduce erratic behavior
            this.scrollTimeout = setTimeout(() => {
                this.updateActiveMatchFromScroll();
            }, 100); // Wait 100ms after scrolling stops
        };

        // Use capture phase to catch all scroll events
        window.addEventListener('scroll', this.scrollHandler, true);

        // Also check on initial load
        setTimeout(() => this.updateActiveMatchFromScroll(), 200);
    }

    updateActiveMatchFromScroll() {
        if (this.matches.length === 0 || this.isScrollingProgrammatically) return;

        // getBoundingClientRect() returns positions relative to viewport
        const viewportTop = 0;
        const viewportBottom = window.innerHeight;

        // Find the first match that is visible in the viewport
        // Priority: matches that start at or above the top of viewport
        let firstVisibleIndex = -1;
        let firstVisibleTop = Infinity;

        // First pass: find matches that are at or above viewport top (within small buffer)
        this.matches.forEach((match, index) => {
            if (match.span) {
                const rect = match.span.getBoundingClientRect();
                const elementTop = rect.top;
                const elementBottom = rect.bottom;

                // Check if match is visible in viewport (at least partially)
                if (elementBottom > viewportTop && elementTop < viewportBottom) {
                    // If match starts at or just above viewport top, it's a candidate
                    // Use a 50px buffer to catch matches that just scrolled past
                    if (elementTop <= 50) {
                        if (elementTop < firstVisibleTop) {
                            firstVisibleTop = elementTop;
                            firstVisibleIndex = index;
                        }
                    }
                }
            }
        });

        // If no match found at/above viewport top, find the first match in viewport
        if (firstVisibleIndex === -1) {
            let minTopInViewport = Infinity;
            this.matches.forEach((match, index) => {
                if (match.span) {
                    const rect = match.span.getBoundingClientRect();
                    const elementTop = rect.top;
                    const elementBottom = rect.bottom;

                    // Match is visible in viewport
                    if (elementBottom > viewportTop && elementTop < viewportBottom) {
                        // Get the top position relative to viewport top (0)
                        const relativeTop = Math.max(0, elementTop);
                        if (relativeTop < minTopInViewport) {
                            minTopInViewport = relativeTop;
                            firstVisibleIndex = index;
                        }
                    }
                }
            });
        }

        // Update active match if found and different
        if (firstVisibleIndex >= 0 && firstVisibleIndex !== this.currentIndex) {
            // Remove active class from current match
            if (this.currentIndex >= 0 && this.currentIndex < this.matches.length) {
                const currentSpan = this.matches[this.currentIndex].span;
                if (currentSpan) {
                    currentSpan.classList.remove(this.activeClass);
                }
            }

            // Add active class to new match
            this.currentIndex = firstVisibleIndex;
            const newSpan = this.matches[this.currentIndex].span;
            if (newSpan) {
                newSpan.classList.add(this.activeClass);
            }

            this.updateNavigation();
            this.updateScrollbarMarkers();
        }
    }

    createScrollbarMarkers() {
        // Remove existing marker container if any
        const existing = document.getElementById('regex-scrollbar-markers');
        if (existing) {
            existing.remove();
        }

        // Create marker container
        const container = document.createElement('div');
        container.id = 'regex-scrollbar-markers';
        container.className = 'regex-scrollbar-markers';
        document.body.appendChild(container);

        this.scrollbarMarkerContainer = container;
    }

    updateScrollbarMarkers() {
        if (!this.scrollbarMarkerContainer || this.matches.length === 0) {
            this.clearScrollbarMarkers();
            return;
        }

        const container = this.scrollbarMarkerContainer;
        container.innerHTML = '';

        // Get page dimensions
        const documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        const viewportHeight = window.innerHeight;

        if (documentHeight <= viewportHeight) {
            // Page doesn't scroll, no markers needed
            return;
        }

        // Calculate scrollbar track height
        const scrollbarTrackHeight = viewportHeight - 20; // Account for padding
        const scrollRatio = scrollbarTrackHeight / documentHeight;

        // Create markers for each match
        this.matches.forEach((match, index) => {
            if (!match.span) return;

            const rect = match.span.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const elementTop = scrollTop + rect.top;

            // Calculate position as percentage of document height
            const positionPercent = (elementTop / documentHeight) * 100;

            // Position marker on scrollbar
            const markerTop = (positionPercent / 100) * scrollbarTrackHeight;

            // Create marker element
            const marker = document.createElement('div');
            let markerClass = 'regex-scrollbar-marker';

            // Add type-specific class if we have multiple types
            if (match.matchType !== null && this.matchTypes.length > 1) {
                markerClass += ` regex-scrollbar-marker-type-${match.matchType}`;
            }

            marker.className = markerClass;
            marker.dataset.matchIndex = index;

            if (index === this.currentIndex) {
                marker.classList.add('active');
            }

            marker.style.top = markerTop + 'px';

            // Get match context for preview
            const matchText = match.span ? match.span.textContent : '';
            const matchContext = this.getMatchContext(match, 50); // 50 chars before/after
            marker.title = `Match ${index + 1} of ${this.matches.length}\n${matchContext}`;

            // Click handler to jump to match
            marker.addEventListener('click', () => {
                this.currentIndex = index;
                this.scrollToMatch(index);
            });

            container.appendChild(marker);
        });
    }

    clearScrollbarMarkers() {
        if (this.scrollbarMarkerContainer) {
            this.scrollbarMarkerContainer.innerHTML = '';
        }
    }

    getMatchContext(match, contextLength = 50) {
        if (!match.span) return '';

        const matchText = match.span.textContent || '';
        if (!matchText) return '';

        // Get the parent element that contains the full text
        let parentElement = match.span.parentElement;
        if (!parentElement) return matchText;

        // Get all text content from parent, but we need to find the position
        // Since the span is already highlighted, we need to get text from siblings
        let fullText = '';
        let matchPosition = -1;

        // Walk through parent's children to reconstruct text and find match position
        let currentPos = 0;
        for (let child of parentElement.childNodes) {
            if (child === match.span) {
                matchPosition = currentPos;
                fullText += matchText;
                currentPos += matchText.length;
            } else if (child.nodeType === Node.TEXT_NODE) {
                fullText += child.textContent;
                currentPos += child.textContent.length;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const text = child.textContent || '';
                fullText += text;
                currentPos += text.length;
            }
        }

        // If we couldn't find the position, try simpler approach
        if (matchPosition === -1) {
            fullText = parentElement.textContent || '';
            matchPosition = fullText.indexOf(matchText);
        }

        if (matchPosition === -1) {
            return matchText;
        }

        const start = Math.max(0, matchPosition - contextLength);
        const end = Math.min(fullText.length, matchPosition + matchText.length + contextLength);

        let context = fullText.substring(start, end);

        // Add ellipsis if truncated
        if (start > 0) context = '...' + context;
        if (end < fullText.length) context = context + '...';

        // Highlight the match in the context (adjust position for ellipsis)
        const matchStartInContext = start > 0 ?
            (matchPosition - start + 3) : // Account for '...' prefix
            (matchPosition - start);
        const matchEndInContext = matchStartInContext + matchText.length;

        if (matchStartInContext >= 0 && matchEndInContext <= context.length) {
            context = context.substring(0, matchStartInContext) +
                '[' + matchText + ']' +
                context.substring(matchEndInContext);
        }

        return context;
    }

    loadSavedPatterns() {
        try {
            const saved = localStorage.getItem('regex-highlight-patterns');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    }

    removeLookaheadLookbehind(pattern) {
        // Remove lookahead (?=...) and (?!...) and lookbehind (?<=...) and (?<!...) assertions
        // This is a simplified parser that handles most cases
        let result = '';
        let i = 0;
        let inCharClass = false;
        let escapeNext = false;

        while (i < pattern.length) {
            const char = pattern[i];

            if (escapeNext) {
                result += char;
                escapeNext = false;
                i++;
                continue;
            }

            if (char === '\\') {
                result += char;
                escapeNext = true;
                i++;
                continue;
            }

            if (char === '[') {
                inCharClass = true;
                result += char;
                i++;
                continue;
            }

            if (char === ']' && inCharClass) {
                inCharClass = false;
                result += char;
                i++;
                continue;
            }

            // Check for lookahead/lookbehind assertions (only outside character classes)
            if (!inCharClass && char === '(' && i + 1 < pattern.length) {
                const nextChar = pattern[i + 1];

                // Check for lookahead: (?= or (?!
                if (nextChar === '?' && i + 2 < pattern.length) {
                    const afterQuestion = pattern[i + 2];
                    if (afterQuestion === '=' || afterQuestion === '!') {
                        // Found lookahead, skip to matching closing parenthesis
                        let depth = 1;
                        i += 3; // Skip past (?= or (?!
                        while (i < pattern.length && depth > 0) {
                            if (pattern[i] === '\\') {
                                i += 2; // Skip escaped character
                                continue;
                            }
                            if (pattern[i] === '(') depth++;
                            if (pattern[i] === ')') depth--;
                            i++;
                        }
                        continue; // Don't add the lookahead to result
                    }

                    // Check for lookbehind: (?<= or (?<!
                    if (afterQuestion === '<' && i + 3 < pattern.length) {
                        const afterLessThan = pattern[i + 3];
                        if (afterLessThan === '=' || afterLessThan === '!') {
                            // Found lookbehind, skip to matching closing parenthesis
                            let depth = 1;
                            i += 4; // Skip past (?<= or (?<!
                            while (i < pattern.length && depth > 0) {
                                if (pattern[i] === '\\') {
                                    i += 2; // Skip escaped character
                                    continue;
                                }
                                if (pattern[i] === '(') depth++;
                                if (pattern[i] === ')') depth--;
                                i++;
                            }
                            continue; // Don't add the lookbehind to result
                        }
                    }
                }
            }

            result += char;
            i++;
        }

        return result;
    }

    countMatchesForPattern(pattern) {
        // Count matches for a pattern without highlighting
        // Remove lookahead and lookbehind assertions before counting
        try {
            // Remove lookahead/lookbehind assertions
            const cleanedPattern = this.removeLookaheadLookbehind(pattern);

            // If pattern becomes empty after removing assertions, return 0
            if (!cleanedPattern.trim()) {
                return 0;
            }

            const flags = this.getRegexFlagsString();
            const regex = new RegExp(cleanedPattern, flags);
            let count = 0;

            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let node;
            while ((node = walker.nextNode())) {
                const text = node.textContent;
                if (!text) continue;

                // Reset regex lastIndex for each node
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    count++;
                    // Reset lastIndex to avoid infinite loop on zero-length matches
                    if (match[0].length === 0) {
                        regex.lastIndex++;
                    }
                }
            }

            return count;
        } catch (e) {
            // Invalid pattern, return 0
            return 0;
        }
    }

    sortPatternsByMatchCount() {
        // Sort saved patterns by match count (most matches first)
        if (this.savedPatterns.length === 0) return;

        // Preserve original order for tie-breaking
        const originalOrder = new Map();
        this.savedPatterns.forEach((pattern, index) => {
            originalOrder.set(pattern, index);
        });

        // Count matches for each pattern
        const patternsWithCounts = this.savedPatterns.map(pattern => ({
            pattern: pattern,
            count: this.countMatchesForPattern(pattern),
            originalIndex: originalOrder.get(pattern)
        }));

        // Sort by count (descending), then by original order for ties
        patternsWithCounts.sort((a, b) => {
            if (b.count !== a.count) {
                return b.count - a.count; // Higher count first
            }
            // If counts are equal, maintain original order (first saved stays first)
            return a.originalIndex - b.originalIndex;
        });

        // Update savedPatterns with sorted order
        this.savedPatterns = patternsWithCounts.map(item => item.pattern);

        // Save sorted order to localStorage
        try {
            localStorage.setItem('regex-highlight-patterns', JSON.stringify(this.savedPatterns));
        } catch (e) {
            console.warn('Could not save sorted patterns to localStorage', e);
        }

        // Re-render the pattern list (only if UI exists)
        if (document.getElementById('regex-pattern-history')) {
            this.renderSavedPatterns();
        }
    }

    loadSetting(key, defaultValue) {
        try {
            const saved = localStorage.getItem(`regex-highlight-setting-${key}`);
            return saved !== null ? JSON.parse(saved) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }

    saveSetting(key, value) {
        try {
            localStorage.setItem(`regex-highlight-setting-${key}`, JSON.stringify(value));
        } catch (e) {
            console.warn('Could not save setting to localStorage', e);
        }
    }

    savePattern(pattern) {
        // Remove pattern if it already exists
        this.savedPatterns = this.savedPatterns.filter(p => p !== pattern);
        // Add to front
        this.savedPatterns.unshift(pattern);
        // Limit to max saved patterns
        if (this.savedPatterns.length > this.maxSavedPatterns) {
            this.savedPatterns = this.savedPatterns.slice(0, this.maxSavedPatterns);
        }
        // Save to localStorage
        try {
            localStorage.setItem('regex-highlight-patterns', JSON.stringify(this.savedPatterns));
        } catch (e) {
            // localStorage may be unavailable (private browsing, etc.)
            console.warn('Could not save pattern to localStorage', e);
        }
    }

    deletePattern(index) {
        if (index >= 0 && index < this.savedPatterns.length) {
            // Remove the pattern at the specified index
            this.savedPatterns.splice(index, 1);
            // Save to localStorage
            try {
                localStorage.setItem('regex-highlight-patterns', JSON.stringify(this.savedPatterns));
            } catch (e) {
                console.warn('Could not save patterns to localStorage', e);
            }
            // Re-render the pattern list
            this.renderSavedPatterns();
        }
    }

    renderSavedPatterns() {
        const historyContainer = document.getElementById('regex-pattern-history');
        if (!historyContainer) return;

        if (this.savedPatterns.length === 0) {
            historyContainer.innerHTML = '';
            return;
        }

        // Count matches for each pattern to display in UI
        const patternsWithCounts = this.savedPatterns.map(pattern => ({
            pattern: pattern,
            count: this.countMatchesForPattern(pattern)
        }));

        historyContainer.innerHTML = patternsWithCounts.map((item, index) => {
            // Escape HTML for display and data attribute
            const escapeHtml = (str) => str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const escapedPattern = escapeHtml(item.pattern);
            const escapedDataPattern = escapeHtml(item.pattern);
            const countText = item.count > 0 ? ` (${item.count})` : '';
            return `<button class="regex-pattern-chip" data-pattern="${escapedDataPattern}" title="Click to use: ${item.pattern}${countText ? ' - ' + item.count + ' matches' : ''}">
                <span class="regex-pattern-text">${escapedPattern}${countText}</span>
                <span class="regex-pattern-delete" data-delete-index="${index}" title="Delete pattern">×</span>
            </button>`;
        }).join('');

        // Add click handlers
        historyContainer.querySelectorAll('.regex-pattern-chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Don't trigger if clicking the delete button
                if (e.target.classList.contains('regex-pattern-delete')) {
                    return;
                }

                // Get the original pattern from savedPatterns using the index
                const chipIndex = Array.from(historyContainer.children).indexOf(btn);
                const pattern = this.savedPatterns[chipIndex];
                const searchInput = document.getElementById('regex-search-input');
                if (searchInput && pattern) {
                    searchInput.value = pattern;
                    this.search(pattern);
                    this.updateButtonStates();
                }
            });
        });

        // Add delete button handlers
        historyContainer.querySelectorAll('.regex-pattern-delete').forEach(deleteBtn => {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering the chip click
                const index = parseInt(deleteBtn.dataset.deleteIndex);
                if (!isNaN(index) && index >= 0 && index < this.savedPatterns.length) {
                    this.deletePattern(index);
                }
            });
        });

        // Apply ripple effects to newly rendered pattern chips
        if (this._applyRippleToButton) {
            historyContainer.querySelectorAll('.regex-pattern-chip').forEach(chip => {
                this._applyRippleToButton(chip);
            });
        }
    }

    getDomain() {
        return window.location.hostname;
    }

    saveSearchState(pattern) {
        if (!pattern) return;
        const domain = this.getDomain();
        const state = {
            pattern: pattern,
            domain: domain,
            flags: this.regexFlags,
            timestamp: Date.now()
        };
        chrome.storage.local.set({ 'regex-search-state': state }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Could not save search state:', chrome.runtime.lastError);
            }
        });
    }

    clearSearchState() {
        chrome.storage.local.remove('regex-search-state', () => {
            if (chrome.runtime.lastError) {
                console.warn('Could not clear search state:', chrome.runtime.lastError);
            }
        });
    }

    async restoreSearchIfSameDomain() {
        try {
            const result = await chrome.storage.local.get('regex-search-state');
            if (result['regex-search-state']) {
                const state = result['regex-search-state'];
                const currentDomain = this.getDomain();

                // Check if we're on the same domain
                if (state.domain === currentDomain && state.pattern) {
                    // Restore regex flags if they exist
                    if (state.flags) {
                        this.regexFlags = { ...this.regexFlags, ...state.flags };
                    }

                    // Wait for DOM to be ready, then restore search
                    const restoreSearch = () => {
                        // Small delay to ensure page content is loaded
                        setTimeout(() => {
                            this.searchPattern = state.pattern;
                            // Update UI input if it exists
                            const searchInput = document.getElementById('regex-search-input');
                            if (searchInput) {
                                searchInput.value = state.pattern;
                            }
                            // Update regex flags in UI if checkboxes exist
                            if (state.flags) {
                                const flagGlobalCheckbox = document.getElementById('regex-flag-global');
                                const flagIgnoreCaseCheckbox = document.getElementById('regex-flag-ignorecase');
                                const flagMultilineCheckbox = document.getElementById('regex-flag-multiline');
                                const flagDotAllCheckbox = document.getElementById('regex-flag-dotall');
                                if (flagGlobalCheckbox) flagGlobalCheckbox.checked = state.flags.global !== false;
                                if (flagIgnoreCaseCheckbox) flagIgnoreCaseCheckbox.checked = state.flags.ignoreCase !== false;
                                if (flagMultilineCheckbox) flagMultilineCheckbox.checked = state.flags.multiline === true;
                                if (flagDotAllCheckbox) flagDotAllCheckbox.checked = state.flags.dotAll === true;
                            }
                            // Perform the search
                            this.clearHighlights();
                            this.findMatches();
                            this.highlightMatches();
                            this.currentIndex = this.matches.length > 0 ? 0 : -1;
                            if (this.currentIndex >= 0 && this.scrollOnSearch) {
                                this.scrollToMatch(this.currentIndex);
                            }
                            this.setupScrollTracking();
                            this.updateScrollbarMarkers();
                            this.updateNavigation();
                            this.updateButtonStates();
                        }, 200);
                    };

                    // Wait a bit for UI to be fully created
                    setTimeout(() => {
                        if (document.readyState === 'loading') {
                            document.addEventListener('DOMContentLoaded', restoreSearch);
                        } else {
                            restoreSearch();
                        }
                    }, 100);
                }
            }
        } catch (e) {
            console.warn('Could not restore search state:', e);
        }
    }

    setupNavigationListener() {
        // Handle SPA navigation (pushState/replaceState)
        let lastUrl = location.href;
        let lastPath = location.pathname + location.search;
        let navigationTimeout = null;

        const checkNavigation = () => {
            const currentUrl = location.href;
            const currentPath = location.pathname + location.search;
            const currentDomain = this.getDomain();

            // Check if URL changed (path, query, or hash)
            const urlChanged = currentUrl !== lastUrl;
            const pathChanged = currentPath !== lastPath;

            if (urlChanged) {
                lastUrl = currentUrl;
                lastPath = currentPath;

                // Clear any pending navigation check
                if (navigationTimeout) {
                    clearTimeout(navigationTimeout);
                }

                chrome.storage.local.get('regex-search-state', (result) => {
                    if (result['regex-search-state']) {
                        const state = result['regex-search-state'];

                        // If domain changed, clear search state
                        if (state.domain !== currentDomain) {
                            this.clearSearchState();
                            this.searchPattern = '';
                            this.clearHighlights();
                            this.clearScrollbarMarkers();
                            this.updateNavigation();
                            this.updateButtonStates();
                            return;
                        }

                        // If same domain and we have a saved pattern, restore/refresh search
                        // Always refresh if path/query changed (new page in SPA) or pattern doesn't match
                        if (state.domain === currentDomain && state.pattern) {
                            // Wait for new content to load (SPAs load content asynchronously)
                            navigationTimeout = setTimeout(() => {
                                this.searchPattern = state.pattern;

                                // Update UI input if it exists
                                const searchInput = document.getElementById('regex-search-input');
                                if (searchInput) {
                                    searchInput.value = state.pattern;
                                }

                                // Update regex flags in UI if checkboxes exist
                                if (state.flags) {
                                    const flagGlobalCheckbox = document.getElementById('regex-flag-global');
                                    const flagIgnoreCaseCheckbox = document.getElementById('regex-flag-ignorecase');
                                    const flagMultilineCheckbox = document.getElementById('regex-flag-multiline');
                                    const flagDotAllCheckbox = document.getElementById('regex-flag-dotall');
                                    if (flagGlobalCheckbox) flagGlobalCheckbox.checked = state.flags.global !== false;
                                    if (flagIgnoreCaseCheckbox) flagIgnoreCaseCheckbox.checked = state.flags.ignoreCase !== false;
                                    if (flagMultilineCheckbox) flagMultilineCheckbox.checked = state.flags.multiline === true;
                                    if (flagDotAllCheckbox) flagDotAllCheckbox.checked = state.flags.dotAll === true;

                                    // Update internal flags
                                    this.regexFlags = { ...this.regexFlags, ...state.flags };
                                }

                                // Clear existing highlights and re-search
                                this.clearHighlights();
                                this.findMatches();
                                this.highlightMatches();
                                this.currentIndex = this.matches.length > 0 ? 0 : -1;

                                // Scroll to first match if enabled
                                if (this.currentIndex >= 0 && this.scrollOnSearch) {
                                    this.scrollToMatch(this.currentIndex);
                                }

                                // Update UI
                                this.setupScrollTracking();
                                // Sort patterns by match count after navigation
                                this.sortPatternsByMatchCount();
                                this.updateScrollbarMarkers();
                                this.updateNavigation();
                                this.updateButtonStates();
                            }, 500); // Wait 500ms for SPA content to load
                        }
                    }
                });
            }
        };

        // Monitor DOM changes for SPAs that don't use pushState
        let domObserver = null;
        const setupDOMObserver = () => {
            if (domObserver) {
                domObserver.disconnect();
            }

            // Watch for significant DOM changes that might indicate new page content
            domObserver = new MutationObserver((mutations) => {
                let shouldCheck = false;
                for (const mutation of mutations) {
                    // Check for added nodes (new content)
                    if (mutation.addedNodes.length > 0) {
                        // Only trigger if significant content was added
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check if it's a substantial element (not just a script/style)
                                const tagName = node.tagName?.toLowerCase();
                                if (tagName && !['script', 'style', 'link', 'meta', 'noscript'].includes(tagName)) {
                                    shouldCheck = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (shouldCheck) break;
                }

                if (shouldCheck) {
                    // Debounce DOM change checks
                    if (navigationTimeout) {
                        clearTimeout(navigationTimeout);
                    }
                    navigationTimeout = setTimeout(checkNavigation, 300);
                }
            });

            // Observe the document body for changes
            if (document.body) {
                domObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
        };

        // Setup DOM observer when body is available
        if (document.body) {
            setupDOMObserver();
        } else {
            const bodyObserver = new MutationObserver(() => {
                if (document.body) {
                    setupDOMObserver();
                    bodyObserver.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
        }

        // Listen to popstate for browser back/forward
        window.addEventListener('popstate', () => {
            checkNavigation();
        });

        // Override pushState and replaceState for SPAs
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function () {
            originalPushState.apply(history, arguments);
            setTimeout(checkNavigation, 0);
        };

        history.replaceState = function () {
            originalReplaceState.apply(history, arguments);
            setTimeout(checkNavigation, 0);
        };

        // Also listen for hash changes
        window.addEventListener('hashchange', checkNavigation);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new RegexHighlighter();
    });
} else {
    new RegexHighlighter();
}
