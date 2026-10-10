import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createZip } from './zip.mjs';

const entries = [
	{ path: 'rfe-lab/checks/prices.robot', data: '*** Test Cases ***\nBackpack\n    Should Be True    79.00 > 0\n'.repeat(20) },
	{ path: 'rfe-lab/README.md', data: '# Lab\n' },
	{ path: 'rfe-lab/.vscode/extensions.json', data: '{"recommendations":["d-biehl.robotcode"]}\n' },
	{ path: 'rfe-lab/empty.txt', data: '' },
];

/** Read every entry back from the central directory. */
function readZip(buf) {
	const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	const count = buf.readUInt16LE(end + 10);
	let p = buf.readUInt32LE(end + 16);
	const files = {};
	for (let i = 0; i < count; i++) {
		assert.equal(buf.readUInt32LE(p), 0x02014b50);
		const method = buf.readUInt16LE(p + 10);
		const csize = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const local = buf.readUInt32LE(p + 42);
		const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
		const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const body = buf.subarray(dataStart, dataStart + csize);
		files[name] = (method === 8 ? inflateRawSync(body) : body).toString('utf8');
		p += 46 + nameLen;
	}
	return files;
}

test('round-trips every entry, sorted', () => {
	const files = readZip(createZip(entries));
	assert.deepEqual(Object.keys(files), [...entries.map((e) => e.path)].sort());
	for (const e of entries) assert.equal(files[e.path], e.data);
});

test('is byte-identical for the same input in any order', () => {
	assert.ok(createZip(entries).equals(createZip([...entries].reverse())));
});

test('rejects unsafe or duplicate paths', () => {
	assert.throws(() => createZip([{ path: '../evil', data: 'x' }]), /invalid zip path/);
	assert.throws(() => createZip([{ path: 'a', data: 'x' }, { path: 'a', data: 'y' }]), /duplicate/);
});

test('passes `unzip -t` and extracts identical files (when unzip is installed)', (t) => {
	try {
		execFileSync('unzip', ['-v'], { stdio: 'ignore' });
	} catch {
		t.skip('unzip not installed');
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), 'rfe-zip-'));
	try {
		const file = join(dir, 'lab.zip');
		writeFileSync(file, createZip(entries));
		const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
		assert.match(out, /No errors detected/);
		execFileSync('unzip', ['-q', file, '-d', join(dir, 'x')]);
		for (const e of entries) assert.equal(readFileSync(join(dir, 'x', e.path), 'utf8'), e.data);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
