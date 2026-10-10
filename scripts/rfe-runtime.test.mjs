import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ALLOWED_SOURCES, CACHE_DIR, LAB_PINNED, RuntimeError, fetchMissing, labPinMismatches, lockedFiles, pyodideFiles,
	readLock, sha256, trimmedPyodideLock,
} from './rfe-runtime.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = readLock(repo);

test('every lock entry comes from PyPI files or the pinned Pyodide release, with a SHA-256', () => {
	const pyodide = pyodideFiles(lock.pyodide.version);
	assert.equal(pyodide, 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/');
	for (const entry of lock.files) {
		const host = new URL(entry.url).host;
		assert.ok(host === 'files.pythonhosted.org' || entry.url.startsWith(pyodide), `${entry.file}: ${entry.url}`);
		assert.ok(ALLOWED_SOURCES.some((prefix) => entry.url.startsWith(prefix)), entry.url);
		assert.equal(entry.url.split('/').pop(), entry.file);
		assert.ok(entry.license && entry.groups.length && entry.version, entry.name);
	}
	for (const entry of lockedFiles(lock)) {
		assert.match(entry.sha256, /^[0-9a-f]{64}$/, entry.file);
		assert.ok(entry.size > 0, entry.file);
	}
	const files = lockedFiles(lock).map((f) => f.file);
	assert.equal(new Set(files).size, files.length, 'file names are unique');
});

test('the Pyodide packages of the lock are closed under their dependencies', () => {
	const pyodideLock = JSON.parse(readFileSync(path.join(repo, 'node_modules/pyodide/pyodide-lock.json'), 'utf8'));
	const trimmed = trimmedPyodideLock(pyodideLock, lock);
	assert.deepEqual(Object.keys(trimmed.packages).sort(), lock.files.filter((f) => f.source === 'pyodide').map((f) => f.name).sort());
	for (const entry of lock.files.filter((f) => f.source === 'pyodide')) {
		assert.equal(trimmed.packages[entry.name].sha256, entry.sha256, entry.name);
		assert.equal(trimmed.packages[entry.name].version, entry.version, entry.name);
	}
	const partial = { ...lock, files: lock.files.filter((f) => f.name !== 'markupsafe') };
	assert.throws(() => trimmedPyodideLock(pyodideLock, partial), /jinja2: depends on markupsafe/);
});

test('the runtime pins equal the labs’ requirements.txt pins', () => {
	assert.deepEqual(labPinMismatches(lock, path.join(repo, 'labs')), []);
	for (const name of LAB_PINNED) assert.ok(lock.files.some((f) => f.name === name), name);
});

test('a changed lab pin is reported with both versions', () => {
	const labs = mkdtempSync(path.join(tmpdir(), 'rfe-pins-'));
	try {
		cpSync(path.join(repo, 'labs/p3-api-baseline'), path.join(labs, 'p3-api-baseline'), { recursive: true });
		const file = path.join(labs, 'p3-api-baseline/requirements.txt');
		writeFileSync(file, readFileSync(file, 'utf8').replace('robotframework==7.4.2', 'robotframework==7.5.0'));
		assert.deepEqual(labPinMismatches(lock, labs), [
			`robotframework: labs/p3-api-baseline/requirements.txt pins 7.5.0, src/rfe/play/runtime.lock.json has 7.4.2`,
		]);
	} finally {
		rmSync(labs, { recursive: true, force: true });
	}
});

/** A lock with two small files and a fetch that serves them (or other bytes). */
function fixture(serve = (_name, data) => data) {
	const root = mkdtempSync(path.join(tmpdir(), 'rfe-runtime-'));
	const bodies = { 'a-1.0-py3-none-any.whl': Buffer.from('wheel a'), 'b-2.0-py3-none-any.whl': Buffer.from('wheel b') };
	const files = Object.entries(bodies).map(([file, data]) => ({
		name: file.split('-')[0], file, url: `https://files.pythonhosted.org/packages/x/${file}`, sha256: sha256(data), size: data.length,
	}));
	const requests = [];
	const fetchImpl = async (url) => {
		requests.push(url);
		const name = url.split('/').pop();
		const data = serve(name, bodies[name]);
		return { ok: true, status: 200, arrayBuffer: async () => data };
	};
	return { root, lock: { pyodide: { version: '0', core: [] }, files }, fetchImpl, requests };
}

test('fetchMissing downloads missing files once and keeps them in the cache', async () => {
	const { root, lock: small, fetchImpl, requests } = fixture();
	try {
		assert.deepEqual(await fetchMissing({ root, lock: small, fetchImpl }), ['a-1.0-py3-none-any.whl', 'b-2.0-py3-none-any.whl']);
		assert.equal(readFileSync(path.join(root, CACHE_DIR, 'a-1.0-py3-none-any.whl'), 'utf8'), 'wheel a');
		assert.deepEqual(await fetchMissing({ root, lock: small, fetchImpl }), []);
		assert.equal(requests.length, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a corrupted cache file fails the run and names the file', async () => {
	const { root, lock: small, fetchImpl } = fixture();
	try {
		await fetchMissing({ root, lock: small, fetchImpl });
		writeFileSync(path.join(root, CACHE_DIR, 'b-2.0-py3-none-any.whl'), 'tampered');
		await assert.rejects(fetchMissing({ root, lock: small, fetchImpl }), (error) =>
			error instanceof RuntimeError && /^b-2\.0-py3-none-any\.whl: SHA-256 mismatch in \.rfe-runtime-cache\//.test(error.message));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a download that does not match its pin is not cached', async () => {
	const { root, lock: small, fetchImpl } = fixture((name, data) => (name.startsWith('a-') ? Buffer.from('other bytes') : data));
	try {
		await assert.rejects(fetchMissing({ root, lock: small, fetchImpl }), /a-1\.0-py3-none-any\.whl: SHA-256 mismatch in the download/);
		assert.equal(existsSync(path.join(root, CACHE_DIR, 'a-1.0-py3-none-any.whl')), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('only the allowed hosts are fetched from', async () => {
	const { root, lock: small, fetchImpl, requests } = fixture();
	try {
		small.files[0].url = 'https://example.com/a-1.0-py3-none-any.whl';
		await assert.rejects(fetchMissing({ root, lock: small, fetchImpl }), /is not an allowed source/);
		assert.deepEqual(requests, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the staged runtime matches the lock', () => {
	const dir = path.join(repo, 'public/rfe-runtime', lock.pyodide.version);
	assert.ok(existsSync(dir), 'runtime not staged: run `npm run runtime` first');
	for (const entry of lockedFiles(lock)) assert.equal(sha256(readFileSync(path.join(dir, entry.file))), entry.sha256, entry.file);
});
