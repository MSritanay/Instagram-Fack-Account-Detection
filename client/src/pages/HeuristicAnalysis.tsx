
import React from 'react';
import { useLocation } from 'react-router-dom';
import { HeuristicAnalysis } from '../../types/analysis';

const HeuristicAnalysisPage: React.FC = () => {
    const location = useLocation();
    const analysis: HeuristicAnalysis = location.state?.analysis;

    if (!analysis) {
        return <div>No analysis data available.</div>;
    }

    return (
        <div>
            <h1>Heuristic Analysis</h1>
            <h2>Preliminary Risk Score: {analysis.preliminaryRiskScore.toFixed(2)}</h2>

            <div>
                <h3>Structural Metrics</h3>
                <p>Follower/Following Ratio: {analysis.structuralMetrics.followerFollowingRatio.toFixed(2)}</p>
                <p>Engagement Rate: {analysis.structuralMetrics.engagementRate.toFixed(2)}%</p>
            </div>

            <div>
                <h3>Bio Risk</h3>
                <p>Score: {analysis.bioRisk.score}</p>
                <p>Detected Keywords: {analysis.bioRisk.detectedKeywords.join(', ')}</p>
            </div>

            <div>
                <h3>Username Risk</h3>
                <p>Score: {analysis.usernameRisk.score}</p>
                <p>Reasons: {analysis.usernameRisk.reasons.join(', ')}</p>
            </div>

            <div>
                <h3>Caption Sentiment</h3>
                <p>Total Score: {analysis.captionSentiment.totalScore}</p>
            </div>

            <div>
                <h3>Comment Patterns</h3>
                <p>Total Score: {analysis.commentPatterns.totalScore}</p>
            </div>
            <div>
                <h3>Image Analysis</h3>
                {analysis.imageAnalysis ? (
                    <>
                        <p>Quality Score: {analysis.imageAnalysis.qualityScore}</p>
                        <p>Detected Labels: {analysis.imageAnalysis.labels.join(', ')}</p>
                    </>
                ) : (
                    <p>No image analysis data available.</p>
                )}
            </div>
        </div>
    );
};

export default HeuristicAnalysisPage;