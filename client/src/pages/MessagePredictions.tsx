import { useEffect } from 'react';
import './Predictions.css';
import { log } from '../logger';

interface MessageAnalysis {
  id: number;
  profile_username: string;
  risk_factors: string;
  prediction: string;
  created_at: string;
}

interface MessagePredictionsProps {
  analyses: MessageAnalysis[];
}

const MessagePredictions = ({ analyses }: MessagePredictionsProps) => {
  useEffect(() => {
    const startTime = performance.now();
    if (analyses) {
      const endTime = performance.now();
      const queryTime = endTime - startTime;
      log('UI', 'Render Heuristic Message Analysis', 'SUCCESS', `Rendered with ${analyses.length} records in ${queryTime.toFixed(2)}ms`);
    } else {
      log('UI', 'Render Heuristic Message Analysis', 'FAILED', 'Render failed due to no analysis data');
    }
  }, [analyses]);

  return (
    <div className="predictions-container">
      <div className="header-3d">
        <h1>Heuristic Message Analysis</h1>
        <div className="scanner-effect"></div>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Risk Factors</th>
              <th>Heuristic Outcome</th>
              <th>Analyzed On</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map(analysis => (
              <tr key={analysis.id} className="data-row">
                <td>{analysis.profile_username}</td>
                <td>{JSON.parse(analysis.risk_factors).join(', ')}</td>
                <td>{analysis.prediction}</td>
                <td>{new Date(analysis.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MessagePredictions;