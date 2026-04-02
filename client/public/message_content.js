
(function() {
    console.log("Instagram Authentication: Message content script loaded.");

    const scamKeywords = ["free money", "guaranteed profit", "claim your prize", "winner", "lottery", "crypto", "investment", "urgent action required"];
    let analyzedMessages = new Set();

    function getHeuristicLevelFromRisk(risk) {
        if (risk > 50) return "High Risk";
        if (risk > 20) return "Medium Risk";
        return "Low Risk";
    }

    function getProfileUsername() {
        // This selector is specific to Instagram's DM page structure.
        // It looks for the username in the header of the chat dialog.
        const headerElement = document.querySelector('div[role="dialog"] a[role="link"]');
        if (headerElement && headerElement.href) {
            const username = headerElement.href.split('/').filter(Boolean).pop();
            console.log(`Instagram Authentication: Found profile username: ${username}`);
            return username;
        }
        console.log("Instagram Authentication: Could not find profile username.");
        return "unknown_user";
    }


    function calculateMessageRisk(messageText) {
        let messageRisk = 0;
        const riskFactors = [];

        if (scamKeywords.some(keyword => messageText.toLowerCase().includes(keyword))) {
            messageRisk += 15;
            riskFactors.push("Contains scam keywords (+15%)");
        }

        if (/(http|https):\/\/[^\s]+/.test(messageText)) {
            messageRisk += 20;
            riskFactors.push("Contains external links (+20%)");
        }

        messageRisk = Math.min(messageRisk, 100);
        return { messageRisk, riskFactors };
    }

    async function analyzeMessages(userId) {
        const messages = document.querySelectorAll('div[role="dialog"] div[dir="auto"]');
        const profile_username = getProfileUsername();

        if (!userId) {
            console.error("Instagram Authentication: userId is missing, cannot send analysis to server.");
            return;
        }

        for (const message of messages) {
            const messageText = message.innerText;
            if (!analyzedMessages.has(messageText)) {
                analyzedMessages.add(messageText);

                const { messageRisk, riskFactors } = calculateMessageRisk(messageText);

                if (messageRisk > 0) {
                    console.log(`Instagram Authentication: Message Risk Detected: ${messageRisk}%`, riskFactors);
                    
                    const heuristic_level = getHeuristicLevelFromRisk(messageRisk);

                    // Send analysis to the server
                    try {
                        const response = await fetch('http://localhost:3001/api/message-analyses', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userId: userId,
                                profile_username: profile_username,
                                risk_factors: riskFactors,
                                heuristic_level: heuristic_level,
                            }),
                        });
                        if (response.ok) {
                            console.log('[Instagram Authentication] Message analysis sent to server successfully.');
                        } else {
                            console.error('[Instagram Authentication] Failed to send message analysis to server.');
                        }
                    } catch (error) {
                        console.error('[Instagram Authentication] Error sending message analysis to server:', error);
                    }


                    // Visually mark the message
                    message.style.border = "2px solid red";
                    const riskDiv = document.createElement('div');
                    riskDiv.innerText = `âš ï¸ Risk: ${messageRisk}% (${riskFactors.join(", ")}) - Heuristic Level: ${heuristic_level}`;
                    riskDiv.style.color = "red";
                    riskDiv.style.fontSize = "10px";
                    message.appendChild(riskDiv);
                }
            }
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'ANALYZE_CHAT') {
            console.log("Instagram Authentication: Received ANALYZE_CHAT request.");
            analyzeMessages(request.userId); // Pass userId to the function
            sendResponse({ status: "acknowledged" });
            return true; // For async response
        }
    });

})();
