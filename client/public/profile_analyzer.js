import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';

// In this file, we will implement the client-side profile analysis,
// including scraping, feature engineering, and the NLP layer.

console.log("[Instagram Authentication] Profile analyzer script loaded.");

function scrapeProfileData() {
    let profileData = {
        followers: 0,
        following: 0,
        postCount: 0,
        reelCount: 0,
        hasProfilePic: false,
        isPrivate: false,
        bio: '',
        username: '',
        displayName: '',
        scrapeConfidence: 0,
        errors: [] // capture issues for debugging
    };

    // Layer 1: Embedded JSON blobs (highest confidence)
    try {
        const scripts = document.querySelectorAll('script[type="text/javascript"]');
        for (const script of scripts) {
            if (script.textContent.includes('window._sharedData')) {
                const sharedData = JSON.parse(script.textContent.match(/window\._sharedData = (.*);/)[1]);
                const user = sharedData.entry_data.ProfilePage[0].graphql.user;
                profileData = {
                    followers: user.edge_followed_by.count || 0,
                    following: user.edge_follow.count || 0,
                    postCount: user.edge_owner_to_timeline_media.count || 0,
                    reelCount: user.edge_felix_video_timeline.count || 0,
                    hasProfilePic: !!user.profile_pic_url_hd && !user.profile_pic_url_hd.includes('s150x150'),
                    isPrivate: !!user.is_private,
                    bio: user.biography || '',
                    username: user.username || '',
                    displayName: user.full_name || '',
                    scrapeConfidence: 3 // High confidence
                };
                return profileData;
            }
        }
    } catch (e) {
        // JSON blob not found or parsing failed, proceed to next layer
    }

    // Layer 2: Meta tags (medium confidence)
    try {
        const descriptionTag = document.querySelector('meta[property="og:description"]');
        if (descriptionTag) {
            const content = descriptionTag.getAttribute('content');
            const parts = content.split(' - ')[0].split(', ');
            profileData.followers = parseInt(parts[0].split(' ')[0].replace(/,/g, ''));
            profileData.following = parseInt(parts[1].split(' ')[0].replace(/,/g, ''));
            profileData.postCount = parseInt(parts[2].split(' ')[0].replace(/,/g, ''));
            profileData.scrapeConfidence = 2; // Medium confidence
        }
    } catch (e) {
        // Meta tag scraping failed, proceed to next layer
    }

    // Layer 3: DOM selectors (lowest confidence)
    try {
        if (profileData.scrapeConfidence < 2) {
            const listItems = document.querySelectorAll('main header ul li');
            if (listItems.length === 3) {
                profileData.postCount = parseInt(listItems[0].textContent.split(' ')[0].replace(/,/g, '')) || profileData.postCount;
                profileData.followers = parseInt(listItems[1].textContent.split(' ')[0].replace(/,/g, '')) || profileData.followers;
                profileData.following = parseInt(listItems[2].textContent.split(' ')[0].replace(/,/g, '')) || profileData.following;
                profileData.scrapeConfidence = 1; // Low confidence
            } else {
                profileData.errors.push('Unexpected count list length: ' + listItems.length);
            }
        }
        if (!profileData.username) {
            const usernameElem = document.querySelector('main header h2');
            profileData.username = usernameElem ? usernameElem.textContent : profileData.username;
            if (!profileData.username) profileData.errors.push('username not found');
        }
        if (!profileData.displayName) {
            const displayNameElement = document.querySelector('main header h1');
            if (displayNameElement) {
                profileData.displayName = displayNameElement.textContent;
            } else {
                profileData.errors.push('displayName not found');
            }
        }
        if (!profileData.bio) {
            const bioElement = document.querySelector('main header div > span');
            if (bioElement) {
                profileData.bio = bioElement.textContent;
            } else {
                profileData.errors.push('bio not found');
            }
        }
    } catch (e) {
        // DOM scraping failed
    }

    return profileData;
}

function engineerFeatures(profileData) {
    const features = {};

    // safe defaults
    const username = profileData.username || '';
    const displayName = profileData.displayName || '';
    const bio = profileData.bio || '';
    const followers = Number(profileData.followers) || 0;
    const following = Number(profileData.following) || 0;

    // Username and display name digit ratios
    features.usernameDigitRatio = username.length > 0 ? ((username.match(/\d/g) || []).length / username.length) : 0;
    features.displayNameDigitRatio = displayName.length > 0 ? ((displayName.match(/\d/g) || []).length / displayName.length) : 0;

    // Name similarity
    features.nameSimilarity = username.toLowerCase() === displayName.toLowerCase() ? 1 : 0;

    // Bio length
    features.bioLength = bio.length;

    // URL presence in bio
    features.hasUrlInBio = /https?:\/\//.test(bio) ? 1 : 0;

    // Follower to following ratio (clamp to [0,1000])
    const ratio = following + 1 === 0 ? 0 : followers / (following + 1);
    features.followerFollowingRatio = Math.min(Math.max(ratio, 0), 1000);

    // Convert booleans to 0/1
    features.hasProfilePic = profileData.hasProfilePic ? 1 : 0;
    features.isPrivate = profileData.isPrivate ? 1 : 0;

    return { ...profileData, ...features };
}

let useModel = null;
async function loadUseModel() {
    if (useModel) {
        return useModel;
    }
    useModel = await use.load();
    return useModel;
}

async function analyzeBioSemantics(bio) {
    const model = await loadUseModel();
    const embeddings = await model.embed([bio]);
    const bioEmbedding = embeddings.arraySync()[0];

    // Pre-defined scam and bot bio templates (replace with your actual templates)
    const scamTemplates = [
        "Click the link in my bio for a free gift!",
        "DM me for investment opportunities.",
        "Follow me for a chance to win $1000."
    ];
    const botTemplates = [
        "I'm a bot.",
        "This is an automated account.",
        "I post random stuff."
    ];

    const scamEmbeddings = await model.embed(scamTemplates);
    const botEmbeddings = await model.embed(botTemplates);

    const scamSimilarities = scamEmbeddings.arraySync().map(embedding => cosineSimilarity(bioEmbedding, embedding));
    const botSimilarities = botEmbeddings.arraySync().map(embedding => cosineSimilarity(bioEmbedding, embedding));

    return {
        scamSimilarity: Math.max(...scamSimilarities),
        botSimilarity: Math.max(...botSimilarities),
        semanticAnomalyScore: 0 // Placeholder for anomaly detection
    };
}

function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}
