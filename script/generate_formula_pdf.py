import datetime
from pathlib import Path

from generate_project_pdfs import SimplePdfWriter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "generated_documents"
OUT_DIR.mkdir(exist_ok=True)

OUTPUT_BASE = "Asset_Defender_Profile_Message_Formulas"


def build_formula_text() -> str:
    today = datetime.date.today().isoformat()
    return f"""ASSET DEFENDER - PROFILE + MESSAGE FORMULAS
Generated on: {today}

PROFILE FORMULAS (SET 1 - 10 CORE SIGNALS)

1) Follower-Following Ratio (FFR)
Formula:
FFR = Followers / Following
Interpretation:
- FFR < 0.1 -> Highly suspicious
- 0.1 to 0.5 -> Possible spam
- 0.5 to 2 -> Normal user
- >5 -> Influencer/brand pattern

2) Engagement Rate (ER)
Formula:
ER = (Likes + Comments) / Followers * 100
Typical ranges:
- Normal user: 3% to 10%
- Influencer: 2% to 6%
- Fake influencer: <1%
- Brand: 1% to 3%

3) Post Activity Score (PAS)
Formula:
PAS = Total Posts / Account Age (months)
Interpretation:
- 0 -> Empty account
- 0.1 to 1 -> Inactive
- 1 to 10 -> Normal
- >20 -> Spam/Bot tendency

4) Profile Completeness Score (PCS)
Formula:
PCS = (Bio + ProfilePicture + Posts + Highlights + ExternalLink) / 5
Binary feature coding:
- Present = 1
- Absent = 0
Interpretation:
- 0 to 0.2 -> Fake/empty
- 0.2 to 0.5 -> Suspicious
- 0.5 to 0.8 -> Normal
- >=0.8 -> Strong profile

5) Username Similarity Score (Impersonation)
Formula:
Similarity = 1 - (EditDistance / MaxLength)
Method:
- Use Levenshtein distance
Rule:
- Similarity > 0.7 -> Possible impersonation

6) Scam Keyword Score (SCS)
Formula:
SCS = ScamKeywords / TotalWords
Common keywords:
earn, profit, guaranteed, investment, crypto, forex, income, DM

7) External Link Risk Score (ELS)
Formula:
ELS = RiskyLinks / TotalLinks
Risky domains examples:
bit.ly, tinyurl, telegram, wa.me, t.me

8) Comment Authenticity Score (CAS)
Formula:
CAS = UniqueComments / TotalComments
Low CAS indicates copied/bot-style engagement.

9) Content Consistency Score (CCS)
Formula:
CCS = SimilarTopicPosts / TotalPosts
Large sudden topic shifts can indicate compromise/hijack.

10) Overall Risk Score (Set 1)
Formula:
RiskScore =
  (0.20 * FFR_score) +
  (0.20 * Engagement_score) +
  (0.15 * PCS_risk) +
  (0.15 * Username_similarity_risk) +
  (0.15 * Scam_keyword_score) +
  (0.15 * External_link_score)
Interpretation:
- 0.0 to 0.3 -> Legit
- 0.3 to 0.6 -> Suspicious
- 0.6 to 1.0 -> High risk

------------------------------------------------------------
PROFILE FORMULAS (SET 2 - 30 SIGNALS, 6 LAYERS)

LAYER 1 - Profile Identity Signals
1. Username Similarity:
   Similarity = 1 - (EditDistance / MaxLength)
2. Username Complexity Score:
   UCS = (numbers + special_characters) / username_length
3. Profile Completeness:
   PCS = (bio + profile_photo + posts + highlights + link) / 5
4. Bio Keyword Risk:
   BKR = scam_keywords / total_words
5. External Link Risk:
   ELR = risky_links / total_links

LAYER 2 - Network Signals
6. Follower-Following Ratio:
   FFR = followers / following
7. Follower Growth Spike:
   GrowthRate = followers_today - followers_yesterday
8. Mutual Follower Density:
   MFD = mutual_followers / total_followers
9. Bot Follower Ratio:
   BFR = suspected_bot_followers / total_followers
10. Follower Quality Score:
   FQS = real_followers / total_followers

LAYER 3 - Content Signals
11. Post Frequency:
    PF = posts / account_age_months
12. Content Consistency:
    CC = dominant_topic_posts / total_posts
13. Caption Scam Score:
    CSS = scam_keywords / caption_words
14. Hashtag Spam Score:
    HSS = hashtags / caption_words
15. Duplicate Content Score:
    DCS = repeated_posts / total_posts

LAYER 4 - Engagement Signals
16. Engagement Rate:
    ER = (likes + comments) / followers * 100
17. Comment Authenticity:
    CAS = unique_comments / total_comments
18. Like Velocity:
    LV = likes / first_hour
19. Comment Spam Ratio:
    CSR = spam_comments / total_comments
20. Engagement Consistency:
    EC = stddev(likes_per_post)

LAYER 5 - Behavioral Signals
21. Follow Rate:
    FR = follows_per_day
22. Unfollow Rate:
    UR = unfollows_per_day
23. DM Spam Score:
    DSS = scam_messages / total_messages
24. Activity Time Pattern:
    ATP = activity_hours_variance
25. Posting Automation Score:
    PAS = posts_same_interval / total_posts

LAYER 6 - Risk Context Signals
26. Account Age:
    AA = current_date - creation_date
27. Username Change Frequency:
    UCF = username_changes / months
28. Bio Change Frequency:
    BCF = bio_changes / months
29. Report Frequency:
    RF = reports / followers
30. External Platform Redirection:
    EPR = external_redirect_links / posts

Final Risk Score (Set 2):
RiskScore =
  0.15 * ProfileSignals +
  0.20 * NetworkSignals +
  0.20 * ContentSignals +
  0.20 * EngagementSignals +
  0.15 * BehavioralSignals +
  0.10 * ContextSignals

Risk Classification:
- 0.0 to 0.3 -> Legitimate
- 0.3 to 0.5 -> Low risk
- 0.5 to 0.7 -> Suspicious
- 0.7 to 1.0 -> High risk

------------------------------------------------------------
MESSAGE FORMULAS (CURRENT PROJECT)

MESSAGE RISK SCORE (0-100)

Raw formula:
R_raw = 6 + C_cred + C_transfer + C_code + C_imp + C_press + C_fin + C_link + C_switch + C_bot + B_conv - S_context
R = clamp(round(R_raw), 0, 100)

Components:
- C_cred = min(35, credentialHits * 10)
- C_transfer = min(30, credentialTransferHits * 12)
- C_code = min(18, genericCodeRequestHits * 8)
- C_imp = min(18, impersonationHits * 6)
- C_press = min(18, pressureHits * 6)
- C_fin = min(16, cryptoContextHits * 4)
- C_link = min(16, links * 4) + min(20, suspiciousLinks * 10) + min(16, riskyTldHits * 8)
- C_switch = (platformSwitchHits > 0 and redirectionIntentHits > 0 ? 12 : 0) + min(8, platformSwitchHits * 2)
- C_bot = (repetitionRatio >= 0.45 ? 14 : 0)
- B_conv = min(16, conversationRiskSignalCount * 4)
- S_context = clamp(
    (safetyNegationHits > 0 ? min(18, safetyNegationHits * 10) : 0) +
    (reportingContextHits > 0 and credentialTransferHits == 0 and suspiciousLinks == 0 ? min(12, reportingContextHits * 6) : 0),
    0,
    24
  )

Hard-risk floors:
- OTP + crypto context present and R < 60 => R = 60
- explicit credential transfer + impersonation/pressure/crypto and R < 70 => R = 70
- links + credential request and R < 70 => R = 70

Class mapping from message risk score:
- R >= 70 -> high-risk
- 40 <= R < 70 -> suspicious
- R < 40 -> likely-human

MESSAGE CLASS SCORES (bot/spam/scam/phishing/hacker/mixed)

Per-class formulas:
- S_phishing = clamp(24*phishingLinkCount + 8*credentialKeywordCount + 8*impersonationKeywordCount + 10*brandTyposquatCount + 8*suspiciousDomainCount + 6*riskyTldCount + 5*obfuscatedLinkSignals + 4*suspiciousPathHits)
- S_hacker = clamp(22*credentialTransferCount + 10*genericCodeRequestCount + 7*credentialKeywordCount + 7*impersonationKeywordCount + 6*financialPressureCount + 10*otpCryptoCombo + 8*(riskScore>=65))
- S_scam = clamp(9*scamKeywordCount + 10*financialPressureCount + 6*cryptoContextCount + 10*otpCryptoCombo + 15*scamCount + 6*broadcastHits + 10*(platformSwitch and redirectionIntent) + 0.25*riskScore)
- S_spam = clamp(40*repetitionRatio + 8*consecutiveRepeatCount + 8*broadcastHits + 1.2*suspiciousKeywordCount + 6*(totalMessages>=25))
- S_bot = clamp(45*repetitionRatio + 10*consecutiveRepeatCount + 40*rapidFireRatio + 6*maxBurst2Min + 20*shortMessageRatio + 8*(incomingRatio>0.85))

Mixed-risk arbitration:
Let:
- top = max(S_i)
- second = second_max(S_i)
- margin = top - second
- highClassCount = count(S_i >= 45)

Emit mixed-risk when:
- highClassCount >= 2 and margin <= 8, or
- highClassCount >= 3
with top >= 45.

Otherwise:
- if top >= 40, emit top class (phishing-risk/hacker-risk/scam/spam/bot)
- else emit likely-human (or suspicious-message if global risk remains elevated)
"""


def main() -> None:
    content = build_formula_text()
    txt_path = OUT_DIR / f"{OUTPUT_BASE}.txt"
    pdf_path = OUT_DIR / f"{OUTPUT_BASE}.pdf"
    txt_path.write_text(content, encoding="utf-8")
    SimplePdfWriter("Asset Defender Profile and Message Formulas").write_text_pdf(content, pdf_path)
    print(f"Generated: {txt_path}")
    print(f"Generated: {pdf_path}")


if __name__ == "__main__":
    main()
