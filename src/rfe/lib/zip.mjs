// Minimal ZIP writer (deflate via node:zlib) so lab downloads need no npm dependency.
// The format is written by zip-core.mjs, which the browser lab shares.
// Output is reproducible: entries are sorted, timestamps fixed, and no extra fields written.
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';
import { buildZip, crc32 as tableCrc32 } from './zip-core.mjs';

/**
 * @typedef {{ path: string, data: Buffer | string, mode?: number }} ZipEntry
 */

/**
 * Build a ZIP archive.
 * @param {ZipEntry[]} entries  file paths use `/` separators; directories are implied
 * @param {{ mtime?: Date }} [options]  fixed timestamp for every entry (default 1980-01-01)
 * @returns {Buffer}
 */
export function createZip(entries, { mtime } = {}) {
	const zip = buildZip(entries, {
		mtime,
		deflateRaw: (raw) => deflateRawSync(raw, { level: 9 }),
		// zlib's crc32 needs Node 22.2 or newer.
		crc32: typeof zlibCrc32 === 'function' ? (raw) => zlibCrc32(raw) >>> 0 : tableCrc32,
	});
	return Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
}
