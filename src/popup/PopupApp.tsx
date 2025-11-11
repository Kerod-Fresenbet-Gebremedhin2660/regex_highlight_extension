import { useCallback, useEffect, useMemo, useState } from 'react';

type WidgetStateResponse = {
    success: boolean;
    isHidden: boolean;
};

type MessageResponse = {
    success: boolean;
};

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs[0]);
        });
    });
}

async function sendTabMessage<T>(
    tabId: number,
    message: Record<string, unknown>
): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                reject(runtimeError);
                return;
            }
            resolve(response as T | undefined);
        });
    });
}

const PopupApp = () => {
    const [isLoading, setIsLoading] = useState(true);
    const [isHidden, setIsHidden] = useState<boolean | null>(null);
    const [statusText, setStatusText] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const statusClass = useMemo(() => {
        if (isHidden === null) {
            return 'status';
        }
        return `status ${isHidden ? 'hidden' : 'visible'}`;
    }, [isHidden]);

    const refreshState = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                setIsHidden(null);
                setStatusText('No active tab found');
                setIsLoading(false);
                return;
            }

            const response = await sendTabMessage<WidgetStateResponse>(tab.id, {
                action: 'getWidgetState'
            });

            if (response?.success && typeof response.isHidden === 'boolean') {
                setIsHidden(response.isHidden);
                setStatusText(response.isHidden ? 'Widget is hidden' : 'Widget is visible');
            } else {
                setIsHidden(null);
                setStatusText('Widget not available on this page');
            }
        } catch (err) {
            console.error('Failed to get widget state', err);
            setError('Widget not available on this page');
            setIsHidden(null);
            setStatusText('');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refreshState();
    }, [refreshState]);

    const handleToggle = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                setError('No active tab found');
                return;
            }

            const currentState = await sendTabMessage<WidgetStateResponse>(tab.id, {
                action: 'getWidgetState'
            });

            if (!currentState?.success || typeof currentState.isHidden !== 'boolean') {
                setError('Widget is not available on this page');
                return;
            }

            const nextAction = currentState.isHidden ? 'showWidget' : 'hideWidget';
            const result = await sendTabMessage<MessageResponse>(tab.id, {
                action: nextAction
            });

            if (!result?.success) {
                setError('Unable to toggle widget');
                return;
            }

            // Give the content script a moment to update before refreshing
            setTimeout(() => {
                void refreshState();
            }, 150);
        } catch (err) {
            console.error('Failed to toggle widget', err);
            setError('Unable to communicate with the widget');
        } finally {
            setIsLoading(false);
        }
    }, [refreshState]);

    const renderStatus = () => {
        if (error) {
            return (
                <div className="status error" role="alert">
                    {error}
                </div>
            );
        }

        if (statusText) {
            return (
                <div className={statusClass}>
                    {statusText}
                </div>
            );
        }

        return (
            <div className="status neutral">
                Widget status unknown
            </div>
        );
    };

    return (
        <div className="popup-root">
            <h3>🔍 Regex Highlight &amp; Search</h3>
            <p>
                The search UI appears on each page. Use it to:
            </p>
            <ul>
                <li>Enter regex patterns</li>
                <li>Highlight all matches</li>
                <li>Navigate with Previous/Next</li>
            </ul>
            <button
                className="toggle-button"
                onClick={handleToggle}
                disabled={isLoading || isHidden === null}
                type="button"
            >
                {isHidden ? 'Show Widget' : 'Hide Widget'}
            </button>
            {renderStatus()}
            <div className="shortcut">
                <strong>Keyboard Shortcuts:</strong>
                <div className="shortcut-item">
                    Ctrl/Cmd + Shift + F: Toggle widget (minimize if open, expand &amp; focus if minimized)
                </div>
                <div className="shortcut-item">F3: Next match</div>
                <div className="shortcut-item">Shift + F3: Previous match</div>
            </div>
        </div>
    );
};

export default PopupApp;

