#!/usr/bin/env node
// Browser runtime files for the lab playground and the lesson Run controls.
//
//   node scripts/rfe-runtime.mjs            fetch missing files, verify every hash, stage the runtime
//   node scripts/rfe-runtime.mjs --refresh  re-resolve file names, URLs, hashes and sizes in the lock
//
// src/rfe/play/runtime.lock.json pins every file: the Pyodide core files (from the `pyodide`
// npm package), Pyodide's own builds of some packages, and wheels from PyPI. Downloads go to
// the git-ignored .rfe-runtime-cache/; the runtime is staged in the git-ignored
// public/rfe-runtime/<pyodide-version>/, which Astro copies into the site. Any file whose
// SHA-256 differs from the lock fails the run, naming the file.
// Uses Node built-ins only.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCK_FILE = 'src/rfe/play/runtime.lock.json';
export const CACHE_DIR = '.rfe-runtime-cache';
export const STAGE_DIR = 'public/rfe-runtime';
const PYODIDE_PACKAGE = 'node_modules/pyodide';
const PYPI_JSON = 'https://pypi.org/pypi';
/** Hosts the build may download runtime files from. */
export const ALLOWED_SOURCES = ['https://files.pythonhosted.org/', 'https://cdn.jsdelivr.net/pyodide/v'];

export class RuntimeError extends Error {}

/** @param {Buffer | Uint8Array} data */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Base URL of a Pyodide release's package files. */
export const pyodideFiles = (version) => `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

export function readLock(root) {
	return JSON.parse(readFileSync(path.join(root, LOCK_FILE), 'utf8'));
}

/** Every file the lock pins, as `{ file, sha256, size }`, core files first. */
export function lockedFiles(lock) {
	return [...lock.pyodide.core, ...lock.files];
}

function verify(file, data, expected, where) {
	const actual = sha256(data);
	if (actual !== expected) {
		throw new RuntimeError(`${file}: SHA-256 mismatch in ${where} (expected ${expected}, got ${actual})`);
	}
}

/**
 * Make sure every lock file is in the cache with the pinned hash. Returns the names downloaded.
 * @param {{ root: string, lock: any, fetchImpl?: typeof fetch, log?: (s: string) => void }} options
 */
export async function fetchMissing({ root, lock, fetchImpl = fetch, log = () => {} }) {
	const cache = path.join(root, CACHE_DIR);
	mkdirSync(cache, { recursive: true });
	const downloaded = [];
	for (const entry of lock.files) {
		const target = path.join(cache, entry.file);
		if (existsSync(target)) {
			verify(entry.file, readFileSync(target), entry.sha256, `${CACHE_DIR}/ (delete the file to fetch it again)`);
			continue;
		}
		if (!ALLOWED_SOURCES.some((prefix) => entry.url.startsWith(prefix))) {
			throw new RuntimeError(`${entry.file}: ${entry.url} is not an allowed source`);
		}
		log(`fetch ${entry.url}`);
		const response = await fetchImpl(entry.url);
		if (!response.ok) throw new RuntimeError(`${entry.file}: HTTP ${response.status} from ${entry.url}`);
		const data = Buffer.from(await response.arrayBuffer());
		verify(entry.file, data, entry.sha256, `the download from ${entry.url}`);
		writeFileSync(`${target}.part`, data);
		renameSync(`${target}.part`, target);
		downloaded.push(entry.file);
	}
	return downloaded;
}

/** Pyodide's lock file reduced to the packages this runtime ships. */
export function trimmedPyodideLock(pyodideLock, lock) {
	const names = new Set(lock.files.filter((f) => f.source === 'pyodide').map((f) => f.name));
	const packages = {};
	for (const name of [...names].sort()) {
		const pkg = pyodideLock.packages[name];
		if (!pkg) throw new RuntimeError(`${name}: not in Pyodide ${lock.pyodide.version}'s pyodide-lock.json`);
		const missing = pkg.depends.filter((d) => !names.has(d));
		if (missing.length) throw new RuntimeError(`${name}: depends on ${missing.join(', ')}, which the lock does not list`);
		packages[name] = pkg;
	}
	return { info: pyodideLock.info, packages };
}

function pyodidePackageVersion(root) {
	const file = path.join(root, PYODIDE_PACKAGE, 'package.json');
	if (!existsSync(file)) throw new RuntimeError(`${PYODIDE_PACKAGE} is missing; run npm ci first`);
	return JSON.parse(readFileSync(file, 'utf8')).version;
}

/**
 * Copy the verified runtime into public/rfe-runtime/<version>/ and remove anything else there.
 * @returns {string} the staged directory
 */
export function stage({ root, lock }) {
	const version = lock.pyodide.version;
	const installed = pyodidePackageVersion(root);
	if (installed !== version) {
		throw new RuntimeError(`the pyodide npm package is ${installed}, but ${LOCK_FILE} pins ${version}`);
	}
	const out = path.join(root, STAGE_DIR, version);
	mkdirSync(out, { recursive: true });
	const wanted = new Set();
	const put = (file, data) => {
		wanted.add(file);
		const target = path.join(out, file);
		if (!existsSync(target) || sha256(readFileSync(target)) !== sha256(data)) writeFileSync(target, data);
	};
	for (const core of lock.pyodide.core) {
		const data = readFileSync(path.join(root, PYODIDE_PACKAGE, core.file));
		verify(core.file, data, core.sha256, PYODIDE_PACKAGE);
		put(core.file, data);
	}
	for (const entry of lock.files) {
		const data = readFileSync(path.join(root, CACHE_DIR, entry.file));
		verify(entry.file, data, entry.sha256, CACHE_DIR);
		put(entry.file, data);
	}
	const pyodideLock = JSON.parse(readFileSync(path.join(root, PYODIDE_PACKAGE, 'pyodide-lock.json'), 'utf8'));
	put('pyodide-lock.json', Buffer.from(JSON.stringify(trimmedPyodideLock(pyodideLock, lock))));
	for (const name of readdirSync(out)) if (!wanted.has(name)) rmSync(path.join(out, name), { recursive: true });
	for (const name of readdirSync(path.join(root, STAGE_DIR))) {
		if (name !== version) rmSync(path.join(root, STAGE_DIR, name), { recursive: true });
	}
	return out;
}

/** Packages whose runtime version must equal the labs' `requirements.txt` pins. */
export const LAB_PINNED = ['robotframework', 'robotframework-requests', 'robotframework-pythonlibcore', 'robotframework-robocop'];

/**
 * Differences between the lock and the `name==version` pins in `<labsDir>/<stage>/requirements.txt`.
 * @returns {string[]} one message per differing pin, naming both versions
 */
export function labPinMismatches(lock, labsDir) {
	const problems = [];
	for (const stage of readdirSync(labsDir).sort()) {
		const file = path.join(labsDir, stage, 'requirements.txt');
		if (!existsSync(file)) continue;
		for (const line of readFileSync(file, 'utf8').split('\n')) {
			const m = /^([A-Za-z0-9._-]+)==([^\s;#]+)/.exec(line.trim());
			if (!m || !LAB_PINNED.includes(m[1].toLowerCase())) continue;
			const entry = lock.files.find((f) => f.name === m[1].toLowerCase());
			if (entry?.version !== m[2]) {
				problems.push(`${m[1]}: labs/${stage}/requirements.txt pins ${m[2]}, ${LOCK_FILE} has ${entry?.version ?? 'none'}`);
			}
		}
	}
	return problems;
}

/** The pure-Python wheel of a PyPI release. */
async function pypiWheel(name, version, fetchImpl) {
	const response = await fetchImpl(`${PYPI_JSON}/${name}/${version}/json`);
	if (!response.ok) throw new RuntimeError(`${name} ${version}: HTTP ${response.status} from PyPI`);
	const release = await response.json();
	const wheel = release.urls.find((u) => u.packagetype === 'bdist_wheel' && /-none-any\.whl$/.test(u.filename));
	if (!wheel) throw new RuntimeError(`${name} ${version}: no pure-Python wheel on PyPI`);
	return { file: wheel.filename, url: wheel.url, sha256: wheel.digests.sha256, size: wheel.size };
}

/**
 * Fill in file, URL, SHA-256 and size of every lock entry from PyPI and from the installed
 * Pyodide release. Pyodide packages take the versions that release ships.
 */
export async function refresh({ root, fetchImpl = fetch, log = () => {} }) {
	const lock = readLock(root);
	const version = pyodidePackageVersion(root);
	lock.pyodide.version = version;
	const pyodideLock = JSON.parse(readFileSync(path.join(root, PYODIDE_PACKAGE, 'pyodide-lock.json'), 'utf8'));
	lock.pyodide.python = pyodideLock.info.python;
	lock.pyodide.core = lock.pyodide.core.map(({ file }) => {
		const data = readFileSync(path.join(root, PYODIDE_PACKAGE, file));
		return { file, sha256: sha256(data), size: data.length };
	});
	const files = [];
	for (const entry of lock.files) {
		const { name, source, license, groups } = entry;
		if (source === 'pypi') {
			files.push({ name, version: entry.version, source, license, groups, ...(await pypiWheel(name, entry.version, fetchImpl)) });
		} else if (source === 'pyodide') {
			const pkg = pyodideLock.packages[name];
			if (!pkg) throw new RuntimeError(`${name}: not in Pyodide ${version}`);
			const url = pyodideFiles(version) + pkg.file_name;
			const response = await fetchImpl(url);
			if (!response.ok) throw new RuntimeError(`${name}: HTTP ${response.status} from ${url}`);
			const data = Buffer.from(await response.arrayBuffer());
			verify(pkg.file_name, data, pkg.sha256, url);
			files.push({ name, version: pkg.version, source, license, groups, file: pkg.file_name, url, sha256: pkg.sha256, size: data.length });
		} else {
			throw new RuntimeError(`${name}: unknown source "${source}"`);
		}
		log(`${name} ${files.at(-1).version}`);
	}
	lock.files = files;
	trimmedPyodideLock(pyodideLock, lock);
	writeFileSync(path.join(root, LOCK_FILE), formatLock(lock));
	return lock;
}

/** The lock as JSON with one line per file entry, so diffs show which pin changed. */
export function formatLock(lock) {
	const line = (o) => `\t\t\t${JSON.stringify(o)}`;
	const files = (list, indent) => list.map((o) => indent + JSON.stringify(o)).join(',\n');
	return [
		'{',
		'\t"pyodide": {',
		`\t\t"version": ${JSON.stringify(lock.pyodide.version)},`,
		`\t\t"python": ${JSON.stringify(lock.pyodide.python)},`,
		'\t\t"core": [',
		lock.pyodide.core.map(line).join(',\n'),
		'\t\t]',
		'\t},',
		'\t"files": [',
		files(lock.files, '\t\t'),
		'\t]',
		'}',
		'',
	].join('\n');
}

async function main() {
	const root = fileURLToPath(new URL('..', import.meta.url));
	const log = (s) => console.log(`[rfe-runtime] ${s}`);
	if (process.argv.includes('--refresh')) {
		const lock = await refresh({ root, log });
		log(`wrote ${LOCK_FILE}: ${lock.files.length} files for Pyodide ${lock.pyodide.version}`);
	}
	const lock = readLock(root);
	const downloaded = await fetchMissing({ root, lock, log });
	const out = stage({ root, lock });
	log(`${lockedFiles(lock).length} files verified, ${downloaded.length} downloaded, staged in ${path.relative(root, out)}/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`[rfe-runtime] ${error instanceof RuntimeError ? error.message : error.stack}`);
		process.exit(1);
	});
}
