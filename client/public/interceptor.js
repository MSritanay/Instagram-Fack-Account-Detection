const origFetch = window.fetch;

function parseJsonLenient(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const normalized = text.startsWith('for (;;);') ? text.slice('for (;;);'.length).trim() : text;
    try {
        return JSON.parse(normalized);
    } catch {
        const firstBrace = normalized.indexOf('{');
        const lastBrace = normalized.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

window.fetch = async (...args) => {
    const response = await origFetch(...args);
    const url = args[0];

    if (typeof url === 'string' && url.includes('?__a=1')) {
        console.log('[Instagram Authentication Interceptor] Detected __a=1 API call.');
        const clone = response.clone();
        clone.text().then(raw => {
            const data = parseJsonLenient(raw);
            if (!data) {
                console.warn('[Instagram Authentication Interceptor] __a response was not valid JSON payload.');
                return;
            }
            // The new endpoint has a different structure. We need to adapt.
            // The profile data is now in a top-level `data` property.
            if (data.data && data.data.user) {
                 window.postMessage({ type: 'INSTAGRAM_AUTHENTICATION_XHR_DATA', data: { data: { user: data.data.user } } }, '*');
            } else {
                // Sometimes the data is nested under a `graphql` property
                window.postMessage({ type: 'INSTAGRAM_AUTHENTICATION_XHR_DATA', data }, '*');
            }
        }).catch(e => console.error('[Instagram Authentication Interceptor] Error parsing __a=1 JSON:', e));
    }

    return response;
};
console.log('[Instagram Authentication] Network interceptor active.');

