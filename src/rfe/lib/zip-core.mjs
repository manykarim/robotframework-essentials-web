// Platform-neutral ZIP writer, shared by the lab downloads (zip.mjs, deflated with
// node:zlib at build time) and the browser lab's "Download workspace" (stored entries).
// Output is reproducible: entries are sorted, timestamps fixed, and no extra fields written.

/** @type {Uint32Array | undefined} */
let table;
/** CRC-32 of `bytes` (IEEE). */
export function crc32(bytes) {
	table ??= Uint32Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	let c = 0xffffffff;
	for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** @param {Date} d */
function dosDateTime(d) {
	const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
	const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
	return { time, date };
}

const encoder = new TextEncoder();

/**
 * @typedef {{ path: string, data: Uint8Array | string, mode?: number }} ZipEntry
 */

/**
 * Build a ZIP archive.
 * @param {ZipEntry[]} entries  file paths use `/` separators; directories are implied
 * @param {{ mtime?: Date, deflateRaw?: (raw: Uint8Array) => Uint8Array, crc32?: (raw: Uint8Array) => number }} [options]
 *   mtime: fixed timestamp for every entry (default 1980-01-01); deflateRaw: compress entries
 *   (stored when absent or when compression doesn't help)
 * @returns {Uint8Array}
 */
export function buildZip(entries, { mtime = new Date(Date.UTC(1980, 0, 1)), deflateRaw, crc32: crc = crc32 } = {}) {
	const { time, date } = dosDateTime(mtime);
	const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	/** @type {Uint8Array[]} */
	const locals = [];
	/** @type {Uint8Array[]} */
	const centrals = [];
	let offset = 0;
	const seen = new Set();
	for (const entry of sorted) {
		const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
		if (!path || path.endsWith('/') || path.split('/').includes('..')) throw new Error(`invalid zip path: ${entry.path}`);
		if (seen.has(path)) throw new Error(`duplicate zip path: ${path}`);
		seen.add(path);
		const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
		const deflated = deflateRaw?.(raw);
		const stored = !deflated || deflated.length >= raw.length;
		const body = stored ? raw : deflated;
		const method = stored ? 0 : 8;
		const sum = crc(raw);
		const name = encoder.encode(path);

		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true); // version needed
		local.setUint16(6, 0x0800, true); // UTF-8 names
		local.setUint16(8, method, true);
		local.setUint16(10, time, true);
		local.setUint16(12, date, true);
		local.setUint32(14, sum, true);
		local.setUint32(18, body.length, true);
		local.setUint32(22, raw.length, true);
		local.setUint16(26, name.length, true);
		local.setUint16(28, 0, true);
		locals.push(new Uint8Array(local.buffer), name, body);

		const central = new DataView(new ArrayBuffer(46));
		central.setUint32(0, 0x02014b50, true);
		central.setUint16(4, (3 << 8) | 20, true); // made by: Unix, so mode bits are honored
		central.setUint16(6, 20, true);
		central.setUint16(8, 0x0800, true);
		central.setUint16(10, method, true);
		central.setUint16(12, time, true);
		central.setUint16(14, date, true);
		central.setUint32(16, sum, true);
		central.setUint32(20, body.length, true);
		central.setUint32(24, raw.length, true);
		central.setUint16(28, name.length, true);
		central.setUint32(38, (((entry.mode ?? 0o644) | 0o100000) << 16) >>> 0, true);
		central.setUint32(42, offset, true);
		centrals.push(new Uint8Array(central.buffer), name);

		offset += 30 + name.length + body.length;
	}
	const cdLength = centrals.reduce((n, part) => n + part.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, sorted.length, true);
	end.setUint16(10, sorted.length, true);
	end.setUint32(12, cdLength, true);
	end.setUint32(16, offset, true);
	const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
