const url = document.documentElement.getAttribute('data-Instagram Authentication-fetch-url');
if (url) {
    window.fetch(url).catch(e => console.error('[Instagram Authentication] In-page fetch failed:', e));
}
