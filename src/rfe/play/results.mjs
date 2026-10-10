// Run results of the browser lab: the page stores log.html, report.html and output.xml in
// Cache Storage under <base>/labs/_results/<scope>/<path>, and the results service worker
// (src/pages/labs/rfe-results-sw.js.ts) serves them from there, sandboxed, so the links
// between report and log work and result pages can't touch the course's storage.

export const RESULTS_CACHE = 'rfe-results-v1';
/** The three Robot Framework output files a run writes; nothing else is stored. */
export const RESULT_FILE = /(^|\/)([^/]*log\.html|[^/]*report\.html|[^/]*output[^/]*\.xml)$/;
/** Policy every result page is served with: an opaque origin, scripts and popups allowed. */
export const RESULTS_SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox';

/** `/robotframework-essentials-web/labs/` for any form of the base path. */
export const labsPath = (base) => `${base.replace(/\/+$/, '')}/labs/`;

/** URL path of a stored result file. */
export const resultUrl = (base, scope, path) => `${labsPath(base)}_results/${scope}/${path}`;

/**
 * Store a run's result files; returns the stored paths.
 * @param {string} base  the site's base path
 * @param {string} scope  the lab id, or `example` for inline runs
 * @param {{ path: string, data: Uint8Array }[]} files
 */
export async function storeResults(base, scope, files) {
	const cache = await caches.open(RESULTS_CACHE);
	const stored = [];
	for (const { path, data } of files) {
		if (!RESULT_FILE.test(path)) continue;
		const type = path.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'text/html; charset=utf-8';
		await cache.put(resultUrl(base, scope, path), new Response(data, { headers: { 'Content-Type': type } }));
		stored.push(path);
	}
	return stored;
}

/** Remove every stored result of a scope (after "Reset lab"). */
export async function clearResults(base, scope) {
	const cache = await caches.open(RESULTS_CACHE);
	const prefix = resultUrl(base, scope, '');
	for (const request of await cache.keys()) if (new URL(request.url).pathname.startsWith(prefix)) await cache.delete(request);
}

/**
 * Register the results service worker and wait until it is active. Works from lesson pages,
 * which are outside its scope (navigator.serviceWorker.ready would never settle there).
 */
export async function activateResultsWorker(base) {
	if (!('serviceWorker' in navigator)) throw new Error('this browser has no service workers, so run results cannot be shown');
	const scope = labsPath(base);
	const registration = await navigator.serviceWorker.register(`${scope}rfe-results-sw.js`, { scope });
	if (registration.active) return registration;
	const worker = registration.installing ?? registration.waiting;
	await new Promise((resolve, reject) => {
		if (!worker) return reject(new Error('the results service worker did not install'));
		worker.addEventListener('statechange', () => {
			if (worker.state === 'activated') resolve(undefined);
			if (worker.state === 'redundant') reject(new Error('the results service worker did not install'));
		});
	});
	return registration;
}
