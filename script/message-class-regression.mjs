import fs from 'node:fs';
import path from 'node:path';

function clampScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function classify(messages) {
  const joined = messages.join('\n').toLowerCase();
  const credentialKeywordCount = count(joined, /\b(password|otp|verification code|2fa|login code|account code)\b/g);
  const impersonationKeywordCount = count(joined, /\b(security team|support team|official|admin|help center)\b/g);
  const financialPressureCount = count(joined, /\b(send money|transfer|wire|upi|immediately|urgent|hurry)\b/g);
  const scamKeywordCount = count(joined, /\b(guaranteed|profit|reward|claim|lottery|investment|trading)\b/g);
  const phishingLinkCount = count(joined, /https?:\/\/[^\s]+|www\.[^\s]+/g);
  const brandTyposquatCount = count(joined, /(instagr[a4]m|b1nance|meta-?support)/g);
  const suspiciousDomainCount = count(joined, /(bit\.ly|tinyurl|t\.me|wa\.me|shorturl|is\.gd)/g);
  const riskyTldCount = count(joined, /\.(xyz|top|click|loan|ru)\b/g);
  const obfuscatedLinkSignals = count(joined, /(hxxp|hxxps|\[dot\]|\(dot\)|\sdot\s)/g);
  const suspiciousPathHits = count(joined, /(login|verify|verification|wallet|kyc|reset|account[-_]?check)/g);
  const recruitmentScamCount = count(joined, /(business partners?|daily income|stable income|earn 1000|part[-\s]?time|3-5 hours|targets|apply telegram|contact us now|upi)/g);
  const repetitionRatio = messages.length > 0
    ? 1 - (new Set(messages.map((m) => String(m || '').trim().toLowerCase())).size / messages.length)
    : 0;
  let consecutiveRepeatCount = 0;
  for (let i = 1; i < messages.length; i += 1) {
    if (String(messages[i]).trim().toLowerCase() === String(messages[i - 1]).trim().toLowerCase()) consecutiveRepeatCount += 1;
  }
  const broadcastHits = count(joined, /(limited-time opportunity|join us|share the details|refer and earn)/g);
  const credentialTransferCount = count(joined, /\b(send|share|give|provide|confirm)\s+(otp|code|verification code|password|seed phrase)\b/g);
  const genericCodeRequestCount = count(joined, /\b(confirm|verify|provide|submit)\s+(your\s+)?(account code|security code|verification code|login code|code)\b/g);
  const otpCryptoComboDetected = /\b(otp|verification code|2fa)\b/.test(joined) && /\b(crypto|wallet|binance|exchange|usdt|bitcoin)\b/.test(joined);
  const platformSwitchCount = count(joined, /\b(telegram|t\.me|whatsapp|wa\.me|signal|discord)\b/g);
  const redirectionIntentCount = count(joined, /\b(continue on|message me on|switch to|move to|not secure here)\b/g);

  const scores = {
    phishing: clampScore(
      (phishingLinkCount * 24) +
      (credentialKeywordCount * 8) +
      (impersonationKeywordCount * 8) +
      (brandTyposquatCount * 10) +
      (suspiciousDomainCount * 8) +
      (riskyTldCount * 6) +
      (obfuscatedLinkSignals * 5) +
      (suspiciousPathHits * 4),
    ),
    hacker: clampScore(
      (credentialTransferCount * 22) +
      (genericCodeRequestCount * 10) +
      (credentialKeywordCount * 7) +
      (impersonationKeywordCount * 7) +
      (financialPressureCount * 6) +
      (otpCryptoComboDetected ? 10 : 0),
    ),
    scam: clampScore(
      (scamKeywordCount * 9) +
      (financialPressureCount * 10) +
      (count(joined, /\b(crypto|wallet|binance|exchange|usdt|bitcoin)\b/g) * 6) +
      (recruitmentScamCount * 10) +
      (otpCryptoComboDetected ? 10 : 0) +
      (broadcastHits * 6) +
      ((platformSwitchCount > 0 && redirectionIntentCount > 0) ? 10 : 0),
    ),
    spam: clampScore(
      (repetitionRatio * 40) +
      (consecutiveRepeatCount * 8) +
      (broadcastHits * 8) +
      (count(joined, /\b(urgent|act now|claim|offer)\b/g) * 1.2) +
      (messages.length >= 25 ? 6 : 0),
    ),
    bot: clampScore(
      (repetitionRatio * 45) +
      (consecutiveRepeatCount * 10) +
      (count(joined, /\bhello\b/g) >= 3 ? 20 : 0),
    ),
  };

  const ranking = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topClass = ranking[0][0];
  const topScore = ranking[0][1];
  const secondScore = ranking[1][1];
  const margin = topScore - secondScore;
  const highClassCount = Object.values(scores).filter((s) => s >= 40).length;
  const mixed =
    ((highClassCount >= 2 && margin <= 12) || (highClassCount >= 3 && margin <= 22)) &&
    topScore >= 45;

  let tag = 'likely-human';
  if (topClass === 'bot' && topScore >= 70 && margin >= 15) {
    tag = 'bot';
  } else if (mixed) tag = 'mixed-risk';
  else if (topScore >= 40) {
    if (topClass === 'phishing') tag = 'phishing-risk';
    else if (topClass === 'hacker') tag = 'hacker-risk';
    else if (topClass === 'scam') tag = 'scam';
    else if (topClass === 'spam') tag = 'spam';
    else if (topClass === 'bot') tag = 'bot';
  } else if (topClass === 'scam' && topScore >= 30 && scamKeywordCount >= 2) {
    tag = 'scam';
  }
  return { tag, scores, topClass, margin, mixed };
}

function main() {
  const fixturesPath = path.resolve('script', 'message-class-regression.fixtures.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  const failures = [];

  for (const fixture of fixtures) {
    const out = classify(Array.isArray(fixture.messages) ? fixture.messages : []);
    if (out.tag !== fixture.expectedTag) {
      failures.push({ name: fixture.name, expected: fixture.expectedTag, actual: out });
    }
  }

  if (failures.length > 0) {
    console.error('Message class regression failed.');
    for (const f of failures) console.error(JSON.stringify(f, null, 2));
    process.exit(1);
  }
  console.log(`Message class regression passed (${fixtures.length} fixtures).`);
}

main();
