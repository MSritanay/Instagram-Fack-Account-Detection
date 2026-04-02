import fs from 'node:fs';
import path from 'node:path';

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function safeDiv(n, d) {
  return d > 0 ? n / d : 0;
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const dp = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= t.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[s.length][t.length];
}

function similarity(a, b) {
  const A = String(a || '').toLowerCase().trim();
  const B = String(b || '').toLowerCase().trim();
  if (!A || !B) return 0;
  const dist = levenshtein(A, B);
  const maxLen = Math.max(A.length, B.length);
  return clamp(1 - safeDiv(dist, maxLen));
}

function scoreFromBands(value, bands) {
  for (const band of bands) {
    if (value <= band.max) return clamp(band.risk);
  }
  return clamp(bands[bands.length - 1]?.risk ?? 1);
}

function ffRatioRisk(profile) {
  const ffr = safeDiv(profile.followers, Math.max(1, profile.following));
  const cls = profile.accountClass;
  if (cls === 'brand' || cls === 'institutional') {
    if (ffr >= 100) return 0.05;
    if (ffr >= 20) return 0.15;
    if (ffr >= 5) return 0.35;
    return 0.7;
  }
  if (ffr < 0.1) return 1;
  if (ffr < 0.5) return 0.75;
  if (ffr <= 2) return 0.2;
  if (ffr <= 5) return 0.35;
  return 0.55;
}

function engagementRisk(profile) {
  const er = safeDiv(profile.likes + profile.comments, Math.max(1, profile.followers)) * 100;
  const cls = profile.accountClass;
  if (cls === 'normal') {
    if (er >= 3 && er <= 10) return 0.1;
    if (er >= 1.5 && er < 3) return 0.3;
    if (er > 10) return 0.4;
    return 0.7;
  }
  if (cls === 'brand' || cls === 'institutional') {
    if (er >= 1 && er <= 3) return 0.1;
    if (er >= 0.4 && er < 1) return 0.25;
    if (er > 3) return 0.3;
    return 0.55;
  }
  if (er >= 2 && er <= 6) return 0.15;
  if (er >= 1 && er < 2) return 0.35;
  if (er > 6) return 0.35;
  return 0.75;
}

function postFrequencyRisk(profile) {
  const months = Math.max(1, profile.accountAgeMonths);
  const pf = safeDiv(profile.posts, months);
  if (pf === 0) return 1;
  if (pf < 0.1) return 0.8;
  if (pf <= 1) return 0.55;
  if (pf <= 10) return 0.2;
  if (pf <= 20) return 0.4;
  return 0.75;
}

function accountAgeRisk(months) {
  if (months >= 48) return 0.05;
  if (months >= 24) return 0.1;
  if (months >= 12) return 0.25;
  if (months >= 6) return 0.45;
  if (months >= 3) return 0.65;
  return 0.85;
}

export function computeProfileRisk(profile, config) {
  const pcs = clamp(profile.profileCompleteness);
  const usernameSim = profile.knownTarget ? similarity(profile.username, profile.knownTarget) : 0;
  const erRisk = engagementRisk(profile);

  const signals = {
    s01_username_similarity: profile.knownTarget ? clamp((usernameSim - 0.7) / 0.3) : 0,
    s02_username_complexity: clamp(safeDiv(profile.usernameDigits + profile.usernameSpecials, Math.max(1, profile.usernameLength))),
    s03_profile_incompleteness: clamp(1 - pcs),
    s04_bio_keyword_risk: clamp(profile.bioKeywordRisk),
    s05_external_link_risk: clamp(profile.externalLinkRisk),

    s06_ff_ratio_risk: ffRatioRisk(profile),
    s07_growth_spike_risk: clamp(safeDiv(Math.max(0, profile.followerGrowthPct - 50), 300)),
    s08_mutual_density_risk: clamp(1 - profile.mutualFollowerDensity),
    s09_bot_follower_ratio: clamp(profile.botFollowerRatio),
    s10_follower_quality_risk: clamp(1 - profile.followerQualityScore),

    s11_post_frequency_risk: postFrequencyRisk(profile),
    s12_content_consistency_risk: clamp(profile.recentTopicShift ? 0.85 : (1 - profile.contentConsistency)),
    s13_caption_scam_score: clamp(profile.captionScamScore),
    s14_hashtag_spam_score: clamp(safeDiv(profile.hashtagSpamRatio, 2.5)),
    s15_duplicate_content_score: clamp(profile.duplicateContentScore),

    s16_engagement_rate_risk: erRisk,
    s17_comment_authenticity_risk: clamp(1 - profile.commentAuthenticityScore),
    s18_like_velocity_risk: clamp(safeDiv(profile.likeVelocityAnomalyPct, 200)),
    s19_comment_spam_ratio: clamp(profile.commentSpamRatio),
    s20_engagement_consistency_risk: clamp(safeDiv(profile.engagementStdDev, 3)),

    s21_follow_rate_risk: clamp(safeDiv(profile.followRatePerDay, 200)),
    s22_unfollow_rate_risk: clamp(safeDiv(profile.unfollowRatePerDay, 200)),
    s23_dm_spam_score: clamp(profile.dmSpamScore),
    s24_activity_time_pattern_risk: clamp(1 - profile.activityHoursVariance),
    s25_posting_automation_risk: clamp(profile.postingAutomationScore),

    s26_account_age_risk: accountAgeRisk(profile.accountAgeMonths),
    s27_username_change_frequency: clamp(safeDiv(profile.usernameChangesPerMonth, 2)),
    s28_bio_change_frequency: clamp(safeDiv(profile.bioChangesPerMonth, 4)),
    s29_report_frequency: clamp(safeDiv(profile.reportRatePerFollower, 0.01)),
    s30_external_platform_redirection: clamp(profile.externalPlatformRedirection),
  };

  const layers = {
    profile: [signals.s01_username_similarity, signals.s02_username_complexity, signals.s03_profile_incompleteness, signals.s04_bio_keyword_risk, signals.s05_external_link_risk],
    network: [signals.s06_ff_ratio_risk, signals.s07_growth_spike_risk, signals.s08_mutual_density_risk, signals.s09_bot_follower_ratio, signals.s10_follower_quality_risk],
    content: [signals.s11_post_frequency_risk, signals.s12_content_consistency_risk, signals.s13_caption_scam_score, signals.s14_hashtag_spam_score, signals.s15_duplicate_content_score],
    engagement: [signals.s16_engagement_rate_risk, signals.s17_comment_authenticity_risk, signals.s18_like_velocity_risk, signals.s19_comment_spam_ratio, signals.s20_engagement_consistency_risk],
    behavioral: [signals.s21_follow_rate_risk, signals.s22_unfollow_rate_risk, signals.s23_dm_spam_score, signals.s24_activity_time_pattern_risk, signals.s25_posting_automation_risk],
    context: [signals.s26_account_age_risk, signals.s27_username_change_frequency, signals.s28_bio_change_frequency, signals.s29_report_frequency, signals.s30_external_platform_redirection],
  };

  const layerScores = Object.fromEntries(Object.entries(layers).map(([k, arr]) => [k, clamp(arr.reduce((a, b) => a + b, 0) / arr.length)]));

  let riskScore = clamp(
    (config.weights.profile * layerScores.profile) +
    (config.weights.network * layerScores.network) +
    (config.weights.content * layerScores.content) +
    (config.weights.engagement * layerScores.engagement) +
    (config.weights.behavioral * layerScores.behavioral) +
    (config.weights.context * layerScores.context),
  );

  const eliteLegit = profile.verified && profile.followers >= 5_000_000 && profile.accountAgeMonths >= 24 && profile.posts >= 500 && profile.scamSignalCount === 0;
  const hardScam = profile.scamSignalCount >= 3 || profile.dmSpamScore >= 0.8 || profile.externalLinkRisk >= 0.8;

  if (eliteLegit) riskScore = Math.min(riskScore, config.hard_overrides.elite_verified_cap);
  if (hardScam) riskScore = Math.max(riskScore, config.hard_overrides.scam_floor);

  const evidenceCompleteness = clamp(profile.evidenceCompleteness);
  let evidenceConfidence = 'low';
  if (evidenceCompleteness >= config.evidence_confidence.high_min) evidenceConfidence = 'high';
  else if (evidenceCompleteness >= config.evidence_confidence.medium_min) evidenceConfidence = 'medium';

  let riskClass = 'high-risk';
  if (riskScore <= config.classification.legitimate_max) riskClass = 'legitimate';
  else if (riskScore <= config.classification.low_risk_max) riskClass = 'low-risk';
  else if (riskScore <= config.classification.suspicious_max) riskClass = 'suspicious';

  return {
    riskScore: Number(riskScore.toFixed(4)),
    riskClass,
    evidenceConfidence,
    layerScores,
    signals,
    overrides: {
      eliteLegit,
      hardScam,
    },
  };
}

export function loadRiskConfig(configPath = path.resolve('script/profile-risk-30-signal.config.json')) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
