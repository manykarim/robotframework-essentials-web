// Hand-over from a lesson to its browser lab: "Open in browser lab" links to
// `<base>/labs/<lab-id>/#add=<base64url JSON [{ path, text }]>`. The fragment never
// reaches the server; the playground reads it, removes it, and runs nothing.

const toBase64Url = (bytes) => {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** @param {{ path: string, text: string }[]} files */
export function handoverFragment(files) {
	return `#add=${toBase64Url(new TextEncoder().encode(JSON.stringify(files.map(({ path, text }) => ({ path, text })))))}`;
}

/** URL of a lab's playground with files handed over. */
export function handoverUrl(base, labId, files) {
	return `${base.replace(/\/+$/, '')}/labs/${labId}/${handoverFragment(files)}`;
}

/**
 * Files in a `#add=…` fragment, or null when there are none or the fragment is malformed.
 * @param {string} hash  `location.hash`
 * @returns {{ path: string, text: string }[] | null}
 */
export function readHandover(hash) {
	const m = /^#add=([A-Za-z0-9_-]+)$/.exec(hash);
	if (!m) return null;
	try {
		const binary = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
		const files = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
		if (!Array.isArray(files)) return null;
		const ok = files.filter((f) => f && typeof f.path === 'string' && typeof f.text === 'string' && /^\w[\w./-]*$/.test(f.path) && !f.path.split('/').includes('..'));
		return ok.length ? ok.map(({ path, text }) => ({ path, text })) : null;
	} catch {
		return null;
	}
}
