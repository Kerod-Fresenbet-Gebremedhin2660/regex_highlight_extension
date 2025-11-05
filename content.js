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
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartLeft = 0;
        this.dragStartTop = 0;
        this.scrollbarMarkerContainer = null;
        this.scrollOnSearch = this.loadSetting('scrollOnSearch', false);
        this.init();
    }

    init() {
        // Create UI overlay
        this.createUI();
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
        <input type="text" id="regex-search-input" placeholder="Enter regex pattern (e.g., (dog|cat))" />
        <button id="regex-search-btn">Search</button>
        <button id="regex-clear-btn">Clear</button>
        <div class="regex-settings">
          <label class="regex-setting-toggle">
            <input type="checkbox" id="regex-scroll-on-search" ${this.scrollOnSearch ? 'checked' : ''}>
            <span>Scroll to first match on search</span>
          </label>
        </div>
        <div id="regex-pattern-history" class="regex-pattern-history"></div>
        <div class="regex-navigation">
          <button id="regex-prev-btn" disabled>◀ Previous</button>
          <span id="regex-match-counter">0 / 0</span>
          <button id="regex-next-btn" disabled>Next ▶</button>
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

        // Setting toggle handler
        if (scrollOnSearchCheckbox) {
            scrollOnSearchCheckbox.addEventListener('change', (e) => {
                this.scrollOnSearch = e.target.checked;
                this.saveSetting('scrollOnSearch', this.scrollOnSearch);
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

        clearBtn.addEventListener('click', () => {
            this.clear();
            searchInput.value = '';
        });

        prevBtn.addEventListener('click', () => this.previous());
        nextBtn.addEventListener('click', () => this.next());

        // Render saved patterns
        this.renderSavedPatterns();

        // Create scrollbar markers
        this.createScrollbarMarkers();

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

    search(pattern) {
        try {
            // Test if pattern is valid regex
            new RegExp(pattern);
            this.searchPattern = pattern;
            this.savePattern(pattern);
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
            // Update pattern history display
            this.renderSavedPatterns();
            // Update scrollbar markers
            this.updateScrollbarMarkers();
        } catch (error) {
            alert(`Invalid regex pattern: ${error.message}`);
        }
    }

    findMatches() {
        this.matches = [];
        const regex = new RegExp(this.searchPattern, 'gi');
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent;
            let match;
            while ((match = regex.exec(text)) !== null) {
                this.matches.push({
                    node: node,
                    index: match.index,
                    length: match[0].length
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
                span.className = this.highlightClass;
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
        this.clearScrollbarMarkers();
    }

    clear() {
        this.clearHighlights();
        this.updateNavigation();
        this.clearScrollbarMarkers();
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

        if (prevBtn && nextBtn && counter) {
            const total = this.matches.length;
            const current = total > 0 ? this.currentIndex + 1 : 0;
            counter.textContent = `${current} / ${total}`;
            prevBtn.disabled = total === 0;
            nextBtn.disabled = total === 0;
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

    setupDragging(overlay) {
        const dragHandle = overlay.querySelector('.regex-drag-handle');
        if (!dragHandle) return;

        let rafId = null;

        const handleMove = (clientX, clientY) => {
            if (!this.isDragging) return;

            const deltaX = clientX - this.dragStartX;
            const deltaY = clientY - this.dragStartY;

            // Get current dimensions (before transform)
            const width = overlay.offsetWidth || overlay.getBoundingClientRect().width;
            const height = overlay.offsetHeight || overlay.getBoundingClientRect().height;

            // Calculate desired position
            let newLeft = this.dragStartLeft + deltaX;
            let newTop = this.dragStartTop + deltaY;

            // Keep widget within viewport bounds
            const maxLeft = window.innerWidth - width;
            const maxTop = window.innerHeight - height;

            // Clamp to bounds and adjust delta if needed
            if (newLeft < 0) {
                newLeft = 0;
            } else if (newLeft > maxLeft) {
                newLeft = maxLeft;
            }

            if (newTop < 0) {
                newTop = 0;
            } else if (newTop > maxTop) {
                newTop = maxTop;
            }

            // Use transform for better performance during drag
            const finalDeltaX = newLeft - this.dragStartLeft;
            const finalDeltaY = newTop - this.dragStartTop;
            overlay.style.transform = `translate(${finalDeltaX}px, ${finalDeltaY}px)`;
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
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;

            const rect = overlay.getBoundingClientRect();
            this.dragStartLeft = rect.left;
            this.dragStartTop = rect.top;

            // Store initial position if not already set
            if (!overlay.dataset.initialLeft) {
                overlay.dataset.initialLeft = this.dragStartLeft;
                overlay.dataset.initialTop = this.dragStartTop;
            }

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

                // Apply final position
                const rect = overlay.getBoundingClientRect();
                const finalLeft = rect.left;
                const finalTop = rect.top;

                // Reset transform and set final position
                overlay.style.transform = '';
                overlay.style.transition = ''; // Re-enable transition
                overlay.style.left = finalLeft + 'px';
                overlay.style.top = finalTop + 'px';
                overlay.style.right = 'auto';
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
            this.dragStartX = touch.clientX;
            this.dragStartY = touch.clientY;

            const rect = overlay.getBoundingClientRect();
            this.dragStartLeft = rect.left;
            this.dragStartTop = rect.top;

            if (!overlay.dataset.initialLeft) {
                overlay.dataset.initialLeft = this.dragStartLeft;
                overlay.dataset.initialTop = this.dragStartTop;
            }

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

                const rect = overlay.getBoundingClientRect();
                const finalLeft = rect.left;
                const finalTop = rect.top;

                overlay.style.transform = '';
                overlay.style.transition = '';
                overlay.style.left = finalLeft + 'px';
                overlay.style.top = finalTop + 'px';
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';

                this.isDragging = false;
                this.savePosition(overlay);
            }
        });

        // Handle window resize to keep widget in bounds
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (!this.isDragging) {
                    const rect = overlay.getBoundingClientRect();
                    const width = rect.width;
                    const height = rect.height;
                    const currentLeft = rect.left;
                    const currentTop = rect.top;

                    const maxLeft = window.innerWidth - width;
                    const maxTop = window.innerHeight - height;

                    const newLeft = Math.max(0, Math.min(currentLeft, maxLeft));
                    const newTop = Math.max(0, Math.min(currentTop, maxTop));

                    if (newLeft !== currentLeft || newTop !== currentTop) {
                        overlay.style.left = newLeft + 'px';
                        overlay.style.top = newTop + 'px';
                        this.savePosition(overlay);
                    }
                }
                // Update scrollbar markers on resize
                this.updateScrollbarMarkers();
            }, 100);
        });
    }

    savePosition(overlay) {
        const rect = overlay.getBoundingClientRect();
        // Ensure position is within bounds before saving
        const width = rect.width;
        const height = rect.height;
        const maxLeft = window.innerWidth - width;
        const maxTop = window.innerHeight - height;

        const clampedLeft = Math.max(0, Math.min(rect.left, maxLeft));
        const clampedTop = Math.max(0, Math.min(rect.top, maxTop));

        const position = {
            left: clampedLeft,
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
            if (saved) {
                const position = JSON.parse(saved);
                // Ensure loaded position is within viewport
                const rect = overlay.getBoundingClientRect();
                const width = rect.width || 220; // fallback to min-width
                const height = rect.height || 100; // fallback estimate

                const maxLeft = window.innerWidth - width;
                const maxTop = window.innerHeight - height;

                const clampedLeft = Math.max(0, Math.min(position.left, maxLeft));
                const clampedTop = Math.max(0, Math.min(position.top, maxTop));

                overlay.style.left = clampedLeft + 'px';
                overlay.style.top = clampedTop + 'px';
                overlay.style.right = 'auto';
                overlay.style.bottom = 'auto';
            }
        } catch (e) {
            // Ignore errors, use default position
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
            marker.className = 'regex-scrollbar-marker';
            marker.dataset.matchIndex = index;

            if (index === this.currentIndex) {
                marker.classList.add('active');
            }

            marker.style.top = markerTop + 'px';
            marker.title = `Match ${index + 1} of ${this.matches.length}`;

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

    loadSavedPatterns() {
        try {
            const saved = localStorage.getItem('regex-highlight-patterns');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
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

    renderSavedPatterns() {
        const historyContainer = document.getElementById('regex-pattern-history');
        if (!historyContainer) return;

        if (this.savedPatterns.length === 0) {
            historyContainer.innerHTML = '';
            return;
        }

        historyContainer.innerHTML = this.savedPatterns.map((pattern, index) => {
            // Escape HTML for display and data attribute
            const escapeHtml = (str) => str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const escapedPattern = escapeHtml(pattern);
            const escapedDataPattern = escapeHtml(pattern);
            return `<button class="regex-pattern-chip" data-pattern="${escapedDataPattern}" title="Click to use: ${pattern}">${escapedPattern}</button>`;
        }).join('');

        // Add click handlers
        historyContainer.querySelectorAll('.regex-pattern-chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Get the original pattern from savedPatterns using the index
                const chipIndex = Array.from(historyContainer.children).indexOf(e.target);
                const pattern = this.savedPatterns[chipIndex];
                const searchInput = document.getElementById('regex-search-input');
                if (searchInput && pattern) {
                    searchInput.value = pattern;
                    this.search(pattern);
                }
            });
        });
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
