// Popup script for Regex Highlight & Search extension

document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-widget-btn');
    const statusDiv = document.getElementById('widget-status');

    // Get current widget state
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getWidgetState' }, (response) => {
                if (chrome.runtime.lastError) {
                    // Content script might not be loaded yet
                    updateUI(false, 'Widget not available on this page');
                    return;
                }

                if (response && response.success) {
                    updateUI(response.isHidden, response.isHidden ? 'Open Widget' : '');
                }
            });
        }
    });

    // Toggle widget button handler
    toggleBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                // First get current state
                chrome.tabs.sendMessage(tabs[0].id, { action: 'getWidgetState' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Error:', chrome.runtime.lastError);
                        return;
                    }

                    if (response && response.success) {
                        const action = response.isHidden ? 'showWidget' : 'hideWidget';
                        chrome.tabs.sendMessage(tabs[0].id, { action: action }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error('Error:', chrome.runtime.lastError);
                                return;
                            }

                            if (response && response.success) {
                                // Update UI after a short delay to allow widget to update
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(tabs[0].id, { action: 'getWidgetState' }, (response) => {
                                        if (response && response.success) {
                                            updateUI(response.isHidden, response.isHidden ? 'Widget is hidden' : 'Widget is visible');
                                        }
                                    });
                                }, 100);
                            }
                        });
                    }
                });
            }
        });
    });

    function updateUI(isHidden, statusText) {
        if (isHidden) {
            toggleBtn.textContent = 'Show Widget';
            statusDiv.textContent = statusText;
            statusDiv.className = 'status hidden';
            statusDiv.style.display = 'block';
        } else {
            toggleBtn.textContent = 'Hide Widget';
            statusDiv.textContent = statusText;
            statusDiv.className = 'status visible';
            statusDiv.style.display = 'block';
        }
    }
});

