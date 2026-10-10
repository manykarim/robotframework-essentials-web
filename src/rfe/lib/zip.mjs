// Minimal ZIP writer (deflate via node:zlib) so lab downloads need no npm dependency.
// Output is reproducible: entries are sorted, timestamps fixed, and no extra fields written.
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';

/** @type {Uint32Array | undefined} */
let table;
/** @param {Buffer} buf */
function crc32(buf) {
	if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
	// Fallback for Node versions before 22.2.
	table ??= Uint32Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	let c = 0xffffffff;
	for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** @param {Date} d */
function dosDateTime(d) {
	const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
	const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
	return { time, date };
}

/**
 * @typedef {{ path: string, data: Buffer | string, mode?: number }} ZipEntry
 */

/**
 * Build a ZIP archive.
 * @param {ZipEntry[]} entries  file paths use `/` separators; directories are implied
 * @param {{ mtime?: Date }} [options]  fixed timestamp for every entry (default 1980-01-01)
 * @returns {Buffer}
 */
export function createZip(entries, { mtime = new Date(Date.UTC(1980, 0, 1)) } = {}) {
	const { time, date } = dosDateTime(mtime);
	const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const locals = [];
	const centrals = [];
	let offset = 0;
	const seen = new Set();
	for (const entry of sorted) {
		const path = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
		if (!path || path.endsWith('/') || path.split('/').includes('..')) throw new Error(`invalid zip path: ${entry.path}`);
		if (seen.has(path)) throw new Error(`duplicate zip path: ${path}`);
		seen.add(path);
		const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
		const deflated = deflateRawSync(raw, { level: 9 });
		const stored = deflated.length >= raw.length;
		const body = stored ? raw : deflated;
		const method = stored ? 0 : 8;
		const crc = crc32(raw);
		const name = Buffer.from(path, 'utf8');

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, body);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, so mode bits are honored
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE((((entry.mode ?? 0o644) | 0o100000) << 16) >>> 0, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + body.length;
	}
	const cd = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(sorted.length, 8);
	end.writeUInt16LE(sorted.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, end]);
}
