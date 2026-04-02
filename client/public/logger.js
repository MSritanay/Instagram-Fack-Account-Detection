const logToServer = (level, message, data) => {
    fetch('http://localhost:5001/log-client-message', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ level, message, data }),
    }).catch(error => {
        console.error('Failed to send log to server:', error);
    });
};

const logger = {
    info: (message, data) => {
        console.log(message, data || '');
    },
    warn: (message, data) => {
        console.warn(message, data || '');
    },
    error: (message, data) => {
        console.error(message, data || '');
    },
};