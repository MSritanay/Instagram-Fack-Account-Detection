import { useState, useEffect } from 'react';
import modelData from '../modelData.json';
import './ModelInfo.css';

interface Model {
  name: string;
  accuracy: number;
  dataset: string;
}

const ModelInfo = () => {
  const [models, setModels] = useState<Model[]>([]);

  useEffect(() => {
    setModels(modelData);
  }, []);

  return (
    <div className="model-info-container">
      <div className="header-3d">
        <h2>Model Performance</h2>
        <div className="scanner-effect"></div>
      </div>
      <div className="model-cards-container">
        {models.map((model, index) => (
          <div key={index} className="model-card" style={{ animationDelay: `${index * 0.1}s` }}>
            <div className="model-card-header">
              <h3>{model.name}</h3>
            </div>
            <div className="model-card-body">
              <p>Accuracy: <span className="accuracy-score">{model.accuracy}%</span></p>
              <p>Dataset: {model.dataset}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModelInfo;