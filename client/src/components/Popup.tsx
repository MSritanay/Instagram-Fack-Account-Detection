import React, { useEffect } from 'react';
import './Popup.css';

interface PopupProps {
    message: string;
    type: 'success' | 'error';
    onClose: () => void;
}

const Popup: React.FC<PopupProps> = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 5000);

        return () => {
            clearTimeout(timer);
        };
    }, [onClose]);

    return (
        <div className={`popup-container ${type}`}>
            <div className="popup-content">
                <p>{message}</p>
                <button onClick={onClose}>&times;</button>
            </div>
        </div>
    );
};

export default Popup;