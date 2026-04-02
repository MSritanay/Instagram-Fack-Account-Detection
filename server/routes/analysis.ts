
import { log } from '../src/logger';
import express from 'express';
import { db } from '../db';
import { profile_analyses, message_analyses, final_analyses } from '../db/schema';
import { z } from 'zod';

const router = express.Router();

const profileAnalysisSchema = z.object({
    userId: z.string(),
    profileUsername: z.string(),
    hasProfilePic: z.boolean(),
    numsLengthUsername: z.number(),
    fullnameWords: z.number(),
    numsLengthFullname: z.number(),
    nameEqualsUsername: z.boolean(),
    descriptionLength: z.number(),
    externalUrl: z.boolean(),
    isPrivate: z.boolean(),
    postsCount: z.number(),
    followersCount: z.number(),
    followingCount: z.number(),
    reelsCount: z.number(),
    bio: z.string(),
    accountType: z.string(),
    status: z.string(),
    // new heuristic fields
    structuralRisk: z.number().optional(),
    contentRisk: z.number().optional(),
    behavioralRisk: z.number().optional(),
    photoRisk: z.number().optional(),
    preliminaryRisk: z.number().optional(),
    heuristics: z.record(z.any()).optional(),
    // additional server-calculated fields
    anomalyFlags: z.array(z.string()).optional(),
    historicalComparison: z.record(z.any()).optional(),
    modelConfidence: z.number().optional(),
    riskClassification: z.string().optional(),
});

const messageAnalysisSchema = z.object({
    userId: z.string(),
    profileUsername: z.string(),
    riskFactors: z.string(),
    prediction: z.string(),
    // heuristics object from client
    heuristics: z.record(z.any()).optional(),
});

function calculateMessageHeuristics(an: z.infer<typeof messageAnalysisSchema>) {
    // parse riskFactors for counts if JSON or simple text
    let spamScore = 0;
    try {
        const obj = JSON.parse(an.riskFactors);
        spamScore = obj.spamScore || 0;
    } catch {}
    // fallback: if labels appear in text
    if (/spam/i.test(an.riskFactors)) spamScore += 20;
    const overall = Math.min(100, spamScore);
    return { spamScore, overall };
}

const finalAnalysisSchema = z.object({
    userId: z.string(),
    profileUsername: z.string(),
    profileRisk: z.number(),
    messageRisk: z.number(),
    finalRisk: z.number(),
    finalLabel: z.string(),
});

// helper: performs the same heuristic/behaviour calculation server‑side
function calculateProfileHeuristics(an: z.infer<typeof profileAnalysisSchema>) {
    const followerCount = an.followersCount || 0;
    const followingCount = an.followingCount || 1;
    const ratio = followerCount / followingCount;

    let structuralScore = 0;
    if (ratio > 100) structuralScore += 40;
    else if (ratio > 10) structuralScore += 20;
    if (!an.hasProfilePic) structuralScore += 30;
    if (an.postsCount < 5) structuralScore += 10;

    let contentScore = 0;
    const bio = (an.bio || '').toLowerCase();
    const keywords = ['crypto','investment','telegram','whatsapp','guaranteed','earn money','link in bio','adult'];
    keywords.forEach(k => { if (bio.includes(k)) contentScore += 10; });
    if (an.externalUrl) contentScore += 10;
    const username = (an.profileUsername || '').toLowerCase();
    if (/\d{4,}/.test(username)) contentScore += 5;
    if (/bot|spam|free|follow/i.test(username)) contentScore += 10;

    // server doesn't have post captions, so behavioural risk is simplified
    let behavioralScore = 0;
    if (an.postsCount < 3) behavioralScore += 5;

    let photoScore = 0;
    if (!an.hasProfilePic) photoScore += 20;
    if (an.postsCount < 3) photoScore += 10;

    const preliminaryRisk = Math.min(100, structuralScore + contentScore + behavioralScore + photoScore);
    return { structuralScore, contentScore, behavioralScore, photoScore, preliminaryRisk };
}

router.post('/profile', async (req, res) => {
    try {
        const analysis = profileAnalysisSchema.parse(req.body);
        if (!analysis.userId || !analysis.profileUsername) {
            return res.status(400).json({ success: false, error: 'userId and profileUsername required' });
        }
        const serverHeur = calculateProfileHeuristics(analysis);
        log('PROFILE', 'Server heuristics', 'INFO', JSON.stringify(serverHeur));
        if (analysis.heuristics) {
            log('PROFILE', 'Client heuristics', 'INFO', JSON.stringify(analysis.heuristics));
        }

        // historical comparison / anomaly detection
        let anomalyScore = 0;
        const anomalyFlags: string[] = [];
        const historicalComparison: Record<string, any> = {};
        try {
            const previous = await db.select().from(profile_analyses).where(profile_analyses.user_id.eq(analysis.userId)).orderBy(profile_analyses.id.desc()).limit(1);
            if (previous.length > 0) {
                const prev = previous[0];
                // follower spike
                if (prev.followers_count && analysis.followersCount) {
                    const change = (analysis.followersCount - prev.followers_count) / (prev.followers_count || 1);
                    if (isFinite(change) && !isNaN(change)) {
                        historicalComparison.followerChange = change;
                        if (change > 2) { anomalyScore += 50; anomalyFlags.push('Huge follower spike'); }
                        else if (change > 1) { anomalyScore += 20; anomalyFlags.push('Moderate follower increase'); }
                    }
                }
                // post drop
                if (prev.posts_count && analysis.postsCount && analysis.postsCount < prev.posts_count / 2) {
                    anomalyScore += 20;
                    anomalyFlags.push('Post count dropped by >50%');
                    historicalComparison.postDrop = { previous: prev.posts_count, current: analysis.postsCount };
                }
                // privacy toggle
                if (prev.is_private !== analysis.isPrivate) {
                    anomalyScore += 10;
                    anomalyFlags.push('Privacy status changed');
                    historicalComparison.privacyToggled = { from: prev.is_private, to: analysis.isPrivate };
                }
            }
        } catch (histErr) {
            log('PROFILE', 'Historical comparison error', 'WARN', (histErr as Error)?.message || String(histErr));
        }

        // classification and confidence stubs
        let riskClassification = 'unknown';
        if (serverHeur && serverHeur.structuralScore + serverHeur.contentScore > 80) {
            riskClassification = 'scam suspicion';
        } else if (serverHeur && serverHeur.structuralScore > 50) {
            riskClassification = 'bot-like behavior';
        }
        const modelConfidence = 75;

            await db.insert(profile_analyses).values({
                user_id: analysis.userId,
                profile_username: analysis.profileUsername,
                has_profile_pic: analysis.hasProfilePic,
                nums_length_username: analysis.numsLengthUsername,
                fullname_words: analysis.fullnameWords,
                nums_length_fullname: analysis.numsLengthFullname,
                name_equals_username: analysis.nameEqualsUsername,
                description_length: analysis.descriptionLength,
                external_url: analysis.externalUrl,
                is_private: analysis.isPrivate,
                posts_count: analysis.postsCount,
                followers_count: analysis.followersCount,
                following_count: analysis.followingCount,
                reels_count: analysis.reelsCount,
                bio: analysis.bio,
                account_type: analysis.accountType,
                status: analysis.status,
                structural_risk: serverHeur.structuralScore,
                content_risk: serverHeur.contentScore,
                behavioral_risk: serverHeur.behavioralScore,
                photo_risk: serverHeur.photoScore,
                preliminary_risk: serverHeur.preliminaryRisk,
                heuristics: analysis.heuristics || {},
                anomaly_score: anomalyScore,
                anomaly_flags: JSON.stringify(anomalyFlags),
                historical_comparison: JSON.stringify(historicalComparison),
                model_confidence: modelConfidence,
                risk_classification: riskClassification
            });
        res.json({ success: true, heuristics: analysis.heuristics || null, serverHeuristics: serverHeur, anomalyScore });
    } catch (error) {
        log('PROFILE', 'Error', 'ERROR', (error as Error)?.message || String(error));
        const statusCode = (error as any).code === 'UNIQUE constraint failed' ? 409 : 400;
        res.status(statusCode).json({ success: false, error: (error as Error)?.message || 'Unknown error' });
    }
});

router.post('/message', async (req, res) => {
    try {
        const analysis = messageAnalysisSchema.parse(req.body);
        if (!analysis.userId || !analysis.profileUsername) {
            return res.status(400).json({ success: false, error: 'userId and profileUsername required' });
        }
        if (analysis.heuristics) {
            log('MESSAGE', 'Client heuristics', 'INFO', JSON.stringify(analysis.heuristics));
        }
        const serverHeur = calculateMessageHeuristics(analysis);
        log('MESSAGE', 'Server heuristics', 'INFO', JSON.stringify(serverHeur));
        await db.insert(message_analyses).values({
            user_id: analysis.userId,
            profile_username: analysis.profileUsername,
            risk_factors: analysis.riskFactors + (analysis.heuristics ? ` | heuristics:${JSON.stringify(analysis.heuristics)}` : ''),
            prediction: analysis.prediction,
        });
        res.json({ success: true, heuristics: analysis.heuristics || null, serverHeuristics: serverHeur });
    } catch (error) {
        log('MESSAGE', 'Error', 'ERROR', (error as Error)?.message || String(error));
        res.status(400).json({ success: false, error: (error as Error)?.message || 'Unknown error' });
    }
});

router.post('/final', async (req, res) => {
    try {
        const analysis = finalAnalysisSchema.parse(req.body);
        await db.insert(final_analyses).values({
            user_id: analysis.userId,
            profile_username: analysis.profileUsername,
            profile_risk: analysis.profileRisk,
            message_risk: analysis.messageRisk,
            final_risk: analysis.finalRisk,
            final_label: analysis.finalLabel,
        });
        // echo heuristics if caller provided them
        const heur = (req.body as any).heuristics || null;
        res.json({ success: true, heuristics: heur });
    } catch (error) {
        res.status(400).json({ success: false, error });
    }
});

router.get('/final', async (req, res) => {
    try {
        const allFinalAnalyses = await db.select().from(final_analyses);
        res.json(allFinalAnalyses);
    } catch (error) {
        res.status(500).json({ success: false, error });
    }
});

export default router;