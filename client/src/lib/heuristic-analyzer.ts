import { ScrapedProfile } from '../types/scraper';
import { HeuristicAnalysis, BioRisk, UsernameRisk, CaptionRisk, CommentRisk } from '../types/analysis';
import { analyzeBehavior } from './behavioral-analyzer';

// Keywords for bio risk analysis
const BIO_RISK_KEYWORDS = [
    { keyword: 'crypto', weight: 2 },
    { keyword: 'investment', weight: 2 },
    { keyword: 'telegram', weight: 1.5 },
    { keyword: 'whatsapp', weight: 1.5 },
    { keyword: 'guaranteed', weight: 3 },
    { keyword: 'earn money', weight: 3 },
    { keyword: 'link in bio', weight: 1 },
    { keyword: 'adult', weight: 2.5 },
    { keyword: 'forex', weight: 2.5 },
    { keyword: 'trading', weight: 2 },
    { keyword: 'dm me', weight: 1.5 },
    { keyword: 'click here', weight: 1.5 },
];

// Urgency and emotional manipulation phrases
const URGENCY_PHRASES = ['urgent', 'limited time', 'act now', 'hurry', 'expires', 'last chance', 'asap'];
const MANIPULATION_PHRASES = ['love', 'trust me', 'believe me', 'miss you', 'special connection', 'destiny'];
const SCAM_KEYWORDS = ['verify account', 'confirm identity', 'update payment', 'claim reward', 'congratulations'];

// Sentiment words for caption analysis
const NEGATIVE_WORDS = ['hate', 'angry', 'disgusted', 'terrible', 'awful', 'horrible', 'depressed', 'sad'];
const AGGRESSIVE_WORDS = ['attack', 'destroy', 'kill', 'hate', 'rage', 'fight', 'war'];
const PROMOTIONAL_WORDS = ['buy', 'discount', 'offer', 'sale', 'limited', 'exclusive', 'deal', 'code', 'link'];

// Function to calculate follower/following ratio
function calculateFollowerFollowingRatio(followers: number, following: number): number {
    if (following === 0) {
        return followers > 0 ? Infinity : 0;
    }
    return followers / following;
}

// Function to calculate engagement rate
function calculateEngagementRate(posts: any[], followers: number): number {
    if (followers === 0 || posts.length === 0) {
        return 0;
    }
    const totalLikes = posts.reduce((sum, post) => sum + post.likes, 0);
    const avgLikes = totalLikes / posts.length;
    return (avgLikes / followers) * 100;
}

// Function to score bio risk
function scoreBioRisk(bio: string): BioRisk {
    let score = 0;
    const detectedKeywords = [];
    for (const item of BIO_RISK_KEYWORDS) {
        if (bio.toLowerCase().includes(item.keyword)) {
            score += item.weight;
            detectedKeywords.push(item.keyword);
        }
    }
    return { score, detectedKeywords };
}

// Function to score username risk
function scoreUsernameRisk(username: string): UsernameRisk {
    let score = 0;
    const reasons = [];

    // Check for excessive numbers
    const numberCount = (username.match(/\d/g) || []).length;
    if (numberCount > 4) {
        score += 2;
        reasons.push('Excessive numbers');
    }

    // Check for random patterns (high entropy) - simplified
    if (username.length > 15) {
        score += 1;
        reasons.push('Long username');
    }

    // Check for suspicious terms
    if (/bot|spam|free|follow|fake/i.test(username)) {
        score += 2;
        reasons.push('Suspicious terms detected');
    }

    return { score, reasons };
}

// Function to analyze caption sentiment (lightweight)
function analyzeCaption(caption: string): CaptionRisk {
    let score = 0;
    const reasons = [];
    const captionLower = caption.toLowerCase();
    
    // Check for negative sentiment
    let negativeCount = 0;
    NEGATIVE_WORDS.forEach(word => {
        if (captionLower.includes(word)) negativeCount++;
    });
    if (negativeCount > 1) {
        score += 2;
        reasons.push('Negative sentiment');
    }

    // Check for aggressive tone
    AGGRESSIVE_WORDS.forEach(word => {
        if (captionLower.includes(word)) {
            score += 2;
            reasons.push('Aggressive tone');
        }
    });

    // Check for promotional tone
    let promotionalCount = 0;
    PROMOTIONAL_WORDS.forEach(word => {
        if (captionLower.includes(word)) promotionalCount++;
    });
    if (promotionalCount > 2) {
        score += 2;
        reasons.push('Promotional tone');
    }

    // Detect repeated template captions
    if (caption.length < 10 || /[^a-z\s]/gi.test(caption) && caption.length < 20) {
        score += 1;
        reasons.push('Template-like caption');
    }

    if (caption.toLowerCase().includes('giveaway')) {
        score += 2;
        reasons.push('Giveaway post');
    }

    return { score, reasons };
}

// Function to analyze comment patterns
function analyzeComments(comments: any[]): CommentRisk {
    let score = 0;
    const reasons = [];
    
    if (!comments || comments.length === 0) {
        return { score, reasons };
    }

    const commentTexts = comments.map(c => c.text || '');
    const uniqueComments = new Set(commentTexts);
    
    // Check for repeated identical comments
    if (commentTexts.length > 0 && uniqueComments.size / commentTexts.length < 0.5) {
        score += 3;
        reasons.push('Repeated identical comments');
    }

    // Check for emoji-only spam
    const emojiOnlyComments = commentTexts.filter(c => /^\s*[\u{1F300}-\u{1F9FF}]+\s*$/u.test(c)).length;
    if (emojiOnlyComments / commentTexts.length > 0.3) {
        score += 2;
        reasons.push('Emoji-only spam detected');
    }

    // Check for generic bot comments
    const genericComments = ['nice pic', 'dm me', 'follow me', 'check my profile', 'great post'];
    let genericCount = 0;
    commentTexts.forEach(text => {
        if (genericComments.some(generic => text.toLowerCase().includes(generic))) {
            genericCount++;
        }
    });
    if (genericCount / commentTexts.length > 0.4) {
        score += 2;
        reasons.push('Generic bot-like comments');
    }

    return { score, reasons };
}

// Function to analyze profile picture quality and presence
function analyzeProfilePhoto(hasProfilePic: boolean, postsCount: number): { score: number; reasons: string[] } {
    let score = 0;
    const reasons = [];

    if (!hasProfilePic) {
        score += 20;
        reasons.push('No profile picture');
    }

    // Posts without profile picture is suspicious
    if (!hasProfilePic && postsCount > 5) {
        score += 10;
        reasons.push('Active posts but no profile picture');
    }

    return { score, reasons };
}

// Function to analyze message content for risk factors
export function analyzeMessageContent(messageText: string): {
    spamScore: number;
    urgencyScore: number;
    manipulationScore: number;
    scamScore: number;
    detectedFlags: string[];
} {
    const text = messageText.toLowerCase();
    let spamScore = 0;
    let urgencyScore = 0;
    let manipulationScore = 0;
    let scamScore = 0;
    const detectedFlags: string[] = [];

    // Check urgency phrases
    URGENCY_PHRASES.forEach(phrase => {
        if (text.includes(phrase)) {
            urgencyScore += 10;
            detectedFlags.push(`Urgency: ${phrase}`);
        }
    });

    // Check manipulation phrases
    MANIPULATION_PHRASES.forEach(phrase => {
        if (text.includes(phrase)) {
            manipulationScore += 15;
            detectedFlags.push(`Manipulation: ${phrase}`);
        }
    });

    // Check scam keywords
    SCAM_KEYWORDS.forEach(keyword => {
        if (text.includes(keyword)) {
            scamScore += 20;
            detectedFlags.push(`Scam indicator: ${keyword}`);
        }
    });

    // Check for repeated patterns
    const words = text.split(/\s+/);
    if (words.length > 0) {
        const uniqueWords = new Set(words);
        if (uniqueWords.size / words.length < 0.3) {
            spamScore += 25;
            detectedFlags.push('Repeated word patterns');
        }
    }

    // Check for message length (very short or repetitive)
    if (messageText.length < 20) {
        spamScore += 10;
        detectedFlags.push('Very brief message');
    }

    // Check for ALL CAPS
    if (messageText === messageText.toUpperCase() && messageText.length > 10) {
        urgencyScore += 15;
        detectedFlags.push('All caps message');
    }

    // Check for excessive punctuation
    const punctuationCount = (messageText.match(/[!?]{2,}/g) || []).length;
    if (punctuationCount > 2) {
        urgencyScore += 10;
        detectedFlags.push('Excessive punctuation');
    }

    return {
        spamScore: Math.min(spamScore, 100),
        urgencyScore: Math.min(urgencyScore, 100),
        manipulationScore: Math.min(manipulationScore, 100),
        scamScore: Math.min(scamScore, 100),
        detectedFlags,
    };
}

// Function to calculate overall risk from message patterns
export function analyzeMessagePatterns(messages: string[]): {
    frequency: number;
    repetitionScore: number;
    burstyBehavior: number;
    overallRisk: number;
    flags: string[];
} {
    const flags: string[] = [];
    let repetitionScore = 0;
    let burstyBehavior = 0;
    let overallRisk = 0;

    if (!messages || messages.length === 0) {
        return { frequency: 0, repetitionScore, burstyBehavior, overallRisk, flags };
    }

    // Check for repeated messages
    const uniqueMessages = new Set(messages);
    const repetitionRatio = 1 - (uniqueMessages.size / messages.length);
    repetitionScore = Math.min(100, repetitionRatio * 100);

    if (repetitionScore > 30) {
        flags.push('Repeated message patterns');
    }

    // Check for burst messaging (many in short time)
    if (messages.length > 10) {
        burstyBehavior = Math.min(100, (messages.length / 10) * 20);
        flags.push('High message frequency detected');
    }

    const frequency = messages.length;
    overallRisk = (repetitionScore + burstyBehavior) / 2;

    return { frequency, repetitionScore, burstyBehavior, overallRisk, flags };
}

// Main heuristic analysis function
import { analyzeImage } from './image-analyzer';

//...

async function analyzeProfileImage(profile: ScrapedProfile): Promise<ImageAnalysis | undefined> {
    if (!profile.profilePictureUrl) {
        return undefined;
    }

    try {
        const labels = await analyzeImage(profile.profilePictureUrl);
        // Placeholder for a more sophisticated quality score
        const qualityScore = labels.includes('person') ? 100 : 50;
        return { labels, qualityScore };
    } catch (error) {
        console.error('Image analysis failed:', error);
        return undefined;
    }
}

export async function analyzeHeuristics(profile: ScrapedProfile, accountAgeInDays: number): Promise<HeuristicAnalysis> {
    const imageAnalysis = await analyzeProfileImage(profile);
    const behavioralAnalysis = analyzeBehavior(profile, accountAgeInDays);
    let followerFollowingRatio = calculateFollowerFollowingRatio(profile.followers || 0, profile.following || 0);
    if (!isFinite(followerFollowingRatio) || isNaN(followerFollowingRatio)) followerFollowingRatio = 0;
    followerFollowingRatio = Math.min(Math.max(followerFollowingRatio, 0), 1000);

    let engagementRate = calculateEngagementRate(profile.posts || [], profile.followers || 0);
    if (!isFinite(engagementRate) || isNaN(engagementRate)) engagementRate = 0;
    engagementRate = Math.min(Math.max(engagementRate, 0), 100);

    const bioRisk = scoreBioRisk(profile.bio || '');
    const usernameRisk = scoreUsernameRisk(profile.username || '');
    const photoRisk = analyzeProfilePhoto(!!profile.hasProfilePic, profile.posts ? profile.posts.length : 0);

    const captionAnalyses = profile.posts.map(post => analyzeCaption(post.caption));
    const totalCaptionRisk = captionAnalyses.reduce((sum, analysis) => sum + analysis.score, 0);

    const commentAnalyses = profile.posts.map(post => analyzeComments(post.comments));
    const totalCommentRisk = commentAnalyses.reduce((sum, analysis) => sum + analysis.score, 0);

    // Calculate structural risk (40%)
    let structuralScore = 0;
    if (followerFollowingRatio > 100) structuralScore += 30;
    else if (followerFollowingRatio > 10) structuralScore += 15;
    if (!profile.hasProfilePic) structuralScore += 20;
    if (profile.posts.length < 5) structuralScore += 15;
    if (profile.isPrivate) structuralScore += 10;
    if (engagementRate < 1) structuralScore += 15;

    // Calculate content risk (40%)
    let contentScore = 0;
    contentScore += bioRisk.score * 3;
    contentScore += usernameRisk.score * 2;
    contentScore += Math.min(totalCaptionRisk * 2, 30);
    if (bioRisk.detectedKeywords.length > 2) contentScore += 10;

    // Calculate behavioral risk (20%)
    let behavioralScore = 0;
    const postFrequency = behavioralAnalysis.postFrequency || 0;
    behavioralScore += Math.min((3 - postFrequency) * 10, 30);
    if (behavioralAnalysis.profileCompleteness < 40) behavioralScore += 15;
    if (postFrequency > 10 && profile.posts.length < 3) behavioralScore += 10; // Claims lots of activity but few posts

    // Calculate preliminary risk score
    let preliminaryRiskScore =
        (structuralScore * 0.4) +
        (contentScore * 0.4) +
        (behavioralScore * 0.2) +
        (photoRisk.score * 0.1);
    if (!isFinite(preliminaryRiskScore) || isNaN(preliminaryRiskScore)) preliminaryRiskScore = 0;
    preliminaryRiskScore = Math.min(100, Math.max(0, preliminaryRiskScore));

    return {
        structuralMetrics: {
            followerFollowingRatio,
            engagementRate,
            postFrequency,
            profileCompleteness: behavioralAnalysis.profileCompleteness,
        },
        bioRisk,
        usernameRisk,
        photoRisk,
        captionSentiment: {
            totalScore: totalCaptionRisk,
            analyses: captionAnalyses,
        },
        commentPatterns: {
            totalScore: totalCommentRisk,
            analyses: commentAnalyses,
        },
        structuralRisk: Math.min(100, structuralScore),
        contentRisk: Math.min(100, contentScore),
        behavioralRisk: Math.min(100, behavioralScore),
        preliminaryRiskScore,
    };
}