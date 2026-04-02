# Message Class Scoring Formula (bot/spam/scam/phishing/hacker/mixed)

After computing `riskScore` (0-100), the engine computes per-class scores:

- `S_phishing = clamp(24*phishingLinkCount + 8*credentialKeywordCount + 8*impersonationKeywordCount + 10*brandTyposquatCount + 8*suspiciousDomainCount + 6*riskyTldCount + 5*obfuscatedLinkSignals + 4*suspiciousPathHits)`
- `S_hacker = clamp(22*credentialTransferCount + 10*genericCodeRequestCount + 7*credentialKeywordCount + 7*impersonationKeywordCount + 6*financialPressureCount + 10*otpCryptoCombo + 8*(riskScore>=65))`
- `S_scam = clamp(9*scamKeywordCount + 10*financialPressureCount + 6*cryptoContextCount + 10*otpCryptoCombo + 15*scamCount + 6*broadcastHits + 10*(platformSwitch && redirectionIntent) + 0.25*riskScore)`
- `S_spam = clamp(40*repetitionRatio + 8*consecutiveRepeatCount + 8*broadcastHits + 1.2*suspiciousKeywordCount + 6*(totalMessages>=25))`
- `S_bot = clamp(45*repetitionRatio + 10*consecutiveRepeatCount + 40*rapidFireRatio + 6*maxBurst2Min + 20*shortMessageRatio + 8*(incomingRatio>0.85))`

## Mixed-risk arbitration

Let `top = max(S_i)`, `second = second_max(S_i)`, `margin = top - second`, `highClassCount = count(S_i >= 45)`.

`mixed-risk` is emitted when:

- `highClassCount >= 2` and `margin <= 8`, or
- `highClassCount >= 3`

with `top >= 45`.

Otherwise:

- if `top >= 40`, emit the top class (`phishing-risk`, `hacker-risk`, `scam`, `spam`, `bot`)
- else emit `likely-human` (or `suspicious-message` if global risk remains elevated).
