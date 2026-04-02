window.addEventListener('error', function(event) {
  const { message, filename, lineno, colno, error } = event;
  const stack = error ? error.stack : 'No stack available';

  fetch('http://localhost:5001/log-client-error', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message,
      stack: stack,
      filename: filename,
      lineno: lineno,
      colno: colno,
    }),
  }).catch(err => console.error('Failed to send error log to server:', err));
});

window.addEventListener('unhandledrejection', function(event) {
  const stack = event.reason && event.reason.stack ? event.reason.stack : 'No stack available';

  fetch('http://localhost:5001/log-client-error', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Unhandled promise rejection',
      stack: stack,
    }),
  }).catch(err => console.error('Failed to send error log to server:', err));
});