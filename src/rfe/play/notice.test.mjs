// NOTICE lists every third-party component the browser lab ships, with its license.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, lock } from './testing.mjs';

const notice = readFileSync(path.join(REPO, 'NOTICE'), 'utf8');
const lines = notice.split('\n').map((l) => l.trim());
const listed = (name, version, license) => lines.some((l) => l.startsWith(`${name} ${version} (${license})`));

/** npm packages bundled into the browser lab: the editor and terminal dependencies and theirs. */
const BROWSER_NPM_ROOTS = [
	'@codemirror/autocomplete', '@codemirror/commands', '@codemirror/language', '@codemirror/legacy-modes', '@codemirror/lint',
	'@codemirror/lsp-client', '@codemirror/search', '@codemirror/state', '@codemirror/view', '@lezer/highlight', '@xterm/xterm',
	'@xterm/addon-fit', 'dompurify',
];

test('every runtime file of the lock is in NOTICE with its license', () => {
	assert.ok(lines.some((l) => l.startsWith(`pyodide ${lock.pyodide.version} (MPL-2.0)`)), 'pyodide');
	for (const f of lock.files) assert.ok(listed(f.name, f.version, f.license), `${f.name} ${f.version} (${f.license})`);
});

test('every npm package bundled into the browser lab is in NOTICE with its license', () => {
	const packages = JSON.parse(readFileSync(path.join(REPO, 'package-lock.json'), 'utf8')).packages;
	const seen = new Map();
	const visit = (name) => {
		if (seen.has(name)) return;
		const pkg = packages[`node_modules/${name}`];
		assert.ok(pkg, `${name} is installed`);
		seen.set(name, pkg);
		for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
	};
	BROWSER_NPM_ROOTS.forEach(visit);
	seen.delete('@types/trusted-types'); // types only, not bundled
	for (const [name, pkg] of seen) assert.ok(listed(name, pkg.version, pkg.license.replace(/^\((.*)\)$/, '$1')), `${name} ${pkg.version} (${pkg.license})`);
});
