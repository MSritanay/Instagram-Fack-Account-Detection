
importScripts('logger.js');

// background.js
logger.info("Instagram Authentication: Background script loaded.");

let profileRiskData = {};
let messageRiskData = {};
let port = null;
const PENDING_ANALYSES_KEY = 'pendingBackgroundAnalyses';

function getPendingAnalyses(callback) {
    chrome.storage.local.get([PENDING_ANALYSES_KEY], (result) => {
        callback(result[PENDING_ANALYSES_KEY] || {});
    });
}

function setPendingAnalyses(pending, callback) {
    chrome.storage.local.set({ [PENDING_ANALYSES_KEY]: pending }, () => {
        if (typeof callback === 'function') callback();
    });
}

function removePendingAnalysis(tabId, callback) {
    getPendingAnalyses((pending) => {
        if (pending[String(tabId)]) {
            delete pending[String(tabId)];
            setPendingAnalyses(pending, callback);
        } else if (typeof callback === 'function') {
            callback();
        }
    });
}

function cleanupAnalysisTab(tabId, callback) {
    removePendingAnalysis(tabId, () => {
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                console.warn(`[Instagram Authentication] Could not close analysis tab ${tabId}:`, chrome.runtime.lastError.message);
            }
            if (typeof callback === 'function') callback();
        });
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;

    getPendingAnalyses((pending) => {
        const task = pending[String(tabId)];
        if (!task) return;

        console.log(`[Instagram Authentication] Analysis tab ${tabId} loaded. Sending ANALYZE_PAGE.`);
        chrome.tabs.sendMessage(tabId, { type: 'ANALYZE_PAGE', userId: task.userId }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`[Instagram Authentication] Error receiving response from background tab ${tabId}:`, chrome.runtime.lastError.message);
                cleanupAnalysisTab(tabId);
                return;
            }

            console.log(`[Instagram Authentication] Received analysis data from background tab ${tabId}.`);
            chrome.tabs.sendMessage(task.requesterTabId, { type: 'BACKGROUND_ANALYSIS_COMPLETE', data: response }, () => {
                if (chrome.runtime.lastError) {
                    console.warn(`[Instagram Authentication] Could not forward background analysis to tab ${task.requesterTabId}:`, chrome.runtime.lastError.message);
                }
                cleanupAnalysisTab(tabId);
            });
        });
    });
});

chrome.runtime.onConnect.addListener(function(portFrom) {
    console.log('[Instagram Authentication] Background: Received connection from a content script.');
    if (portFrom.name === "user-session") {
        portFrom.onMessage.addListener(function(message) {
            console.log('[Instagram Authentication] Background: Received message on user-session port:', message);
            if (message.userId && message.username) {
                const user = {
                    id: message.userId,
                    username: message.username,
                    fullName: message.fullName || message.username
                };
                chrome.storage.local.set({ user: user }, () => {
                    console.log('[Instagram Authentication] Background: User session data received and saved to chrome.storage.local:', user);
                });
            } else {
                console.log('[Instagram Authentication] Background: Message is missing userId or username.');
            }
        });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case "USER_LOGGED_IN":
            if (request.user && request.user.id) {
                const user = {
                    id: request.user.id,
                    username: request.user.username,
                    fullName: request.user.full_name || request.user.username
                };
                const sessionPayload = {
                    user: user,
                    // Always write token explicitly to avoid stale token reuse across users.
                    token: (typeof request.token === 'string' && request.token.trim()) ? request.token : null,
                };
                chrome.storage.local.set(sessionPayload, () => {
                    console.log('[Instagram Authentication] Background: USER_LOGGED_IN message received and session data saved.', {
                        user,
                        hasToken: !!sessionPayload.token,
                    });
                    sendResponse({ success: true });
                });
            } else {
                console.error('[Instagram Authentication] Background: USER_LOGGED_IN message received, but user data is invalid.', request.user);
                sendResponse({ success: false, error: "Invalid user data" });
            }
            return true; // Keep the message channel open for the asynchronous response
        
        case "USER_LOGGED_OUT":
            chrome.storage.local.remove(['user', 'token'], () => {
                console.log('[Instagram Authentication] Background: USER_LOGGED_OUT received. Session cleared.');
                sendResponse({ success: true });
            });
            return true;

        case 'ANALYZE_PAGE':
        case 'ANALYZE_MESSAGES':
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                const activeTab = tabs[0];
                if (activeTab && activeTab.id) {
                    chrome.tabs.sendMessage(activeTab.id, request, (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn(`Could not send message to tab ${activeTab.id}: ${chrome.runtime.lastError.message}`);
                            sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            sendResponse(response);
                        }
                    });
                } else {
                    sendResponse({ success: false, error: 'Could not access the current tab.' });
                }
            });
            return true; // Asynchronous response

        case 'INITIATE_BACKGROUND_TAB_ANALYSIS':
            handleBackgroundAnalysis(request, sender, sendResponse);
            return true; // Asynchronous response

        case 'FORWARD_ANALYSIS_TO_POPUP':
            // Forward message to the popup
            chrome.runtime.sendMessage(request);
            sendResponse({ success: true });
            return true;

        case 'FETCH_PROFILE_DATA':
            fetch(request.url)
                .then(response => response.text())
                .then(html => {
                    // This is a simplified parser. A real implementation would be more robust.
                    const match = html.match(/<script type="application\/json".*?>({.*?})<\/script>/);
                    if (match && match[1]) {
                        try {
                            const jsonData = JSON.parse(match[1]);
                            // Navigate through the complex object to find the user profile data.
                            const userProfile = jsonData.entry_data.ProfilePage[0].graphql.user;
                            if (userProfile) {
                                sendResponse({ success: true, data: userProfile });
                            } else {
                                sendResponse({ success: false, error: "Could not find user profile data in JSON." });
                            }
                        } catch (e) {
                            sendResponse({ success: false, error: `JSON parsing failed: ${e.message}` });
                        }
                    } else {
                        sendResponse({ success: false, error: "Could not find profile data script tag in HTML." });
                    }
                })
                .catch(error => {
                    sendResponse({ success: false, error: `Fetch failed: ${error.message}` });
                });
            return true; // Indicates that the response is sent asynchronously.


        default:
            // Handle unknown message types if necessary
            console.warn(`[Instagram Authentication] Background: Received unknown message type: ${request.type}`);
            sendResponse({ success: false, error: "Unknown message type" });
            break;
    }
    return true;
});

function handleBackgroundAnalysis(request, sender, sendResponse) {
    const { username, userId } = request;
    const profileUrl = `https://www.instagram.com/${username}/`;
    const requesterTabId = sender.tab ? sender.tab.id : null;

    if (!requesterTabId) {
        console.error("[Instagram Authentication] Could not get requester tab ID for background analysis.");
        sendResponse({ success: false, error: "Missing sender tab ID." });
        return;
    }

    console.log(`[Instagram Authentication] Starting background analysis for ${username}. Requester tab: ${requesterTabId}`);

    // Create a new, inactive tab to perform the analysis.
    // We persist the task so it can survive MV3 worker idling between events.
    chrome.tabs.create({ url: profileUrl, active: false }, (newTab) => {
        if (!newTab || !newTab.id) {
            sendResponse({ success: false, error: 'Could not create hidden analysis tab.' });
            return;
        }

        console.log(`[Instagram Authentication] Created background tab ${newTab.id} for analysis.`);
        getPendingAnalyses((pending) => {
            pending[String(newTab.id)] = {
                requesterTabId,
                userId,
                username,
                createdAt: Date.now()
            };
            setPendingAnalyses(pending, () => {
                console.log(`[Instagram Authentication] Registered pending analysis task for tab ${newTab.id}.`);
            });
        });
    });

    // Acknowledge that the process has started
    sendResponse({ success: true, message: "Background analysis initiated." });
}

function sendAnalysisToServer(analysisData, targetUsername, userId) {
    fetch('http://localhost:3000/api/analysis/profile', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            analysisData,
            targetUsername,
            userId,
        }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.sessionId) {
            console.log('[Instagram Authentication] Successfully sent analysis to server. Session ID:', data.sessionId);
        } else {
            console.error('[Instagram Authentication] Failed to send analysis to server:', data.error);
        }
    })
    .catch(error => {
        console.error('[Instagram Authentication] Error sending analysis to server:', error);
    });
}


function calculateWeightedRisk(profileRisk, messageRisk) {
    // Final_Risk = (0.6 * Profile_Risk) + (0.4 * Message_Risk)
    const weightedRisk = (0.6 * profileRisk) + (0.4 * messageRisk);
    return Math.min(Math.round(weightedRisk), 100);
}

function getAccountType(risk) {
    if (risk <= 20) return "Human";
    if (risk <= 40) return "Channel / Influencer";
    if (risk <= 60) return "Bot";
    if (risk <= 80) return "Scam";
    return "Hacker / High Threat";
}

function calculateTotalRisk(username) {
    const profileRisk = profileRiskData[username] ? profileRiskData[username].risk : 0;
    // Assuming a general message risk for now
    const messageRisk = messageRiskData['general'] ? messageRiskData['general'].risk : 0;
    const totalRisk = calculateWeightedRisk(profileRisk, messageRisk);
    const accountType = getAccountType(totalRisk);

    logger.info(`Total Risk for ${username}: ${totalRisk}% (${accountType})`);

    // Here you would store the total risk or update the UI.
    // For example, you could send a message to the popup or dashboard.
    chrome.storage.local.set({
        [`risk_${username}`]: {
            totalRisk: totalRisk,
            accountType: accountType,
            profileRisk: profileRisk,
            messageRisk: messageRisk,
            timestamp: Date.now()
        }
    });
}

