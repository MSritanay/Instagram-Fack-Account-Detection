export const log = async (
    module: 'UI' | 'Client ML' | 'Server ML' | 'DB' | 'API',
    action: string,
    status: 'STARTED' | 'SUCCESS' | 'FAILED',
    message: string,
    error?: unknown
) => {
    try {
        await fetch('http://localhost:3001/api/log', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                module,
                action,
                status,
                message,
                error,
            }),
        });
    } catch (e) {
        console.error('Failed to send log to server:', e);
    }
};