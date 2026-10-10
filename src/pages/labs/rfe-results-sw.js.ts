// Service worker of the browser lab's run results, at <base>/labs/rfe-results-sw.js (scope
// <base>/labs/). It answers only <base>/labs/_results/ from Cache Storage, with a sandbox
// policy so result pages run in an opaque origin; every other request passes through.
// Rollback: replace the body with a version that calls self.registration.unregister().
import type { APIRoute } from 'astro';
import { RESULTS_CACHE, RESULTS_SANDBOX } from '../../rfe/play/results.mjs';

const script = `// Robot Framework Essentials: run results of the browser lab (generated, see src/pages/labs/rfe-results-sw.js.ts).
const CACHE = ${JSON.stringify(RESULTS_CACHE)};
const SANDBOX = ${JSON.stringify(RESULTS_SANDBOX)};
const PREFIX = new URL('_results/', self.registration.scope).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX) || event.request.method !== 'GET') return;
	event.respondWith((async () => {
		const cache = await caches.open(CACHE);
		const hit = await cache.match(url.pathname);
		const headers = new Headers(hit ? hit.headers : { 'Content-Type': 'text/plain; charset=utf-8' });
		headers.set('Content-Security-Policy', SANDBOX);
		headers.set('X-Content-Type-Options', 'nosniff');
		headers.set('Cache-Control', 'no-store');
		if (!hit) return new Response('This result is not stored in your browser (any more). Run the suite again.', { status: 404, headers });
		return new Response(hit.body, { status: 200, headers });
	})());
});
`;

export const GET: APIRoute = () => new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
