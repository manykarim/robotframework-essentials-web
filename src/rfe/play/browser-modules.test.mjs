// Browser-side helpers of the browser lab that run under Node as well: unzip, the hand-over
// fragment, workspace storage without IndexedDB, and the zip core in the browser's mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from '../lib/zip-core.mjs';
import { createZip } from '../lib/zip.mjs';
import { labArchive } from '../lib/labs.mjs';
import { handoverFragment, handoverUrl, readHandover } from './handover.mjs';
import { unzip } from './unzip.mjs';
import { WorkspaceStore } from './workspace-store.mjs';
import { REPO, course, labFiles } from './testing.mjs';

const decode = (b) => new TextDecoder().decode(b);

test('unzip reads a lab archive exactly as the download holds it', async () => {
	const archive = labArchive(course, 'ch18-custom-libraries', { site: new URL('https://example.invalid/'), root: REPO });
	const files = await unzip(archive);
	const expected = labFiles('ch18-custom-libraries');
	assert.deepEqual(files.map((f) => f.path).sort(), expected.map((f) => `rfe-ch18-custom-libraries/${f.path}`).sort());
	for (const f of expected) assert.equal(decode(files.find((x) => x.path.endsWith(`/${f.path}`)).data), decode(f.data), f.path);
});

test('the browser’s stored zip round-trips through unzip, with UTF-8 names', async () => {
	const entries = [
		{ path: 'rfe-x/checks/a.robot', data: '*** Test Cases ***\nÄ\n' },
		{ path: 'rfe-x/libraries/CartMath.py', data: new TextEncoder().encode('class CartMath:\n    pass\n') },
	];
	const zip = buildZip(entries, { mtime: new Date(Date.UTC(2026, 9, 10)) });
	const files = await unzip(zip);
	assert.deepEqual(files.map((f) => [f.path, decode(f.data)]), [
		['rfe-x/checks/a.robot', '*** Test Cases ***\nÄ\n'],
		['rfe-x/libraries/CartMath.py', 'class CartMath:\n    pass\n'],
	]);
	assert.equal((await unzip(createZip(entries.map((e) => ({ ...e, data: typeof e.data === 'string' ? e.data : Buffer.from(e.data) }))))).length, 2);
	await assert.rejects(unzip(new Uint8Array(40)), /not a zip archive/);
});

test('a hand-over fragment round-trips, including non-ASCII text', () => {
	const files = [{ path: 'checks/cart.robot', text: '*** Test Cases ***\nCart — total ${42}\n' }];
	const fragment = handoverFragment(files);
	assert.match(fragment, /^#add=[A-Za-z0-9_-]+$/);
	assert.deepEqual(readHandover(fragment), files);
	assert.equal(handoverUrl('/robotframework-essentials-web', 'ch18-custom-libraries', files), `/robotframework-essentials-web/labs/ch18-custom-libraries/${fragment}`);
});

test('malformed or unsafe hand-overs are ignored', () => {
	assert.equal(readHandover(''), null);
	assert.equal(readHandover('#add=%%%'), null);
	assert.equal(readHandover('#add=bm90IGpzb24'), null);
	assert.equal(readHandover(handoverFragment([{ path: '../escape.robot', text: 'x' }])), null);
	assert.equal(readHandover(handoverFragment([{ path: '/abs.robot', text: 'x' }])), null);
});

test('without IndexedDB the store keeps work in memory and says it is not persistent', async () => {
	const store = new WorkspaceStore(undefined);
	assert.equal(await store.persistent(), false);
	assert.equal(await store.load('ch03'), null);
	assert.equal(await store.save('ch03', 'abc', new Map([['checks/a.robot', 'x']])), false);
	assert.deepEqual((await store.load('ch03')).files, [['checks/a.robot', 'x']]);
	await store.remove('ch03');
	assert.equal(await store.load('ch03'), null);
});

test('an IndexedDB that throws on access falls back to memory', async () => {
	const saved = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
	Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
	try {
		assert.equal(await new WorkspaceStore().persistent(), false);
	} finally {
		if (saved) Object.defineProperty(globalThis, 'indexedDB', saved);
		else delete globalThis.indexedDB;
	}
});

test('a throwing IndexedDB falls back to memory', async () => {
	const store = new WorkspaceStore(/** @type {any} */ ({ open() { throw new DOMException('denied', 'SecurityError'); } }));
	assert.equal(await store.persistent(), false);
	await store.save('lab', 'h', new Map([['a', 'b']]));
	assert.equal((await store.load('lab')).archive, 'h');
});
