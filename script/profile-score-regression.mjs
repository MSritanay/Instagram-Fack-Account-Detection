import fs from 'node:fs';
import path from 'node:path';

const PROFILE_EVIDENCE_POLICY = {
  minInteractionSamples: 4,
  minDetailsFetched: 4,
  minDataCompleteness: 0.65,
};

const TRUST_POLICY = {
  ratioBehaviorGate: {
    minFollowers: 250_000,
    minFollowerFollowingRatio: 2000,
    maxInstitutionalConfidenceWithoutBehavior: 70,
  },
};

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function standardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
  const variance = values.reduce((sum, n) => sum + ((n - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function normalizeFixture(raw) {
  const followers = Number(raw.followers || 0);
  const following = Number(raw.following || 0);
  const hasNetworkRatioEvidence =
    Number.isFinite(followers) &&
    Number.isFinite(following) &&
    (followers > 0 || following > 0);
  const ratio = hasNetworkRatioEvidence
    ? (following > 0 ? followers / following : Number.POSITIVE_INFINITY)
    : 0;
  return {
    name: raw.name,
    verified: raw.verified === true,
    followers,
    following,
    posts: Number(raw.posts || 0),
    private: raw.private === true,
    hasProfilePic: raw.hasProfilePic !== false,
    mediaEvidenceAvailable: raw.mediaEvidenceAvailable !== false,
    mediaItemsCount: Number(raw.mediaItemsCount || 0),
    enrichedSampleCount: Number(raw.enrichedSampleCount || 0),
    interactionSamples: Number(raw.interactionSamples || 0),
    contentScore: Number(raw.contentScore || 70),
    behavioralEvidence: String(raw.behavioralEvidence || 'full'),
    institutionalConfidenceScore: Number(raw.institutionalConfidenceScore || 60),
    explicitScamSignals: raw.explicitScamSignals === true,
    avgEngagement: Number(raw.avgEngagement || 0),
    engagementCv: Number(raw.engagementCv || 1),
    frequencyCv: Number(raw.frequencyCv || 1),
    postingIntervalsCount: Number(raw.postingIntervalsCount || 0),
    avgCommentLikeRatio: Number(raw.avgCommentLikeRatio || 0),
    captionDiversity: Number(raw.captionDiversity || 0),
    captionsCount: Number(raw.captionsCount || 0),
    avgCaptionLen: Number(raw.avgCaptionLen || 0),
    promotionHits: Number(raw.promotionHits || 0),
    toxicHits: Number(raw.toxicHits || 0),
    institutionalType: String(raw.institutionalType || 'general'),
    persuasionHits: Number(raw.persuasionHits || 0),
    postingRecencyDays: Number(raw.postingRecencyDays || 0),
    interactionDensity: Number(raw.interactionDensity || 0),
    activeSpanDays: Number(raw.activeSpanDays || 0),
    postsPerDay: Number(raw.postsPerDay || 0),
    commentUsersCount: Number(raw.commentUsersCount || 0),
    commentUniquenessRatio: Number(raw.commentUniquenessRatio || 0),
    ratio,
  };
}

function computeOldScores(profile) {
  let structuralScore = 0;
  if (profile.verified) structuralScore += 35;
  if (profile.followers >= 1_000_000) structuralScore += 25;
  else if (profile.followers >= 100_000) structuralScore += 18;
  else if (profile.followers >= 10_000) structuralScore += 10;
  if (profile.posts >= 100) structuralScore += 20;
  else if (profile.posts >= 20) structuralScore += 12;
  else if (profile.posts >= 5) structuralScore += 6;
  if (!profile.private) structuralScore += 8;
  if (profile.hasProfilePic) structuralScore += 8;
  if (!profile.verified && profile.ratio > 1000 && profile.following < 200) structuralScore -= 22;
  if (!profile.verified && profile.following > 1000 && profile.followers < 300) structuralScore -= 18;
  if (profile.posts === 0 && profile.followers > 5000) structuralScore -= 15;
  if (!profile.hasProfilePic) structuralScore -= 25;
  if (profile.following === 0 && profile.followers === 0) structuralScore -= 20;
  structuralScore = clampNumber(Math.round(structuralScore), 0, 100);

  const behavioralUnavailable = profile.interactionSamples < PROFILE_EVIDENCE_POLICY.minInteractionSamples;
  let behavioralScore = null;
  let behavioralEvidence = 'none';
  if (!behavioralUnavailable) {
    behavioralScore = 50;
    if (profile.avgEngagement >= 0.03 && profile.avgEngagement <= 12) behavioralScore += 14;
    else if (profile.avgEngagement < 0.01) behavioralScore -= 14;
    else if (profile.avgEngagement > 25) behavioralScore -= 6;
    if (profile.engagementCv <= 1.5) behavioralScore += 12;
    else if (profile.engagementCv <= 3) behavioralScore += 5;
    else behavioralScore -= 10;
    if (profile.postingIntervalsCount >= 4) {
      if (profile.frequencyCv <= 1.2) behavioralScore += 12;
      else if (profile.frequencyCv <= 2) behavioralScore += 5;
      else behavioralScore -= 9;
    }
    if (profile.avgCommentLikeRatio >= 0.005 && profile.avgCommentLikeRatio <= 0.25) behavioralScore += 8;
    else if (profile.avgCommentLikeRatio > 0 && profile.avgCommentLikeRatio < 0.001) behavioralScore -= 6;
    else if (profile.avgCommentLikeRatio > 0.6) behavioralScore -= 4;
    if (profile.captionDiversity >= 0.75) behavioralScore += 8;
    else if (profile.captionDiversity < 0.4 && profile.captionsCount >= 5) behavioralScore -= 8;
    if (profile.avgCaptionLen >= 15 && profile.avgCaptionLen <= 280) behavioralScore += 6;
    else if (profile.avgCaptionLen > 0 && profile.avgCaptionLen < 8) behavioralScore -= 5;
    behavioralScore -= Math.min(12, profile.promotionHits * 2);
    behavioralScore -= Math.min(10, profile.toxicHits * 2);
    if (profile.institutionalType === 'science') behavioralScore += 5;
    else if (profile.institutionalType === 'international') behavioralScore += 3;
    if (profile.institutionalType === 'governance' && profile.persuasionHits > 0) behavioralScore -= Math.min(6, profile.persuasionHits * 2);
    behavioralScore = clampNumber(Math.round(behavioralScore), 0, 100);

    if (profile.interactionSamples >= 12 && profile.postingIntervalsCount >= 8 && profile.captionsCount >= 8) behavioralEvidence = 'full';
    else if (profile.interactionSamples >= 8 && (profile.postingIntervalsCount >= 5 || profile.captionsCount >= 5)) behavioralEvidence = 'medium';
    else behavioralEvidence = 'basic';
  }

  let photoScore = 0;
  if (profile.hasProfilePic) photoScore += profile.mediaEvidenceAvailable ? 55 : 35;
  if (profile.posts >= 10) photoScore += profile.mediaEvidenceAvailable ? 20 : 8;
  else if (profile.posts >= 3) photoScore += profile.mediaEvidenceAvailable ? 12 : 5;
  else if (profile.posts === 0 && profile.followers > 100) photoScore -= 10;
  if (profile.verified) photoScore += profile.mediaEvidenceAvailable ? 10 : 6;
  if (!profile.mediaEvidenceAvailable) photoScore = Math.min(photoScore, 60);
  photoScore = clampNumber(Math.round(photoScore), 0, 100);

  const dataCompleteness = behavioralUnavailable ? 0.75 : 1;
  const behavioralDepth = behavioralEvidence === 'full' ? 1 : behavioralEvidence === 'medium' ? 0.75 : behavioralEvidence === 'basic' ? 0.55 : 0.1;
  const structuralStrength = structuralScore / 100;
  const recentMediaCoverage = profile.mediaItemsCount >= 20 ? 1 : profile.mediaItemsCount >= 12 ? 0.75 : profile.mediaItemsCount >= 8 ? 0.55 : 0.35;
  let confidenceScore = clampNumber(
    (0.35 * dataCompleteness) + (0.25 * behavioralDepth) + (0.2 * structuralStrength) + (0.2 * recentMediaCoverage),
    0,
    1,
  );
  const requiresBehavioralValidation = profile.followers > 1_000_000 && profile.following < 15;
  const behavioralRequired =
    profile.followers >= TRUST_POLICY.ratioBehaviorGate.minFollowers &&
    profile.ratio >= TRUST_POLICY.ratioBehaviorGate.minFollowerFollowingRatio &&
    profile.institutionalConfidenceScore < TRUST_POLICY.ratioBehaviorGate.maxInstitutionalConfidenceWithoutBehavior;
  const evidenceConstrainedInstitutional =
    profile.verified &&
    profile.followers >= 500_000 &&
    profile.following > 0 &&
    profile.following <= 25 &&
    profile.posts >= 100 &&
    profile.institutionalConfidenceScore >= 60 &&
    !profile.explicitScamSignals;
  if (profile.mediaItemsCount < 20) confidenceScore = Math.min(confidenceScore, 0.7);
  if (behavioralUnavailable) confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.68 : 0.55);
  if (requiresBehavioralValidation && behavioralUnavailable) confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.64 : 0.5);
  if (behavioralRequired && behavioralUnavailable) confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.62 : 0.45);

  const weightedTrustProxy = Math.round(
    (0.32 * structuralScore) +
    (0.3 * profile.contentScore) +
    (0.28 * (Number.isFinite(behavioralScore) ? behavioralScore : 50)) +
    (0.1 * photoScore),
  );
  const finalTrustProxy = Math.round(weightedTrustProxy * (0.7 + (0.3 * confidenceScore)));
  return {
    structuralScore,
    behavioralScore,
    photoScore,
    confidencePct: Math.round(confidenceScore * 100),
    finalTrustProxy: clampNumber(finalTrustProxy, 0, 100),
  };
}

function computeNewScores(profile) {
  let structuralScore = 0;
  if (profile.verified) structuralScore += 26;
  const followerMagnitude = profile.followers > 0 ? Math.log10(profile.followers + 1) : 0;
  structuralScore += clampNumber(Math.round((followerMagnitude - 3) * 8), 0, 26);
  const postMagnitude = profile.posts > 0 ? Math.log10(profile.posts + 1) : 0;
  structuralScore += clampNumber(Math.round((postMagnitude - 0.7) * 12), 0, 18);
  if (!profile.private) structuralScore += 8;
  if (profile.hasProfilePic) structuralScore += 6;
  const ratioLog = profile.ratio > 0 ? Math.log10(profile.ratio + 1) : 0;
  if (ratioLog >= 1.2 && ratioLog <= 6.8) structuralScore += 8;
  else if (ratioLog >= 0.5 && ratioLog <= 8) structuralScore += 4;
  else structuralScore -= 6;
  if (!profile.verified && profile.ratio > 1000 && profile.following < 200) structuralScore -= 22;
  if (!profile.verified && profile.following > 1000 && profile.followers < 300) structuralScore -= 18;
  if (profile.posts === 0 && profile.followers > 5000) structuralScore -= 15;
  if (!profile.hasProfilePic) structuralScore -= 24;
  if (profile.following === 0 && profile.followers === 0) structuralScore -= 20;
  if (profile.postingRecencyDays > 180 && profile.posts > 50) structuralScore -= 8;
  else if (profile.postingRecencyDays <= 14 && profile.posts > 20) structuralScore += 2;
  if (profile.postsPerDay > 0 && profile.postsPerDay <= 3.5) structuralScore += 2;
  else if (profile.postsPerDay > 10) structuralScore -= 8;
  if (profile.activeSpanDays >= 365) structuralScore += 2;
  else if (profile.activeSpanDays > 0 && profile.activeSpanDays < 30 && profile.followers > 100_000) structuralScore -= 8;
  if (profile.followers >= 5_000_000 && profile.following <= 3) structuralScore -= 8;
  else if (profile.followers >= 5_000_000 && profile.following <= 10) structuralScore -= 4;
  if (!profile.verified && profile.ratio > 20_000 && profile.following < 50) structuralScore -= 8;
  structuralScore = clampNumber(Math.round(structuralScore), 0, 100);

  const behavioralUnavailable = profile.interactionSamples < PROFILE_EVIDENCE_POLICY.minInteractionSamples;
  let behavioralScore = null;
  let behavioralEvidence = 'none';
  if (!behavioralUnavailable) {
    behavioralScore = 50;
    const isMegaReach = profile.followers >= 10_000_000;
    if (isMegaReach) {
      if (profile.avgEngagement >= 0.02 && profile.avgEngagement <= 2.5) behavioralScore += 9;
      else if (profile.avgEngagement < 0.01) behavioralScore -= 14;
      else if (profile.avgEngagement > 6) behavioralScore -= 10;
    } else {
      if (profile.avgEngagement >= 0.03 && profile.avgEngagement <= 12) behavioralScore += 14;
      else if (profile.avgEngagement < 0.01) behavioralScore -= 14;
      else if (profile.avgEngagement > 25) behavioralScore -= 6;
    }
    if (profile.engagementCv <= 1.5) behavioralScore += 12;
    else if (profile.engagementCv <= 3) behavioralScore += 5;
    else behavioralScore -= 10;
    if (profile.postingIntervalsCount >= 4) {
      if (profile.frequencyCv <= 1.2) behavioralScore += 12;
      else if (profile.frequencyCv <= 2) behavioralScore += 5;
      else behavioralScore -= 9;
    }
    if (profile.avgCommentLikeRatio >= 0.005 && profile.avgCommentLikeRatio <= 0.25) behavioralScore += 8;
    else if (profile.avgCommentLikeRatio > 0 && profile.avgCommentLikeRatio < 0.001) behavioralScore -= 6;
    else if (profile.avgCommentLikeRatio > 0.6) behavioralScore -= 4;
    if (profile.captionDiversity >= 0.75) behavioralScore += 8;
    else if (profile.captionDiversity < 0.4 && profile.captionsCount >= 5) behavioralScore -= 8;
    if (profile.avgCaptionLen >= 15 && profile.avgCaptionLen <= 280) behavioralScore += 6;
    else if (profile.avgCaptionLen > 0 && profile.avgCaptionLen < 8) behavioralScore -= 5;
    behavioralScore -= Math.min(12, profile.promotionHits * 2);
    behavioralScore -= Math.min(10, profile.toxicHits * 2);
    if (profile.commentUsersCount >= 20) {
      if (profile.commentUniquenessRatio >= 0.45) behavioralScore += 6;
      else if (profile.commentUniquenessRatio < 0.2) behavioralScore -= 7;
    }
    if (profile.postingRecencyDays <= 14) behavioralScore += 5;
    else if (profile.postingRecencyDays > 180) behavioralScore -= 8;
    if (profile.interactionDensity >= 0.75) behavioralScore += 4;
    else if (profile.interactionDensity < 0.3) behavioralScore -= 6;
    if (profile.activeSpanDays > 0 && profile.activeSpanDays < 45 && profile.posts > 200) behavioralScore -= 8;
    if (profile.institutionalType === 'science') behavioralScore += 3;
    else if (profile.institutionalType === 'international') behavioralScore += 2;
    if (profile.institutionalType === 'governance' && profile.persuasionHits > 0) behavioralScore -= Math.min(6, profile.persuasionHits * 2);
    const sampleDepthFactor = clampNumber(
      ((profile.interactionSamples - 2) / 18) * clampNumber(profile.mediaItemsCount / 20, 0.4, 1),
      0.2,
      1,
    );
    behavioralScore = 50 + ((behavioralScore - 50) * sampleDepthFactor);
    if (profile.followers >= 5_000_000 && profile.mediaItemsCount <= 20) {
      behavioralScore = Math.min(behavioralScore, 84);
    }
    behavioralScore = clampNumber(Math.round(behavioralScore), 0, 100);

    if (profile.interactionSamples >= 12 && profile.postingIntervalsCount >= 8 && profile.captionsCount >= 8) behavioralEvidence = 'full';
    else if (profile.interactionSamples >= 8 && (profile.postingIntervalsCount >= 5 || profile.captionsCount >= 5)) behavioralEvidence = 'medium';
    else behavioralEvidence = 'basic';
  }

  let photoScore = 20;
  if (profile.hasProfilePic) photoScore += profile.mediaEvidenceAvailable ? 24 : 14;
  else photoScore -= 18;
  photoScore += clampNumber(Math.round(Math.log10(profile.posts + 1) * 6), 0, 12);
  if (profile.verified) photoScore += 6;
  if (profile.mediaEvidenceAvailable) {
    photoScore += clampNumber(Math.round((profile.mediaItemsCount / 20) * 8), 0, 8);
    photoScore += clampNumber(Math.round((profile.captionDiversity - 0.5) * 20), -8, 8);
    photoScore += clampNumber(Math.round((profile.interactionDensity - 0.5) * 14), -7, 7);
    photoScore += clampNumber(Math.round((profile.commentUniquenessRatio - 0.4) * 18), -6, 8);
    const enrichmentRatio = profile.mediaItemsCount > 0 ? (profile.enrichedSampleCount / profile.mediaItemsCount) : 0;
    photoScore += clampNumber(Math.round((enrichmentRatio - 0.35) * 15), -4, 6);
  } else {
    photoScore -= 8;
    photoScore = Math.min(photoScore, 54);
  }
  photoScore = clampNumber(Math.round(photoScore), 0, 100);

  const dataCompleteness = behavioralUnavailable ? 0.75 : 1;
  const behavioralDepth = behavioralEvidence === 'full' ? 1 : behavioralEvidence === 'medium' ? 0.75 : behavioralEvidence === 'basic' ? 0.55 : 0.1;
  const structuralStrength = structuralScore / 100;
  const recentMediaCoverage = profile.mediaItemsCount >= 20 ? 1 : profile.mediaItemsCount >= 12 ? 0.75 : profile.mediaItemsCount >= 8 ? 0.55 : 0.35;
  let confidenceScore = clampNumber(
    (0.35 * dataCompleteness) + (0.25 * behavioralDepth) + (0.2 * structuralStrength) + (0.2 * recentMediaCoverage),
    0,
    1,
  );
  const sampleCoverageRatio = profile.posts > 0 ? Math.min(1, profile.mediaItemsCount / Math.min(profile.posts, 400)) : 0;
  if (profile.followers >= 100_000_000 && profile.mediaItemsCount <= 20) confidenceScore = Math.min(confidenceScore, 0.78);
  else if (profile.followers >= 10_000_000 && profile.mediaItemsCount <= 20) confidenceScore = Math.min(confidenceScore, 0.82);
  else if (profile.followers >= 1_000_000 && profile.mediaItemsCount <= 20) confidenceScore = Math.min(confidenceScore, 0.86);
  if (profile.followers >= 1_000_000) {
    if (sampleCoverageRatio < 0.01) confidenceScore = Math.min(confidenceScore, 0.8);
    else if (sampleCoverageRatio < 0.03) confidenceScore = Math.min(confidenceScore, 0.84);
  }
  if (profile.mediaItemsCount < 20) confidenceScore = Math.min(confidenceScore, 0.7);

  const requiresBehavioralValidation = profile.followers > 1_000_000 && profile.following < 15;
  const behavioralRequired =
    profile.followers >= TRUST_POLICY.ratioBehaviorGate.minFollowers &&
    profile.ratio >= TRUST_POLICY.ratioBehaviorGate.minFollowerFollowingRatio &&
    profile.institutionalConfidenceScore < TRUST_POLICY.ratioBehaviorGate.maxInstitutionalConfidenceWithoutBehavior;
  const evidenceConstrainedInstitutional =
    profile.verified &&
    profile.followers >= 500_000 &&
    profile.following > 0 &&
    profile.following <= 25 &&
    profile.posts >= 100 &&
    profile.institutionalConfidenceScore >= 60 &&
    !profile.explicitScamSignals;
  if (behavioralUnavailable) confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.68 : 0.55);
  if (requiresBehavioralValidation && behavioralUnavailable) confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.64 : 0.5);
  if (behavioralRequired && behavioralUnavailable) confidenceScore = Math.min(confidenceScore, evidenceConstrainedInstitutional ? 0.62 : 0.45);

  const trustComponentsForSpread = [structuralScore, profile.contentScore, photoScore];
  if (Number.isFinite(behavioralScore)) trustComponentsForSpread.push(behavioralScore);
  const componentSpread = standardDeviation(trustComponentsForSpread);
  const behavioralLift = Number.isFinite(behavioralScore)
    ? (((behavioralScore - 50) / 50) * 4 * behavioralDepth)
    : 0;
  const weightedTrustProxy = Math.round(
    (0.32 * structuralScore) +
    (0.3 * profile.contentScore) +
    (0.28 * (Number.isFinite(behavioralScore) ? behavioralScore : 50)) +
    (0.1 * photoScore),
  );
  const finalTrustProxy = Math.round(
    (weightedTrustProxy * (0.64 + (0.36 * confidenceScore))) +
    behavioralLift +
    clampNumber((componentSpread - 10) * 0.12, -3, 3),
  );

  return {
    structuralScore,
    behavioralScore,
    photoScore,
    confidencePct: Math.round(confidenceScore * 100),
    finalTrustProxy: clampNumber(finalTrustProxy, 0, 100),
  };
}

function formatDelta(n) {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

function printComparison(results) {
  const lines = [];
  lines.push('Profile Score Regression (Old vs New)');
  lines.push('='.repeat(74));
  lines.push(
    'name'.padEnd(12) +
      'struct'.padStart(10) +
      'behav'.padStart(10) +
      'photo'.padStart(10) +
      'conf%'.padStart(10) +
      'trust'.padStart(10) +
      ' | ' +
      'd_struct'.padStart(9) +
      'd_behav'.padStart(9) +
      'd_photo'.padStart(9) +
      'd_conf'.padStart(9) +
      'd_trust'.padStart(9),
  );
  lines.push('-'.repeat(74));
  for (const row of results) {
    lines.push(
      row.name.padEnd(12) +
        String(row.old.structuralScore).padStart(10) +
        String(row.old.behavioralScore ?? 'N/A').padStart(10) +
        String(row.old.photoScore).padStart(10) +
        String(row.old.confidencePct).padStart(10) +
        String(row.old.finalTrustProxy ?? 'N/A').padStart(10) +
        ' | ' +
        formatDelta(row.new.structuralScore - row.old.structuralScore).padStart(9) +
        formatDelta((row.new.behavioralScore ?? 0) - (row.old.behavioralScore ?? 0)).padStart(9) +
        formatDelta(row.new.photoScore - row.old.photoScore).padStart(9) +
        formatDelta(row.new.confidencePct - row.old.confidencePct).padStart(9) +
        formatDelta((row.new.finalTrustProxy ?? 0) - (row.old.finalTrustProxy ?? 0)).padStart(9),
    );
  }
  lines.push('-'.repeat(74));
  lines.push('Columns show OLD values and per-dimension NEW-OLD deltas.');
  console.log(lines.join('\n'));
}

function main() {
  const fixturesPath = path.resolve('script/profile-score-regression.fixtures.json');
  const raw = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  const fixtures = Array.isArray(raw.profiles) ? raw.profiles.map(normalizeFixture) : [];
  if (fixtures.length === 0) {
    console.error('No fixtures found in script/profile-score-regression.fixtures.json');
    process.exit(1);
  }
  const results = fixtures.map((profile) => ({
    name: profile.name,
    old: computeOldScores(profile),
    new: computeNewScores(profile),
  }));
  printComparison(results);
}

main();
