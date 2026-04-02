# Advanced Message-Risk Scoring Formula (0-100)

This project now uses a weighted additive formula with hard-risk floors and contextual safety attenuation.

## 1) Raw Score

Let:

- `C_cred` = credential keyword component (password/otp/2fa/login/seed phrase)
- `C_transfer` = explicit transfer instruction component (`send/share/give` + `otp/code/password`)
- `C_code` = generic code-request component (`confirm/verify/provide` + `code`)
- `C_imp` = authority/impersonation component (`support/security team/admin`)
- `C_press` = urgency/pressure component (`urgent/hurry/frozen/immediately`)
- `C_fin` = crypto/financial context component (`wallet/binance/crypto/usdt`)
- `C_link` = link/domain risk component (shorteners, risky TLD, URL count)
- `C_switch` = platform-switch component (Telegram/WhatsApp/Signal + redirection intent)
- `C_bot` = repetition/burst automation component
- `B_conv` = conversation-level combo boost
- `S_context` = contextual safety shield (negation/reporting context)

Raw score:

`R_raw = 6 + C_cred + C_transfer + C_code + C_imp + C_press + C_fin + C_link + C_switch + C_bot + B_conv - S_context`

Then clamp:

`R = clamp(round(R_raw), 0, 100)`

## 2) Component Definitions

- `C_cred = min(35, credentialHits * 10)`
- `C_transfer = min(30, credentialTransferHits * 12)`
- `C_code = min(18, genericCodeRequestHits * 8)`
- `C_imp = min(18, impersonationHits * 6)`
- `C_press = min(18, pressureHits * 6)`
- `C_fin = min(16, cryptoContextHits * 4)`
- `C_link = min(16, links * 4) + min(20, suspiciousLinks * 10) + min(16, riskyTldHits * 8)`
- `C_switch = (platformSwitchHits > 0 && redirectionIntentHits > 0 ? 12 : 0) + min(8, platformSwitchHits * 2)`
- `C_bot = (repetitionRatio >= 0.45 ? 14 : 0)`
- `B_conv = min(16, conversationRiskSignalCount * 4)`
- `S_context = clamp((safetyNegationHits > 0 ? min(18, safetyNegationHits * 10) : 0) + (reportingContextHits > 0 && credentialTransferHits == 0 && suspiciousLinks == 0 ? min(12, reportingContextHits * 6) : 0), 0, 24)`

## 3) Hard-Risk Floors

After calculating `R`, apply:

- If `OTP + crypto context` is present and `R < 60`, set `R = 60`.
- If explicit credential transfer appears with impersonation/pressure/crypto context and `R < 70`, set `R = 70`.
- If links exist with credential request and `R < 70`, set `R = 70`.

## 4) Class Mapping

- `R >= 70` -> `high-risk`
- `40 <= R < 70` -> `suspicious`
- `R < 40` -> `likely-human`

## 5) Design Notes

- The model is intentionally conservative on credential-transfer instructions.
- Safety/reporting language reduces false positives but cannot fully cancel high-risk coercive signals.
- Conversation-level co-occurrence boosts are nonlinear to detect escalation patterns.
