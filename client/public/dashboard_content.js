// This content script acts as a bridge between the web page and the extension's background script.
console.log('[Instagram Authentication] Dashboard content script loaded and listening.');

function syncSessionToBackground() {
    const userInfo = sessionStorage.getItem('user');
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');

    if (!userInfo || userInfo === 'undefined' || !token) {
        chrome.runtime.sendMessage({ type: 'USER_LOGGED_OUT' }, () => {});
        return;
    }

    try {
        const user = JSON.parse(userInfo);
        if (user && user.id) {
            chrome.runtime.sendMessage({ type: 'USER_LOGGED_IN', user: user, token: token || null }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Instagram Authentication] Content Script: Session sync failed:', chrome.runtime.lastError.message);
                }
            });
        }
    } catch (e) {
        console.error('[Instagram Authentication] Content Script: Session sync parse error.', e);
    }
}

syncSessionToBackground();

// Listen for messages from the web page (e.g., after a successful login).
window.addEventListener('message', (event) => {
    // We only accept messages from ourselves
    if (event.source !== window) {
        return;
    }

    if (event.data.type && (event.data.type === 'INSTAGRAM_AUTHENTICATION_USER_LOGGED_IN')) {
        console.log('[Instagram Authentication] Content Script: Received login signal from web page.');
        
        // Refresh extension session state from current page storage.
        const userInfo = sessionStorage.getItem('user');
        
        // IMPORTANT: Check for null, undefined, AND the literal string "undefined".
        const token = sessionStorage.getItem('token') || localStorage.getItem('token');
        if (userInfo && userInfo !== 'undefined' && token) {
            try {
                const user = JSON.parse(userInfo);
                if (user && user.id) {
                    console.log('[Instagram Authentication] Content Script: Forwarding user data to background script.', user);
                    chrome.runtime.sendMessage({ type: 'USER_LOGGED_IN', user: user, token }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('[Instagram Authentication] Content Script: Error sending message to background:', chrome.runtime.lastError.message);
                        } else if (response && response.success) {
                            console.log('[Instagram Authentication] Content Script: Background script acknowledged receipt of user data.');
                        } else {
                            console.warn('[Instagram Authentication] Content Script: Background script did not acknowledge receipt.', response);
                        }
                    });
                } else {
                    console.error('[Instagram Authentication] Content Script: User info found in sessionStorage, but it is invalid.', user);
                }
            } catch (e) {
                console.error('[Instagram Authentication] Content Script: Could not parse user info from sessionStorage.', e);
            }
        } else {
            console.error('[Instagram Authentication] Content Script: Login signal received, but user/token data is missing.');
        }
    }

    if (event.data.type && (event.data.type === 'INSTAGRAM_AUTHENTICATION_USER_LOGGED_OUT')) {
        chrome.runtime.sendMessage({ type: 'USER_LOGGED_OUT' }, () => {
            if (chrome.runtime.lastError) {
                console.error('[Instagram Authentication] Content Script: Logout sync failed:', chrome.runtime.lastError.message);
            }
        });
    }
}, false);

