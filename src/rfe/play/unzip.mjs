// Read a ZIP archive in the browser (DecompressionStream for deflated entries): the browser
// lab unpacks the same lab archive learners download.

/** @param {Uint8Array} bytes */
async function inflateRaw(bytes) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Entries of an archive, in archive order. Directory entries are skipped.
 * @param {ArrayBuffer | Uint8Array} archive
 * @returns {Promise<{ path: string, data: Uint8Array }[]>}
 */
export async function unzip(archive) {
	const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(archive);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = bytes.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
	if (end < 0) throw new Error('not a zip archive');
	const count = view.getUint16(end + 10, true);
	let p = view.getUint32(end + 16, true);
	const decoder = new TextDecoder();
	const files = [];
	for (let i = 0; i < count; i++) {
		if (view.getUint32(p, true) !== 0x02014b50) throw new Error('broken zip directory');
		const method = view.getUint16(p + 10, true);
		const size = view.getUint32(p + 20, true);
		const nameLength = view.getUint16(p + 28, true);
		const extra = view.getUint16(p + 30, true);
		const comment = view.getUint16(p + 32, true);
		const local = view.getUint32(p + 42, true);
		const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
		p += 46 + nameLength + extra + comment;
		if (path.endsWith('/')) continue;
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const body = bytes.slice(start, start + size);
		if (method !== 0 && method !== 8) throw new Error(`${path}: unsupported compression ${method}`);
		files.push({ path, data: method === 8 ? await inflateRaw(body) : body });
	}
	return files;
}
