
export interface HeuristicAnalysis {
    structuralMetrics: StructuralMetrics;
    bioRisk: BioRisk;
    usernameRisk: UsernameRisk;
    captionSentiment: {
        totalScore: number;
        analyses: CaptionRisk[];
    };
    commentPatterns: {
        totalScore: number;
        analyses: CommentRisk[];
    };
    imageAnalysis?: ImageAnalysis; // New field for image analysis
    preliminaryRiskScore: number;
}

export interface StructuralMetrics {
    followerFollowingRatio: number;
    engagementRate: number;
    postFrequency: number;
    profileCompleteness: number;
}

export interface BioRisk {
    score: number;
    detectedKeywords: string[];
}

export interface UsernameRisk {
    score: number;
    reasons: string[];
}

export interface CaptionRisk {
    score: number;
    reasons: string[];
}

export interface CommentRisk {
    score: number;
    reasons: string[];
}

export interface BehavioralAnalysis {
    postFrequency: number;
    profileCompleteness: number;
}

export interface ImageAnalysis {
    labels: string[];
    qualityScore: number; // Placeholder for a more sophisticated quality score
}

// full analysis object returned by backend (if applicable)
export interface Analysis {
    id: number;
    userId: number;
    contentType: "message" | "profile";
    content: string;
    riskScore: number;
    flags: string[];
    explanation: string;
    createdAt: string;
    // optional heuristics and server data
    heuristics?: Record<string, any>;
    structuralRisk?: number;
    contentRisk?: number;
    behavioralRisk?: number;
    photoRisk?: number;
    preliminaryRisk?: number;
    anomalyScore?: number;
    anomalyFlags?: string[];
    historicalComparison?: Record<string, any>;
    modelConfidence?: number;
    riskClassification?: string;
}