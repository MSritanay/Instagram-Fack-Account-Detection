# Profile Pattern Coverage Report

Catalog: `script\profile-risk-pattern-catalog.json`
Generated: 2026-03-09T19:12:33.405Z

## Summary

- Total patterns: 100
- Covered: 66
- Partial: 8
- Missing: 26

## Category Breakdown

| Category | Total | Covered | Partial | Missing |
|---|---:|---:|---:|---:|
| Identity & Verification Patterns | 10 | 9 | 0 | 1 |
| Follower Network Patterns | 10 | 10 | 0 | 0 |
| Posting Behavior Patterns | 10 | 7 | 1 | 2 |
| Caption & Language Patterns | 10 | 6 | 0 | 4 |
| Link & Funnel Patterns | 10 | 7 | 0 | 3 |
| Engagement Manipulation Patterns | 10 | 7 | 0 | 3 |
| Content Style Patterns | 10 | 1 | 7 | 2 |
| Giveaway & Promotion Patterns | 10 | 3 | 0 | 7 |
| Account Lifecycle Patterns | 10 | 8 | 0 | 2 |
| High-Risk Domain Patterns | 10 | 8 | 0 | 2 |

## Missing/Partial Patterns

- [9] Profile picture inconsistent with account theme | status=missing | tags=none
- [23] Content copied from other creators | status=missing | tags=none
- [26] Only reels posted | status=missing | tags=none
- [28] Identical thumbnails across posts | status=partial | tags=posting_behavior, media_style
- [33] Limited slots available | status=missing | tags=none
- [34] Send message for investment opportunity | status=missing | tags=none
- [36] Giveaway announcements with unrealistic rewards | status=missing | tags=none
- [40] Promotional hashtags unrelated to content | status=missing | tags=none
- [46] External payment requests | status=missing | tags=none
- [48] Unknown investment websites | status=missing | tags=none
- [49] Google form signup for investment | status=missing | tags=none
- [52] Comment sections filled with DM sent | status=missing | tags=none
- [53] Giveaway bots commenting repeatedly | status=missing | tags=none
- [54] Comment farming prompts like type YES | status=missing | tags=none
- [61] Clickbait thumbnails | status=partial | tags=media_style
- [62] Shock reaction faces | status=missing | tags=none
- [63] Fake luxury lifestyle imagery | status=partial | tags=media_style
- [64] Screenshots of supposed trading profits | status=partial | tags=caption_semantics, media_style
- [65] Screenshots of fake bank balances | status=partial | tags=media_style
- [66] AI-generated influencer photos | status=partial | tags=media_style
- [67] Stock photos pretending to be personal life | status=partial | tags=media_style
- [69] Screenshots of Telegram chats | status=partial | tags=link_funnel, media_style
- [70] Fake testimonials | status=missing | tags=none
- [73] Fake brand giveaways | status=missing | tags=none
- [74] Asking users to tag many friends | status=missing | tags=none
- [75] Asking users to send wallet addresses | status=missing | tags=none
- [76] Giveaway requiring payment fee | status=missing | tags=none
- [77] Fake influencer collaboration giveaways | status=missing | tags=none
- [78] Winner will be announced tomorrow repeatedly | status=missing | tags=none
- [80] Giveaway bots replying automatically | status=missing | tags=none
- [86] Old content unrelated to current niche | status=missing | tags=none
- [89] Sudden shift from memes to investment | status=missing | tags=none
- [95] Dropshipping get rich quick schemes | status=missing | tags=none
- [97] Adult spam accounts | status=missing | tags=none

## Notes

- This report checks feature-coverage mapping at the pattern level.
- `covered` means at least one implemented signal family maps to the pattern and no mapped tags are missing.
- `partial` means mixed mapped tags (some covered, some missing/partial).
- `missing` means no mapped implemented signal family was found.
