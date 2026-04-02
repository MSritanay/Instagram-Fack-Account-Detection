import React, { useEffect, useMemo } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { log } from '../logger';
import './Predictions.css';

ChartJS.register(ArcElement, Tooltip, Legend);

interface FinalAnalysis {
  id: number;
  user_id: string;
  profile_username: string;
  profile_risk: number;
  message_risk: number;
  final_risk: number;
  final_label: string;
  created_at: string;
}

interface FinalPredictionsProps {
  analyses: FinalAnalysis[];
}

const FinalPredictions: React.FC<FinalPredictionsProps> = ({ analyses }) => {
  useEffect(() => {
    if (analyses && analyses.length > 0) {
      log('UI', 'Render Final Predictions', 'SUCCESS', `Final predictions visualization rendered with ${analyses.length} records.`);
    } else {
      log('UI', 'Render Final Predictions', 'FAILED', 'Render failed due to no analysis data.');
    }
  }, [analyses]);

  const latestAnalysis = useMemo(() => {
    if (!analyses || analyses.length === 0) return null;
    const sortedAnalyses = [...analyses].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return sortedAnalyses[0];
  }, [analyses]);

  const pieChartData = useMemo(() => {
    if (!latestAnalysis) return null;

    log('UI', 'Combine Scores', 'STARTED', `Combining profile risk (${latestAnalysis.profile_risk}) and message risk (${latestAnalysis.message_risk}).`);
    const weightingFormula = 'Final Risk = (Profile Risk * 0.3) + (Message Risk * 0.7)';
    log('UI', 'Apply Weighting', 'SUCCESS', `Using formula: ${weightingFormula}`);
    
    const finalRisk = (latestAnalysis.profile_risk * 0.3) + (latestAnalysis.message_risk * 0.7);
    log('UI', 'Calculate Final Score', 'SUCCESS', `Final risk score produced: ${finalRisk.toFixed(2)}`);

    const data = {
      labels: ['Profile Risk', 'Message Risk'],
      datasets: [
        {
          data: [latestAnalysis.profile_risk, latestAnalysis.message_risk],
          backgroundColor: ['rgba(255, 99, 132, 0.7)', 'rgba(54, 162, 235, 0.7)'],
          borderColor: ['rgba(255, 99, 132, 1)', 'rgba(54, 162, 235, 1)'],
          borderWidth: 1,
        },
      ],
    };
    log('UI', 'Prepare Visualization', 'SUCCESS', 'Pie chart data prepared.');
    return data;
  }, [latestAnalysis]);

  if (!analyses || analyses.length === 0) {
    return <div className="no-data">No final predictions available.</div>;
  }

  return (
    <div className="predictions-container">
      <div className="header-3d">
        <h1>Final Predictions</h1>
        <div className="scanner-effect"></div>
      </div>
      
      {latestAnalysis && pieChartData && (
        <div className="chart-container" style={{ maxWidth: '400px', margin: '20px auto' }}>
          <h3 style={{ textAlign: 'center' }}>Risk Contribution of Latest Analysis for {latestAnalysis.profile_username}</h3>
          <Pie data={pieChartData} />
          <div style={{ textAlign: 'center', marginTop: '10px' }}>
            <h4>Final Risk Score: {latestAnalysis.final_risk.toFixed(2)}%</h4>
            <p><strong>Label:</strong> {latestAnalysis.final_label}</p>
          </div>
        </div>
      )}

      <div className="table-container">
        <table className="predictions-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Profile Risk</th>
              <th>Message Risk</th>
              <th>Final Risk</th>
              <th>Final Label</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((analysis) => (
              <tr key={analysis.id}>
                <td>{analysis.id}</td>
                <td>{analysis.profile_username}</td>
                <td>{analysis.profile_risk.toFixed(2)}%</td>
                <td>{analysis.message_risk.toFixed(2)}%</td>
                <td>{analysis.final_risk.toFixed(2)}%</td>
                <td>{analysis.final_label}</td>
                <td>{new Date(analysis.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FinalPredictions;
