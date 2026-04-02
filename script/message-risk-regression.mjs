import fs from 'node:fs';
import path from 'node:path';

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeMessageTextForDetection(value) {
  const charMap = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
  let text = String(value || '').normalize('NFKC').toLowerCase();
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '');
  text = text.replace(/[–—−]/g, '-');
  text = text
    .replace(/hxxps?:\/\//g, 'https://')
    .replace(/\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+/g, '.')
    .replace(/\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+/g, '@');
  text = text.replace(/(\d)\s*-\s*(\d)/g, '$1 to $2');
  text = text.replace(/[013457@$]/g, (ch) => charMap[ch] || ch);
  text = text.replace(/[_\-\.\s]{2,}/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function countKeywordHits(messages, terms) {
  const detectionSource = `${messages.map((msg) => String(msg || '').toLowerCase()).join('\n')}\n${normalizeMessageTextForDetection(messages.join('\n'))}`;
  const uniqueTerms = Array.from(new Set((terms || []).map((term) => String(term || '').toLowerCase()).filter(Boolean)));
  return uniqueTerms.reduce((acc, term) => acc + (detectionSource.includes(term) ? 1 : 0), 0);
}

function countPatternHitsByMessage(messages, regex) {
  if (!(regex instanceof RegExp)) return 0;
  const uniqueNormalizedMessages = Array.from(new Set(
    (messages || [])
      .map((msg) => normalizeMessageTextForDetection(msg))
      .map((msg) => String(msg || '').trim())
      .filter(Boolean),
  ));
  const safeRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  let hits = 0;
  for (const text of uniqueNormalizedMessages) {
    safeRegex.lastIndex = 0;
    if (safeRegex.test(text)) hits += 1;
  }
  return hits;
}

function evaluateRisk(messages) {
  const joined = messages.join('\n');
  const loweredJoined = joined.toLowerCase();
  const normalized = normalizeMessageTextForDetection(joined);
  const detectionSource = `${loweredJoined}\n${normalized}`;

  const links = detectionSource.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) || [];
  const suspiciousLinkMatches = detectionSource.match(/bit\.ly|tinyurl|t\.me|wa\.me|cutt\.ly|rb\.gy|goo\.gl|shorturl|is\.gd/g) || [];
  const riskyTldMatches = detectionSource.match(/\.(xyz|top|click|work|loan|gq|tk|cf|ml|ga|buzz|rest|cam|ru)\b/g) || [];
  const authorityCodePatternMatches = detectionSource.match(/(security team|support team|official|admin)[\s\S]{0,80}(code|verify|verification|confirm)/g) || [];
  const helpTransferPatternMatches = detectionSource.match(/(share|send|tell)[\s\S]{0,35}(one sent to you|the code|code sent|verification code|code they sent)/g) || [];
  const giveawayTrapPatternMatches = detectionSource.match(/(you won|congratulations|reward|giveaway|profit daily|trading group)/g) || [];
  const walletFreezePatternMatches = detectionSource.match(/wallet.{0,30}(frozen|blocked|lock)/g) || [];
  const hijackSetupPatternMatches = detectionSource.match(/quick question[\s\S]{0,80}(verify|binance|wallet)/g) || [];
  const suspiciousDomainTextMatches = detectionSource.match(/(b1nance|binance[-_.]support|verify-user|support[-_.]login)/g) || [];
  const verificationContextMatches = detectionSource.match(/(wallet verification|verify wallet|account verification|verify account)/g) || [];

  const credentialKeywords = ['password', 'otp', 'verification code', '2fa', 'login', 'bank account', 'pin', 'cvv', 'seed phrase', 'recovery phrase'];
  const otpKeywords = ['otp', 'verification code', '2fa', 'one time password', 'security code', 'confirm code'];
  const cryptoContextKeywords = ['crypto', 'wallet', 'binance', 'exchange', 'usdt', 'bitcoin', 'seed phrase', 'metamask', 'trust wallet', 'coinbase'];
  const pressureKeywords = [
    'send money', 'wire', 'transfer', 'processing fee', 'advance payment', 'immediately pay',
    'hurry', 'urgent', 'frozen', 'release payment', 'pay now', 'final warning', 'last chance',
  ];
  const impersonationKeywords = ['support', 'security team', 'official', 'admin', 'help center', 'service desk', 'compliance team'];
  const credentialTransferKeywords = ['send otp', 'share otp', 'send code', 'share code', 'give otp', 'give code', 'confirm code', 'provide code', 'forward otp', 'seed phrase', 'recovery phrase'];
  const genericCodeRequestKeywords = ['confirm your code', 'verify your code', 'provide your code', 'submit code', 'account code'];
  const platformSwitchKeywords = ['telegram', 't.me', 'whatsapp', 'wa.me', 'signal', 'discord'];
  const redirectionIntentKeywords = ['continue on', 'message me on', 'chat on', 'dm on', 'switch to', 'move to', 'not secure here', 'apply telegram', 'contact on telegram', 'reach on telegram'];
  const recruitmentScamKeywords = [
    'business partner', 'business partners', 'daily income', 'stable income', 'earn 1000', 'earn 1000+',
    'part-time', 'part time', '3-5 hours', '3 to 5 hours', 'targets', 'team building',
    'apply telegram', 'contact us now', 'serious partners', 'upi',
  ];
  const incomeClaimKeywords = [
    'daily income', 'stable daily income', 'stable income', 'earn 1000', 'earn 1000+',
    'inr daily', 'per day', 'daily payout', 'guaranteed income', 'guaranteed profit',
  ];
  const timeBaitKeywords = [
    '3-5 hours', '3 to 5 hours', 'hours per day', 'only 3', 'part-time', 'part time',
    'no experience required',
  ];
  const mlmGrowthKeywords = [
    'build and lead a team', 'team building', 'growing team', 'join our growing team',
    'the more you grow the more you earn', 'targets', 'daily & monthly targets', 'serious partners',
  ];
  const safetyNegationKeywords = ['do not share otp', "don't share otp", 'never share otp', 'do not send otp', 'never send otp', 'dont send code', 'do not give code'];
  const reportingContextKeywords = ['i got a message', 'someone messaged me', 'they asked me', 'he said', 'she said', 'looks strange', 'is this scam', 'is this legit', 'have you seen this'];

  const credentialHits = countKeywordHits(messages, credentialKeywords);
  const otpKeywordHits = countKeywordHits(messages, otpKeywords);
  const cryptoContextHits = countKeywordHits(messages, cryptoContextKeywords);
  const pressureHitsByKeyword = countKeywordHits(messages, pressureKeywords);
  const pressurePatternHits = countPatternHitsByMessage(messages, /\b(send\s*money|wire|transfer|advance\s*payment|processing\s*fee|release\s*payment|pay\s*now|hurry|urgent|final\s*warning|last\s*chance)\b/g);
  const pressureHits = Math.max(pressureHitsByKeyword, pressurePatternHits);
  const impersonationHits = countKeywordHits(messages, impersonationKeywords);
  const credentialTransferHits = countKeywordHits(messages, credentialTransferKeywords);
  const genericCodeRequestHits = countKeywordHits(messages, genericCodeRequestKeywords);
  const platformSwitchHits = countKeywordHits(messages, platformSwitchKeywords);
  const redirectionIntentHits = countKeywordHits(messages, redirectionIntentKeywords);
  const recruitmentScamHits = countKeywordHits(messages, recruitmentScamKeywords);
  const incomeClaimHitsByKeyword = countKeywordHits(messages, incomeClaimKeywords);
  const incomeClaimPatternHits = countPatternHitsByMessage(messages, /\b((earn|make)\s*(up\s*to|upto)?\s*(?:₹|rs\.?|inr)?\s*\d+(?:[.,]\d+)?\s*[k]?\+?\s*(inr|rs|rupees)?\s*(daily|per day|monthly|per month)?|stable\s*daily\s*income|daily\s*income|daily\s*payout|guaranteed\s*(income|profit))\b/g);
  const incomeClaimHits = Math.max(incomeClaimHitsByKeyword, incomeClaimPatternHits);
  const timeBaitHitsByKeyword = countKeywordHits(messages, timeBaitKeywords);
  const timeBaitPatternHits = countPatternHitsByMessage(messages, /\b((only|just)?\s*\d+\s*(to|-)\s*\d+\s*hours?\s*(daily|per day)?|(only|just)?\s*\d+\s*hours?\s*(daily|per day)?|part\s*[- ]?time|few\s*hours?\s*(daily|per day))\b/g);
  const timeBaitHits = Math.max(timeBaitHitsByKeyword, timeBaitPatternHits);
  const mlmGrowthHitsByKeyword = countKeywordHits(messages, mlmGrowthKeywords);
  const mlmGrowthPatternHits = countPatternHitsByMessage(messages, /\b((build|lead)\s*a\s*team|join\s*our\s*growing\s*team|the\s*more\s*you\s*grow\s*the\s*more\s*you\s*earn|daily\s*&?\s*monthly\s*targets?)\b/g);
  const mlmGrowthHits = Math.max(mlmGrowthHitsByKeyword, mlmGrowthPatternHits);
  const safetyNegationHits = countKeywordHits(messages, safetyNegationKeywords);
  const reportingContextHits = countKeywordHits(messages, reportingContextKeywords);

  const repetitionRatio = messages.length > 0 ? 1 - (new Set(messages.map((m) => String(m || '').trim().toLowerCase())).size / messages.length) : 0;
  const botBurstHits = repetitionRatio >= 0.45 ? 1 : 0;

  const otpCryptoComboDetected = otpKeywordHits > 0 && cryptoContextHits > 0;
  const conversationRiskSignalCount = [
    otpCryptoComboDetected,
    otpKeywordHits > 0 && (pressureHits > 0 || impersonationHits > 0),
    credentialHits > 0 && cryptoContextHits > 0,
    credentialTransferHits > 0 && (impersonationHits > 0 || pressureHits > 0),
  ].filter(Boolean).length;
  const conversationRiskBoost = conversationRiskSignalCount > 0 ? Math.min(16, conversationRiskSignalCount * 4) : 0;

  const contextualSafetyShield = clampNumber(
    ((safetyNegationHits > 0) ? Math.min(18, safetyNegationHits * 10) : 0) +
    ((reportingContextHits > 0 && credentialTransferHits === 0 && suspiciousLinkMatches.length === 0 && credentialHits <= 1 && cryptoContextHits === 0)
      ? Math.min(12, reportingContextHits * 6)
      : 0),
    0,
    24,
  );

  const baseRisk = 6;
  const credentialComponent = Math.min(35, credentialHits * 10);
  const transferComponent = Math.min(30, credentialTransferHits * 12);
  const codeRequestComponent = Math.min(18, genericCodeRequestHits * 8);
  const impersonationComponent = Math.min(18, impersonationHits * 6);
  const pressureComponent = Math.min(18, pressureHits * 6);
  const financialComponent = Math.min(28, (cryptoContextHits * 4) + (giveawayTrapPatternMatches.length * 7) + (verificationContextMatches.length * 5));
  const recruitmentComponent = Math.min(28, recruitmentScamHits * 8);
  const incomeClaimComponent = Math.min(24, incomeClaimHits * 9);
  const timeBaitComponent = Math.min(14, timeBaitHits * 5);
  const mlmGrowthComponent = Math.min(18, mlmGrowthHits * 6);
  const linkComponent =
    Math.min(16, links.length * 4) +
    Math.min(20, suspiciousLinkMatches.length * 10) +
    Math.min(16, riskyTldMatches.length * 8) +
    Math.min(12, suspiciousDomainTextMatches.length * 6);
  const platformSwitchComponent =
    ((platformSwitchHits > 0 && redirectionIntentHits > 0) ? 12 : 0) +
    Math.min(8, platformSwitchHits * 2);
  const socialEngineeringComponent =
    Math.min(16, authorityCodePatternMatches.length * 8) +
    Math.min(14, helpTransferPatternMatches.length * 7) +
    Math.min(10, walletFreezePatternMatches.length * 5) +
    Math.min(8, hijackSetupPatternMatches.length * 4);
  const botComponent = botBurstHits > 0 ? 18 : 0;

  let risk = baseRisk +
    credentialComponent +
    transferComponent +
    codeRequestComponent +
    impersonationComponent +
    pressureComponent +
    financialComponent +
    recruitmentComponent +
    incomeClaimComponent +
    timeBaitComponent +
    mlmGrowthComponent +
    linkComponent +
    platformSwitchComponent +
    socialEngineeringComponent +
    botComponent +
    conversationRiskBoost -
    contextualSafetyShield;

  let hardRiskRuleApplied = false;
  if (otpCryptoComboDetected && risk < 60) {
    risk = 60;
    hardRiskRuleApplied = true;
  }
  if (otpCryptoComboDetected && credentialHits > 0 && risk < 70) {
    risk = 70;
    hardRiskRuleApplied = true;
  }
  if (credentialTransferHits > 0 && (impersonationHits > 0 || pressureHits > 0 || cryptoContextHits > 0) && risk < 75) {
    risk = 75;
    hardRiskRuleApplied = true;
  }
  if (links.length > 0 && credentialHits > 0 && risk < 70) {
    risk = 70;
    hardRiskRuleApplied = true;
  }
  if (authorityCodePatternMatches.length > 0 && (genericCodeRequestHits > 0 || credentialTransferHits > 0) && risk < 70) {
    risk = 70;
    hardRiskRuleApplied = true;
  }
  if (helpTransferPatternMatches.length > 0 && risk < 70) {
    risk = 70;
    hardRiskRuleApplied = true;
  }
  if (platformSwitchHits > 0 && redirectionIntentHits > 0 && (/(verify|verification|code|wallet)/.test(detectionSource)) && risk < 45) {
    risk = 45;
    hardRiskRuleApplied = true;
  }
  if (walletFreezePatternMatches.length > 0 && (otpKeywordHits > 0 || genericCodeRequestHits > 0 || credentialTransferHits > 0) && risk < 70) {
    risk = 75;
    hardRiskRuleApplied = true;
  }
  if (suspiciousDomainTextMatches.length > 0 && (credentialHits > 0 || credentialTransferHits > 0) && risk < 75) {
    risk = 75;
    hardRiskRuleApplied = true;
  }
  if (giveawayTrapPatternMatches.length > 0 && (credentialHits > 0 || otpKeywordHits > 0 || verificationContextMatches.length > 0) && risk < 75) {
    risk = 75;
    hardRiskRuleApplied = true;
  }
  if ((giveawayTrapPatternMatches.length > 0 || verificationContextMatches.length > 0) && cryptoContextHits > 0 && risk < 55) {
    risk = 55;
    hardRiskRuleApplied = true;
  }
  if (recruitmentScamHits >= 2 && platformSwitchHits > 0 && pressureHits > 0 && risk < 75) {
    risk = 75;
    hardRiskRuleApplied = true;
  }
  if (recruitmentScamHits >= 2 && platformSwitchHits > 0 && incomeClaimHits > 0 && risk < 75) {
    risk = 75;
    hardRiskRuleApplied = true;
  }
  if (recruitmentScamHits >= 2 && platformSwitchHits > 0 && risk < 60) {
    risk = 60;
    hardRiskRuleApplied = true;
  }
  if (hijackSetupPatternMatches.length > 0 && cryptoContextHits > 0 && risk < 45) {
    risk = 45;
    hardRiskRuleApplied = true;
  }
  if (botBurstHits > 0 && credentialTransferHits > 0 && risk < 70) {
    risk = 70;
    hardRiskRuleApplied = true;
  }

  risk = clampNumber(Math.round(risk), 0, 100);
  const riskClass = risk >= 70 ? 'high-risk' : risk >= 40 ? 'suspicious' : 'likely-human';

  return {
    risk,
    riskClass,
    otpCryptoComboDetected,
    hardRiskRuleApplied,
    components: {
      baseRisk,
      credentialComponent,
      transferComponent,
      codeRequestComponent,
      impersonationComponent,
      pressureComponent,
      financialComponent,
      recruitmentComponent,
      incomeClaimComponent,
      timeBaitComponent,
      mlmGrowthComponent,
      linkComponent,
      platformSwitchComponent,
      socialEngineeringComponent,
      botComponent,
      conversationRiskBoost,
      contextualSafetyShield,
    },
  };
}

function main() {
  const fixturesPath = path.resolve('script', 'message-risk-regression.fixtures.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  const failures = [];

  for (const fixture of fixtures) {
    const result = evaluateRisk(Array.isArray(fixture.messages) ? fixture.messages : []);
    const inRange = result.risk >= Number(fixture.minRisk) && result.risk <= Number(fixture.maxRisk);
    const classMatch = result.riskClass === String(fixture.expectedRiskClass);

    if (!inRange || !classMatch) {
      failures.push({
        name: fixture.name,
        expected: {
          minRisk: fixture.minRisk,
          maxRisk: fixture.maxRisk,
          riskClass: fixture.expectedRiskClass,
        },
        actual: result,
      });
    }
  }

  if (failures.length > 0) {
    console.error('Message risk regression failed.');
    for (const failure of failures) {
      console.error(JSON.stringify(failure, null, 2));
    }
    process.exit(1);
  }

  console.log(`Message risk regression passed (${fixtures.length} fixtures).`);
}

main();
