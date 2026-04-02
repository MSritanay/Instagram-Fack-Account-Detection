import { useEffect } from 'react';
import './Predictions.css';
import ModelComparison from '../components/ModelComparison';
import ModelPerformance from '../components/ModelPerformance';
import { log } from '../logger';

interface ProfileAnalysis {
  id: number;
  profile_username: string;
  status: string;
  followers_count: number;
  following_count: number;
  posts_count: number;
  reels_count: number;
  bio: string;
  account_type: string;
  created_at: string;
}

interface ProfilePredictionsProps {
  analyses: ProfileAnalysis[];
}

const ProfilePredictions = ({ analyses }: ProfilePredictionsProps) => {
  useEffect(() => {
    if (analyses) {
      log('UI', 'Render Profile Predictions', 'SUCCESS', `Rendered with ${analyses.length} records`);
    }
  }, [analyses]);

  return (
    <div className="predictions-container">
      <div className="header-3d">
        <h1>Profile Predictions</h1>
        <div className="scanner-effect"></div>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Followers</th>
              <th>Following</th>
              <th>Posts</th>
              <th>Bio</th>
              <th>Prediction</th>
              <th>Analyzed On</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map(analysis => (
              <tr key={analysis.id} className="data-row">
                <td>{analysis.profile_username}</td>
                <td>{analysis.followers_count}</td>
                <td>{analysis.following_count}</td>
                <td>{analysis.posts_count}</td>
                <td className="bio-cell">{analysis.bio}</td>
                <td>{analysis.account_type}</td>
                <td>{new Date(analysis.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ModelPerformance /> 
      <ModelComparison />
    </div>
  );
};

export default ProfilePredictions;