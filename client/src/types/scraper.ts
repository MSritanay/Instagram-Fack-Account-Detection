
export interface ScrapedProfile {
    username: string;
    followers: number;
    following: number;
    postsCount: number;
    bio: string;
    bioLength: number;
    urlPresence: boolean;
    isPrivate: boolean;
    profilePictureUrl?: string;
    highlightsCount: number;
    posts: ScrapedPost[];
}

export interface ScrapedPost {
    likes: number;
    comments: ScrapedComment[];
    caption: string;
}

export interface ScrapedComment {
    text: string;
}