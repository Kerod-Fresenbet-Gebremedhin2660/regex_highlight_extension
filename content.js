// Regex Highlight & Search Extension
class RegexHighlighter {
    constructor() {
        this.matches = [];
        this.currentIndex = -1;
        this.searchPattern = '';
        this.highlightClass = 'regex-highlight-match';
        this.activeClass = 'regex-highlight-active';
        this.isMinimized = false;
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
        overlay.innerHTML = `
      <button id="regex-minimize-btn" class="regex-minimize-btn">−</button>
      <div class="regex-search-container">
        <input type="text" id="regex-search-input" placeholder="Enter regex pattern (e.g., (dog|cat))" />
        <button id="regex-search-btn">Search</button>
        <button id="regex-clear-btn">Clear</button>
        <div class="regex-navigation">
          <button id="regex-prev-btn" disabled>◀ Previous</button>
          <span id="regex-match-counter">0 / 0</span>
          <button id="regex-next-btn" disabled>Next ▶</button>
        </div>
      </div>
    `;
        document.body.appendChild(overlay);

        // Event listeners
        const minimizeBtn = document.getElementById('regex-minimize-btn');
        const searchInput = document.getElementById('regex-search-input');
        const searchBtn = document.getElementById('regex-search-btn');
        const clearBtn = document.getElementById('regex-clear-btn');
        const prevBtn = document.getElementById('regex-prev-btn');
        const nextBtn = document.getElementById('regex-next-btn');

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

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    searchInput.focus();
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
            this.clearHighlights();
            this.findMatches();
            this.highlightMatches();
            this.currentIndex = this.matches.length > 0 ? 0 : -1;
            this.updateNavigation();
            if (this.currentIndex >= 0) {
                this.scrollToMatch(this.currentIndex);
            }
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

        this.matches = [];
        this.currentIndex = -1;
    }

    clear() {
        this.clearHighlights();
        this.updateNavigation();
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
    }

    scrollToMatch(index) {
        if (index < 0 || index >= this.matches.length) return;
        const match = this.matches[index];
        const span = match.span || document.querySelector(
            `.${this.highlightClass}[data-match-index="${index}"]`
        );

        if (span) {
            match.span = span;
            span.classList.add(this.activeClass);
            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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
                overlay.classList.add('minimized');
                minimizeBtn.textContent = '+';
                minimizeBtn.title = 'Expand';
            } else {
                overlay.classList.remove('minimized');
                minimizeBtn.textContent = '−';
                minimizeBtn.title = 'Minimize';
            }
        }
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
