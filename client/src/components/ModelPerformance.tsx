import React from 'react';
import './ModelPerformance.css';

const performanceData = [
  { name: 'Logistic Regression', accuracy: '92.24%', dataset: 'train.csv' },
  { name: 'Random Forest', accuracy: '91.38%', dataset: 'train.csv' },
  { name: 'XGBoost', accuracy: '91.38%', dataset: 'train.csv' },
  { name: 'Gradient Boosting', accuracy: '90.52%', dataset: 'train.csv' },
];

const ModelPerformance: React.FC = () => {
  return (
    <div className="model-performance-container">
      <div className="header-3d">
        <h2>Model Performance</h2>
        <div className="scanner-effect"></div>
      </div>
      <div className="performance-grid">
        {performanceData.map((model, index) => (
          <div key={index} className="performance-card">
            <h3>{model.name}</h3>
            <p className="accuracy">Accuracy: {model.accuracy}</p>
            <p className="dataset">Dataset: {model.dataset}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModelPerformance;