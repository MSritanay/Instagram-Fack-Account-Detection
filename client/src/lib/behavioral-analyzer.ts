
import { ScrapedProfile } from '../types/scraper';
import { BehavioralAnalysis } from '../types/analysis';

// Function to estimate post frequency
function estimatePostFrequency(postsCount: number, accountAgeInDays: number): number {
    if (accountAgeInDays === 0) {
        return 0;
    }
    return postsCount / accountAgeInDays;
}

// Function to calculate profile completeness
function calculateProfileCompleteness(profile: ScrapedProfile): number {
    let score = 0;
    if (profile.profilePicturePresence) score += 25;
    if (profile.bio.length > 0) score += 25;
    if (profile.postsCount > 0) score += 25;
    if (profile.followers > 0 && profile.following > 0) score += 25;
    return score;
}

// Main behavioral analysis function
export function analyzeBehavior(profile: ScrapedProfile, accountAgeInDays: number): BehavioralAnalysis {
    const postFrequency = estimatePostFrequency(profile.postsCount, accountAgeInDays);
    const profileCompleteness = calculateProfileCompleteness(profile);

    return {
        postFrequency,
        profileCompleteness,
    };
}