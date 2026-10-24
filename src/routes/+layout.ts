// Client-rendered app shell: all data lives in the sync engine (IndexedDB + server snapshot),
// which lets the service worker serve the same shell offline for every route.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
