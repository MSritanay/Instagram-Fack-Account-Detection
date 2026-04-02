import { Router } from 'express';
import axios from 'axios';

const router = Router();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function axiosGetWithRetry(url: string, config: any, retries = 3, backoffMs = 1000) {
    try {
        return await axios.get(url, config);
    } catch (error: any) {
        const status = error?.response?.status;
        if (status === 429 && retries > 0) {
            await sleep(backoffMs);
            return axiosGetWithRetry(url, config, retries - 1, backoffMs * 2);
        }
        throw error;
    }
}

router.post('/analyze-instagram', async (req, res) => {
    const { username, userId } = req.body;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    try {
        const { data } = await axiosGetWithRetry(
            `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
            {
                headers: {
                    'x-ig-app-id': '936619743392459',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            },
        );

        const userData = data.data.user;

        const hasProfilePic = !userData.has_anonymous_profile_picture;
        const reelsCount = userData.edge_felix_video_timeline ? userData.edge_felix_video_timeline.count : 0;

        // Build a small timeline sample for T3 / T4 evidence
        const timelineEdges = (userData.edge_owner_to_timeline_media?.edges ?? []).map((edge: any) => {
            const node = edge.node;
            return {
                id: node.id,
                takenAt: node.taken_at_timestamp,
                likeCount: node.edge_liked_by?.count ?? 0,
                commentCount: node.edge_media_to_comment?.count ?? 0,
                caption: node.edge_media_to_caption?.edges?.[0]?.node?.text ?? '',
            };
        });

        const timestamps = timelineEdges
            .map((post: any) => post.takenAt)
            .filter((t: any) => typeof t === 'number');

        const lastPostTimestamp = timestamps.length ? Math.max(...timestamps) : null;
        const firstPostTimestamp = timestamps.length ? Math.min(...timestamps) : null;

        const activeDays =
            lastPostTimestamp && firstPostTimestamp
                ? Math.max(1, Math.ceil((lastPostTimestamp - firstPostTimestamp) / 86400))
                : null;
        const postsPerDay = activeDays ? Number((timelineEdges.length / activeDays).toFixed(3)) : null;

        const totalLikes = timelineEdges.reduce((acc: number, p: any) => acc + (p.likeCount ?? 0), 0);
        const totalComments = timelineEdges.reduce((acc: number, p: any) => acc + (p.commentCount ?? 0), 0);
        const followers = userData.edge_followed_by?.count ?? 0;

        const engagementRate = followers ? Number(((totalLikes + totalComments) / followers).toFixed(6)) : null;

        // Call the /predict endpoint internally
        const predictionResponse = await axios.post('http://localhost:5000/predict', {
            userId: userId,
            username: userData.username,
            fullName: userData.full_name,
            bio: userData.biography,
            hasProfilePic: hasProfilePic,
            private: userData.is_private,
            externalUrl: userData.external_url,
            posts: userData.edge_owner_to_timeline_media.count,
            followers: followers,
            following: userData.edge_follow.count > 0 ? userData.edge_follow.count - 1 : 0,
            reels: reelsCount,
            timelineSamples: timelineEdges,
        });

        const accountType = predictionResponse.data.prediction === 1 ? 'Bot' : 'Human';

        const analysis = {
            username: userData.username,
            private: userData.is_private,
            hasProfilePic: hasProfilePic,
            posts: userData.edge_owner_to_timeline_media.count,
            followers: userData.edge_followed_by.count,
            following: userData.edge_follow.count,
            reels: reelsCount,
            bio: userData.biography,
            fullName: userData.full_name,
            externalUrl: userData.external_url,
            accountType: accountType,
            // Added T3/T4 evidence fields
            t3_activity: {
                lastPostTimestamp,
                firstPostTimestamp,
                postsPerDay,
                activeDays,
            },
            t4_engagement: {
                totalLikes,
                totalComments,
                engagementRate,
                samples: timelineEdges.slice(0, 10),
            },
        };

        res.json(analysis);
    } catch (error) {
        console.error('Error fetching Instagram data or getting prediction:', error);
        res.status(500).json({ error: 'Failed to fetch Instagram data or get prediction' });
    }
});

export default router;