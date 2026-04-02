import { computeProfileRisk, loadRiskConfig } from './profile-risk-30-signal.mjs';

function clamp(v, min = 0, max = 1) {
  return Math.min(max, Math.max(min, v));
}

function mkName(bucket, i) {
  return `${bucket}_${String(i + 1).padStart(3, '0')}`;
}

function withJitter(base, i, maxDelta = 0.05) {
  const sign = i % 2 === 0 ? 1 : -1;
  const step = ((i % 7) + 1) / 7;
  return clamp(base + (sign * step * maxDelta));
}

function buildProfile(bucket, i) {
  const common = {
    username: mkName(bucket, i),
    usernameLength: 10,
    usernameDigits: 0,
    usernameSpecials: 1,
    knownTarget: '',
    verified: false,
    followers: 1000,
    following: 1000,
    likes: 50,
    comments: 5,
    posts: 80,
    accountAgeMonths: 24,
    profileCompleteness: 0.7,
    bioKeywordRisk: 0.1,
    externalLinkRisk: 0.0,
    followerGrowthPct: 8,
    mutualFollowerDensity: 0.45,
    botFollowerRatio: 0.08,
    followerQualityScore: 0.75,
    accountClass: 'normal',
    contentConsistency: 0.75,
    recentTopicShift: false,
    captionScamScore: 0.05,
    hashtagSpamRatio: 0.4,
    duplicateContentScore: 0.08,
    commentAuthenticityScore: 0.72,
    likeVelocityAnomalyPct: 20,
    commentSpamRatio: 0.08,
    engagementStdDev: 0.8,
    followRatePerDay: 10,
    unfollowRatePerDay: 9,
    dmSpamScore: 0.03,
    activityHoursVariance: 0.65,
    postingAutomationScore: 0.1,
    usernameChangesPerMonth: 0.02,
    bioChangesPerMonth: 0.03,
    reportRatePerFollower: 0.0002,
    externalPlatformRedirection: 0.05,
    scamSignalCount: 0,
    evidenceCompleteness: 0.8,
  };

  if (bucket === 'verified_institutional') {
    return {
      ...common,
      verified: true,
      accountClass: 'institutional',
      followers: 15_000_000 + (i * 30_000),
      following: 120 + (i % 25),
      posts: 2500 + (i * 3),
      likes: 95_000,
      comments: 2100,
      profileCompleteness: withJitter(0.95, i, 0.03),
      contentConsistency: withJitter(0.9, i, 0.04),
      commentAuthenticityScore: withJitter(0.86, i, 0.05),
      evidenceCompleteness: withJitter(0.88, i, 0.05),
      activityHoursVariance: withJitter(0.72, i, 0.06),
      externalPlatformRedirection: 0.01,
      reportRatePerFollower: 0.00005,
    };
  }

  if (bucket === 'verified_brand_media') {
    return {
      ...common,
      verified: true,
      accountClass: 'brand',
      followers: 8_000_000 + (i * 250_000),
      following: 180 + (i % 80),
      posts: 1200 + (i * 4),
      likes: 65_000,
      comments: 1300,
      profileCompleteness: withJitter(0.9, i, 0.05),
      contentConsistency: withJitter(0.84, i, 0.06),
      commentAuthenticityScore: withJitter(0.8, i, 0.08),
      evidenceCompleteness: withJitter(0.85, i, 0.06),
      activityHoursVariance: withJitter(0.68, i, 0.08),
      externalPlatformRedirection: withJitter(0.08, i, 0.05),
      reportRatePerFollower: 0.00008,
    };
  }

  if (bucket === 'verified_low_mid') {
    return {
      ...common,
      verified: true,
      accountClass: 'normal',
      followers: 15_000 + (i * 5000),
      following: 300 + (i % 180),
      posts: 350 + (i * 2),
      likes: 1800,
      comments: 95,
      profileCompleteness: withJitter(0.82, i, 0.08),
      contentConsistency: withJitter(0.76, i, 0.1),
      commentAuthenticityScore: withJitter(0.72, i, 0.12),
      evidenceCompleteness: withJitter(0.78, i, 0.08),
      engagementStdDev: withJitter(1.1, i, 0.3),
      activityHoursVariance: withJitter(0.62, i, 0.12),
      externalPlatformRedirection: withJitter(0.06, i, 0.07),
      reportRatePerFollower: 0.00015,
    };
  }

  if (bucket === 'normal_active') {
    return {
      ...common,
      accountClass: 'normal',
      followers: 200 + (i * 22),
      following: 180 + (i * 17),
      posts: 20 + (i * 2),
      accountAgeMonths: 8 + (i % 24),
      likes: 40 + (i % 120),
      comments: 4 + (i % 15),
      profileCompleteness: withJitter(0.72, i, 0.12),
      contentConsistency: withJitter(0.7, i, 0.14),
      commentAuthenticityScore: withJitter(0.68, i, 0.14),
      evidenceCompleteness: withJitter(0.68, i, 0.14),
      hashtagSpamRatio: withJitter(0.5, i, 0.4),
      engagementStdDev: withJitter(0.9, i, 0.35),
      activityHoursVariance: withJitter(0.58, i, 0.16),
      externalPlatformRedirection: withJitter(0.08, i, 0.1),
      reportRatePerFollower: 0.0004,
    };
  }

  if (bucket === 'empty_sparse') {
    return {
      ...common,
      accountClass: 'normal',
      followers: 3 + (i % 18),
      following: 120 + (i % 380),
      posts: i % 3,
      accountAgeMonths: 1 + (i % 8),
      likes: 0,
      comments: 0,
      profileCompleteness: withJitter(0.18, i, 0.15),
      bioKeywordRisk: withJitter(0.12, i, 0.1),
      externalLinkRisk: withJitter(0.15, i, 0.2),
      mutualFollowerDensity: withJitter(0.08, i, 0.08),
      botFollowerRatio: withJitter(0.5, i, 0.2),
      followerQualityScore: withJitter(0.2, i, 0.15),
      contentConsistency: withJitter(0.35, i, 0.25),
      captionScamScore: withJitter(0.1, i, 0.15),
      duplicateContentScore: withJitter(0.45, i, 0.25),
      commentAuthenticityScore: withJitter(0.2, i, 0.15),
      likeVelocityAnomalyPct: withJitter(70, i, 40),
      commentSpamRatio: withJitter(0.4, i, 0.25),
      engagementStdDev: withJitter(1.5, i, 0.6),
      followRatePerDay: 120 + (i % 160),
      unfollowRatePerDay: 100 + (i % 150),
      dmSpamScore: withJitter(0.35, i, 0.2),
      activityHoursVariance: withJitter(0.22, i, 0.18),
      postingAutomationScore: withJitter(0.58, i, 0.25),
      usernameChangesPerMonth: withJitter(0.5, i, 0.4),
      bioChangesPerMonth: withJitter(0.7, i, 0.6),
      reportRatePerFollower: 0.004,
      externalPlatformRedirection: withJitter(0.25, i, 0.2),
      scamSignalCount: i % 5 === 0 ? 1 : 0,
      evidenceCompleteness: withJitter(0.35, i, 0.15),
    };
  }

  // scam_suspicious
  return {
    ...common,
    accountClass: 'normal',
    followers: 20 + (i % 260),
    following: 800 + (i % 2200),
    posts: 2 + (i % 18),
    accountAgeMonths: 1 + (i % 10),
    likes: 1 + (i % 10),
    comments: i % 3,
    profileCompleteness: withJitter(0.3, i, 0.18),
    bioKeywordRisk: withJitter(0.72, i, 0.2),
    externalLinkRisk: withJitter(0.78, i, 0.2),
    followerGrowthPct: 180 + (i % 240),
    mutualFollowerDensity: withJitter(0.06, i, 0.05),
    botFollowerRatio: withJitter(0.72, i, 0.18),
    followerQualityScore: withJitter(0.15, i, 0.12),
    contentConsistency: withJitter(0.35, i, 0.25),
    recentTopicShift: i % 4 === 0,
    captionScamScore: withJitter(0.7, i, 0.2),
    hashtagSpamRatio: withJitter(1.8, i, 0.8),
    duplicateContentScore: withJitter(0.72, i, 0.2),
    commentAuthenticityScore: withJitter(0.16, i, 0.12),
    likeVelocityAnomalyPct: 260 + (i % 260),
    commentSpamRatio: withJitter(0.68, i, 0.2),
    engagementStdDev: withJitter(2.2, i, 0.8),
    followRatePerDay: 220 + (i % 260),
    unfollowRatePerDay: 180 + (i % 240),
    dmSpamScore: withJitter(0.82, i, 0.15),
    activityHoursVariance: withJitter(0.1, i, 0.08),
    postingAutomationScore: withJitter(0.8, i, 0.15),
    usernameChangesPerMonth: withJitter(1.1, i, 0.7),
    bioChangesPerMonth: withJitter(1.6, i, 0.9),
    reportRatePerFollower: 0.012,
    externalPlatformRedirection: withJitter(0.88, i, 0.12),
    scamSignalCount: 4 + (i % 4),
    evidenceCompleteness: withJitter(0.58, i, 0.2),
  };
}

function generateFixtures() {
  const buckets = [
    { key: 'verified_institutional', count: 30, expectedClasses: ['legitimate'], min: 0.0, max: 0.25 },
    { key: 'verified_brand_media', count: 30, expectedClasses: ['legitimate'], min: 0.0, max: 0.30 },
    { key: 'verified_low_mid', count: 30, expectedClasses: ['legitimate', 'low-risk'], min: 0.10, max: 0.50 },
    { key: 'normal_active', count: 100, expectedClasses: ['legitimate', 'low-risk'], min: 0.10, max: 0.55 },
    { key: 'empty_sparse', count: 100, expectedClasses: ['low-risk', 'suspicious'], min: 0.25, max: 0.85 },
    { key: 'scam_suspicious', count: 100, expectedClasses: ['high-risk'], min: 0.70, max: 1.0 },
  ];

  const fixtures = [];
  for (const bucket of buckets) {
    for (let i = 0; i < bucket.count; i += 1) {
      fixtures.push({
        id: `${bucket.key}-${i + 1}`,
        bucket: bucket.key,
        expectedClasses: bucket.expectedClasses,
        expectedMinRisk: bucket.min,
        expectedMaxRisk: bucket.max,
        profile: buildProfile(bucket.key, i),
      });
    }
  }
  return fixtures;
}

function summarize(results, failures) {
  const byBucket = new Map();
  for (const row of results) {
    if (!byBucket.has(row.bucket)) byBucket.set(row.bucket, []);
    byBucket.get(row.bucket).push(row);
  }

  console.log('30-Signal Profile Risk Regression');
  console.log('='.repeat(72));
  for (const [bucket, items] of byBucket.entries()) {
    const avgRisk = items.reduce((s, r) => s + r.riskScore, 0) / items.length;
    const pass = items.filter((x) => x.pass).length;
    const fail = items.length - pass;
    console.log(`${bucket.padEnd(24)} total=${String(items.length).padStart(3)} pass=${String(pass).padStart(3)} fail=${String(fail).padStart(3)} avgRisk=${avgRisk.toFixed(3)}`);
  }
  console.log('-'.repeat(72));
  console.log(`Total: ${results.length} | Failures: ${failures.length}`);

  if (failures.length > 0) {
    console.log('Sample failures (first 20):');
    for (const f of failures.slice(0, 20)) {
      console.log(JSON.stringify(f, null, 2));
    }
  }
}

function main() {
  const config = loadRiskConfig();
  const fixtures = generateFixtures();
  const results = [];
  const failures = [];

  for (const fixture of fixtures) {
    const out = computeProfileRisk(fixture.profile, config);
    const inRange = out.riskScore >= fixture.expectedMinRisk && out.riskScore <= fixture.expectedMaxRisk;
    const classMatch = fixture.expectedClasses.includes(out.riskClass);
    const pass = inRange && classMatch;

    const row = {
      id: fixture.id,
      bucket: fixture.bucket,
      riskScore: out.riskScore,
      riskClass: out.riskClass,
      expectedClasses: fixture.expectedClasses,
      expectedMinRisk: fixture.expectedMinRisk,
      expectedMaxRisk: fixture.expectedMaxRisk,
      pass,
    };
    results.push(row);
    if (!pass) failures.push({ ...row, layerScores: out.layerScores, overrides: out.overrides });
  }

  summarize(results, failures);
  if (failures.length > 0) process.exit(1);
}

main();
