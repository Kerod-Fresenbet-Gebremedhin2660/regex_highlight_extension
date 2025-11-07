# Performance Optimization Plan

This document outlines performance improvements for the Regex Highlight & Search extension, organized into actionable steps.

## Current Performance Issues

- UI blocking during searches with many matches
- Repeated DOM traversal for each search
- Synchronous pattern sorting on every search
- Heavy DOM manipulation for highlighting
- No caching of text nodes

## Optimization Steps

### Step 1: Use RequestIdleCallback for Non-Critical Operations ⭐ HIGH PRIORITY

**Goal:** Defer non-critical work to browser idle time

**Changes:**
- Wrap `sortPatternsByMatchCount()` in `requestIdleCallback` or `scheduler.postTask({priority: 'background'})`
- Only run pattern sorting when browser is idle
- This prevents blocking the UI during searches

**Implementation:**
```javascript
// In search() method, replace:
this.sortPatternsByMatchCount();

// With:
if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
        this.sortPatternsByMatchCount().catch(err => console.warn('Error sorting patterns:', err));
    }, { timeout: 2000 });
} else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
        this.sortPatternsByMatchCount().catch(err => console.warn('Error sorting patterns:', err));
    }, 100);
}
```

**Files to modify:**
- `content.js` - `search()` method
- `content.js` - `setupNavigationListener()` method

---

### Step 2: Cache Text Nodes Per Page ⭐⭐ HIGH PRIORITY

**Goal:** Avoid repeated DOM traversal by caching text nodes

**Changes:**
- Create a text node cache that's built once per page
- Use a lightweight MutationObserver to invalidate cache when DOM changes
- Reuse cached text nodes for subsequent searches
- Only rebuild cache when DOM structure changes

**Implementation:**
```javascript
// Add to constructor:
this.textNodeCache = null;
this.textNodeMapCache = null;
this.cacheInvalidationObserver = null;

// New method:
buildTextNodeCache() {
    const widgetOverlay = document.getElementById('regex-highlight-ui');
    const textNodes = [];
    const textNodeMap = new Map();
    
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    let node;
    while ((node = walker.nextNode())) {
        if (widgetOverlay && widgetOverlay.contains(node)) {
            continue;
        }
        const text = node.textContent;
        if (text && text.trim()) {
            const nodeIndex = textNodes.length;
            textNodes.push({ text: text });
            textNodeMap.set(nodeIndex, node);
        }
    }
    
    this.textNodeCache = textNodes;
    this.textNodeMapCache = textNodeMap;
    
    // Setup invalidation observer
    this.setupCacheInvalidationObserver();
}

setupCacheInvalidationObserver() {
    if (this.cacheInvalidationObserver) {
        this.cacheInvalidationObserver.disconnect();
    }
    
    this.cacheInvalidationObserver = new MutationObserver((mutations) => {
        // Invalidate cache on significant DOM changes
        let shouldInvalidate = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                // Check if it's a significant change (not just attribute changes)
                for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
                    if (node.nodeType === Node.TEXT_NODE || 
                        (node.nodeType === Node.ELEMENT_NODE && 
                         !['script', 'style', 'link', 'meta'].includes(node.tagName?.toLowerCase()))) {
                        shouldInvalidate = true;
                        break;
                    }
                }
            }
            if (shouldInvalidate) break;
        }
        
        if (shouldInvalidate) {
            this.textNodeCache = null;
            this.textNodeMapCache = null;
        }
    });
    
    this.cacheInvalidationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// Update findMatches() to use cache:
async findMatches() {
    // ... existing code ...
    
    // Use cache if available, otherwise build it
    if (!this.textNodeCache) {
        await this.collectTextNodesInBatches(widgetOverlay, textNodes, textNodeMap);
    } else {
        textNodes.push(...this.textNodeCache);
        // Rebuild map to ensure nodes are still valid
        this.textNodeCache.forEach((textNode, index) => {
            // Find corresponding node in DOM
            // This is a simplified version - may need refinement
        });
    }
}
```

**Files to modify:**
- `content.js` - Add cache properties to constructor
- `content.js` - Add `buildTextNodeCache()` method
- `content.js` - Add `setupCacheInvalidationObserver()` method
- `content.js` - Update `findMatches()` to use cache
- `content.js` - Update `countMatchesForPattern()` to use cache

---

### Step 3: Defer Pattern Sorting ⭐ MEDIUM PRIORITY

**Goal:** Don't sort patterns on every search - make it lazy/optional

**Changes:**
- Remove automatic sorting from `search()` method
- Only sort when user explicitly requests it or during idle time
- Add a manual "Sort by match count" button in UI (optional)

**Implementation:**
```javascript
// In search() method, remove:
this.sortPatternsByMatchCount();

// Optionally add a button in UI to manually trigger sorting
// Or use requestIdleCallback as in Step 1
```

**Files to modify:**
- `content.js` - `search()` method
- `content.js` - `setupNavigationListener()` method

---

### Step 4: Virtualize Highlights (Viewport-Only Highlighting) ⭐⭐⭐ HIGH PRIORITY

**Goal:** Only highlight matches visible in viewport + buffer

**Changes:**
- Store all match metadata (node, index, length) without DOM manipulation
- Use IntersectionObserver to detect when matches enter viewport
- Only create highlight spans for visible matches
- Remove highlights when they leave viewport
- Keep a small buffer (e.g., 2x viewport height) for smooth scrolling

**Implementation:**
```javascript
// Add properties:
this.matchMetadata = []; // Store all matches without DOM manipulation
this.visibleHighlights = new Set(); // Track which matches are currently highlighted
this.intersectionObserver = null;

// New method:
setupVirtualHighlighting() {
    if (!('IntersectionObserver' in window)) {
        // Fallback to full highlighting
        return false;
    }
    
    this.intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const matchIndex = parseInt(entry.target.dataset.matchIndex);
            if (entry.isIntersecting) {
                // Match entered viewport - ensure it's highlighted
                if (!this.visibleHighlights.has(matchIndex)) {
                    this.highlightSingleMatch(matchIndex);
                }
            } else {
                // Match left viewport - remove highlight if far enough away
                const rect = entry.boundingClientRect;
                const viewportHeight = window.innerHeight;
                const buffer = viewportHeight * 2; // 2x viewport buffer
                
                if (rect.bottom < -buffer || rect.top > viewportHeight + buffer) {
                    this.unhighlightSingleMatch(matchIndex);
                }
            }
        });
    }, {
        root: null,
        rootMargin: `${window.innerHeight * 2}px`, // 2x viewport buffer
        threshold: 0
    });
    
    return true;
}

highlightSingleMatch(matchIndex) {
    const match = this.matches[matchIndex];
    if (!match || !match.node || this.visibleHighlights.has(matchIndex)) {
        return;
    }
    
    // Check if node still exists and hasn't been highlighted yet
    if (match.node.parentNode && !match.span) {
        // Create highlight span for this single match
        // Similar to existing highlightMatches logic but for one match
        // ...
        this.visibleHighlights.add(matchIndex);
    }
}

unhighlightSingleMatch(matchIndex) {
    const match = this.matches[matchIndex];
    if (match && match.span) {
        // Remove highlight span
        // ...
        this.visibleHighlights.delete(matchIndex);
    }
}

// Update findMatches() to store metadata without highlighting:
async findMatches() {
    // ... existing code to find matches ...
    
    // Store match metadata
    this.matchMetadata = this.matches.map(m => ({
        node: m.node,
        index: m.index,
        length: m.length,
        matchType: m.matchType
    }));
    
    // Only highlight visible matches
    if (this.setupVirtualHighlighting()) {
        // Use virtual highlighting
        this.highlightVisibleMatches();
    } else {
        // Fallback to full highlighting
        await this.highlightMatches();
    }
}
```

**Files to modify:**
- `content.js` - Add virtual highlighting properties
- `content.js` - Add `setupVirtualHighlighting()` method
- `content.js` - Add `highlightSingleMatch()` method
- `content.js` - Add `unhighlightSingleMatch()` method
- `content.js` - Update `findMatches()` to use virtual highlighting

---

### Step 5: Use CSS Highlight API (Modern Browsers) ⭐⭐ MEDIUM PRIORITY

**Goal:** Use native browser highlighting API instead of DOM manipulation

**Changes:**
- Detect if `CSS.highlights` is available
- Use `Highlight` and `Range` objects instead of creating spans
- Fallback to span-based highlighting for older browsers

**Implementation:**
```javascript
// Check browser support:
supportsCSSHighlights() {
    return 'CSS' in window && 'highlights' in CSS && typeof CSS.highlights === 'function';
}

// New highlighting method using CSS Highlight API:
highlightMatchesWithCSSAPI() {
    if (!this.supportsCSSHighlights()) {
        return false;
    }
    
    const highlight = new Highlight();
    
    this.matches.forEach((match, index) => {
        if (!match.node || !match.node.parentNode) return;
        
        try {
            const range = new Range();
            const startOffset = match.index;
            const endOffset = match.index + match.length;
            
            // Set range to match location
            range.setStart(match.node, startOffset);
            range.setEnd(match.node, endOffset);
            
            highlight.add(range);
            
            // Store range reference
            match.range = range;
        } catch (e) {
            console.warn('Could not create range for match:', e);
        }
    });
    
    // Register highlight with a name
    CSS.highlights.set('regex-matches', highlight);
    
    // Add CSS rule for highlighting
    if (!document.getElementById('regex-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'regex-highlight-style';
        style.textContent = `
            ::highlight(regex-matches) {
                background-color: #ffeb3b;
            }
        `;
        document.head.appendChild(style);
    }
    
    return true;
}

// Update highlightMatches() to try CSS API first:
async highlightMatches() {
    // Try CSS Highlight API first
    if (this.highlightMatchesWithCSSAPI()) {
        return; // Successfully used CSS API
    }
    
    // Fallback to span-based highlighting
    // ... existing code ...
}
```

**Files to modify:**
- `content.js` - Add `supportsCSSHighlights()` method
- `content.js` - Add `highlightMatchesWithCSSAPI()` method
- `content.js` - Update `highlightMatches()` to try CSS API first
- `styles.css` - Add CSS Highlight API styles (if needed)

**Note:** CSS Highlight API is only available in Chromium-based browsers (Chrome 105+, Edge 105+). Safari and Firefox don't support it yet.

---

### Step 6: Throttle UI Updates ⭐ MEDIUM PRIORITY

**Goal:** Reduce frequency of UI updates during highlighting

**Changes:**
- Debounce navigation counter updates
- Batch scrollbar marker updates
- Update UI only once per animation frame

**Implementation:**
```javascript
// Add throttling properties:
this.updateNavigationThrottle = null;
this.updateMarkersThrottle = null;

// Throttled update methods:
throttledUpdateNavigation() {
    if (this.updateNavigationThrottle) {
        cancelAnimationFrame(this.updateNavigationThrottle);
    }
    
    this.updateNavigationThrottle = requestAnimationFrame(() => {
        this.updateNavigation();
        this.updateNavigationThrottle = null;
    });
}

throttledUpdateScrollbarMarkers() {
    if (this.updateMarkersThrottle) {
        cancelAnimationFrame(this.updateMarkersThrottle);
    }
    
    this.updateMarkersThrottle = requestAnimationFrame(() => {
        this.updateScrollbarMarkers();
        this.updateMarkersThrottle = null;
    });
}

// Update highlightMatches() to use throttled updates:
async highlightMatches() {
    // ... existing highlighting code ...
    
    // Use throttled updates instead of immediate
    this.throttledUpdateNavigation();
    this.throttledUpdateScrollbarMarkers();
}
```

**Files to modify:**
- `content.js` - Add throttling properties
- `content.js` - Add `throttledUpdateNavigation()` method
- `content.js` - Add `throttledUpdateScrollbarMarkers()` method
- `content.js` - Replace direct calls with throttled versions

---

### Step 7: Limit Initial Results ⭐ LOW PRIORITY

**Goal:** Show partial results for extremely large match sets

**Changes:**
- Add a limit to initial results (e.g., first 500 matches)
- Show "Showing X of Y matches" message
- Allow user to load more matches on demand

**Implementation:**
```javascript
// Add property:
this.maxInitialMatches = 500;

// Update findMatches():
async findMatches() {
    // ... existing code ...
    
    // Limit initial matches
    if (this.matches.length > this.maxInitialMatches) {
        const totalMatches = this.matches.length;
        this.matches = this.matches.slice(0, this.maxInitialMatches);
        
        // Show message to user
        this.showMatchLimitMessage(totalMatches);
    }
}

showMatchLimitMessage(totalMatches) {
    // Display message in UI about limited results
    // Add "Load more" button
}
```

**Files to modify:**
- `content.js` - Add `maxInitialMatches` property
- `content.js` - Update `findMatches()` to limit results
- `content.js` - Add `showMatchLimitMessage()` method
- `content.js` - Add UI for "Load more" functionality

---

## Execution Order Recommendation

1. **Step 1** (RequestIdleCallback) - Quick win, low risk
2. **Step 2** (Cache Text Nodes) - High impact, medium complexity
3. **Step 4** (Virtualize Highlights) - High impact, high complexity
4. **Step 6** (Throttle UI Updates) - Medium impact, low complexity
5. **Step 5** (CSS Highlight API) - Medium impact, low complexity (but limited browser support)
6. **Step 3** (Defer Pattern Sorting) - Low impact, low complexity
7. **Step 7** (Limit Initial Results) - Low impact, medium complexity

## Testing Checklist

After each step, test:
- [ ] Search with pattern that has 10+ matches
- [ ] Search with pattern that has 100+ matches
- [ ] Search with pattern that has 1000+ matches
- [ ] UI remains responsive during search
- [ ] Widget remains interactive during search
- [ ] Navigation (prev/next) works correctly
- [ ] Scrollbar markers update correctly
- [ ] Pattern history displays correctly
- [ ] No memory leaks (check DevTools Memory profiler)
- [ ] Performance metrics improve (check DevTools Performance panel)

## Performance Metrics to Track

- Time to first match highlight
- Total time for search completion
- Frame rate during search (should stay above 30fps)
- Main thread blocking time (should be < 50ms per task)
- Memory usage (should not continuously grow)

## Notes

- Profile with Chrome DevTools Performance panel to identify actual bottlenecks
- Use Chrome DevTools Memory profiler to check for memory leaks
- Test on pages with varying sizes (small, medium, large)
- Consider user feedback on perceived performance vs actual metrics

