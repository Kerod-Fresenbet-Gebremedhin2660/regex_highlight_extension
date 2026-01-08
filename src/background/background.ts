// Background service worker for Regex Highlight extension
// Handles context menu creation and messaging

const CONTEXT_MENU_ID = 'regex-highlight-add-alternation';

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'Add "%s" to regex search',
        contexts: ['selection']
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
        return;
    }

    const selectedText = info.selectionText?.trim();
    if (!selectedText) {
        return;
    }

    // Send message to content script to add the selected text as alternation
    // Try sending to the specific frame first, then fall back to main frame
    const frameId = info.frameId ?? 0;

    chrome.tabs.sendMessage(tab.id, {
        action: 'addAlternation',
        text: selectedText
    }, { frameId: 0 }).catch((error) => {
        // If main frame fails, try the frame where selection was made
        if (frameId !== 0) {
            chrome.tabs.sendMessage(tab.id!, {
                action: 'addAlternation',
                text: selectedText
            }, { frameId }).catch(() => {
                // Silent fail - content script may not be loaded
            });
        }
        console.warn('Could not send message to content script:', error);
    });
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateContextMenuTitle') {
        // Update context menu title based on current pattern
        const hasPattern = message.hasPattern;
        chrome.contextMenus.update(CONTEXT_MENU_ID, {
            title: hasPattern
                ? 'Add "%s" to current regex'
                : 'Search for "%s"'
        });
        sendResponse({ success: true });
    }
    return false;
});

export { };

