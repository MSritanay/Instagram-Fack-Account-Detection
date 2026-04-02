
import React from 'react';
import './FollowerPopup.css';

interface Follower {
  id: number;
  name: string;
  avatar: string;
}

interface FollowerPopupProps {
  followers: Follower[];
  onClose: () => void;
}

const FollowerPopup: React.FC<FollowerPopupProps> = ({ followers, onClose }) => {
  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <div className="popup-header">
          <h2>Followers</h2>
          <button onClick={onClose} className="close-button">&times;</button>
        </div>
        <div className="popup-body">
          {followers.map(follower => (
            <div key={follower.id} className="follower-item">
              <img src={follower.avatar} alt={follower.name} className="follower-avatar" />
              <span>{follower.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FollowerPopup;