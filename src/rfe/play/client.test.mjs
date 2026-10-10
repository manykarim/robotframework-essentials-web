import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunnerClient, STOPPED_RC } from './client.mjs';

/** A worker that answers init at once and keeps exec pending until told otherwise. */
class FakeWorker {
	static made = [];
	constructor() {
		this.sent = [];
		this.terminated = false;
		/** @type {((e: { data: any }) => void) | null} */
		this.onmessage = null;
		FakeWorker.made.push(this);
	}
	postMessage(m) {
		this.sent.push(m);
		if (m.type === 'init') {
			queueMicrotask(() => {
				this.emit({ type: 'status', step: 'lab' });
				this.emit({ type: 'ready', id: m.id, root: `/work/${m.folder}`, files: m.files.map((f) => f.path), timings: {} });
			});
		}
	}
	emit(data) {
		if (!this.terminated) this.onmessage?.({ data });
	}
	terminate() {
		this.terminated = true;
	}
}

function client(statuses = []) {
	FakeWorker.made = [];
	return new RunnerClient({
		createWorker: () => /** @type {any} */ (new FakeWorker()),
		runtime: '/rfe-runtime/x/',
		folder: 'rfe-ch03',
		files: [['checks/a.robot', 'v1']],
		onStatus: (text) => statuses.push(text),
	});
}

test('the worker starts on demand with the workspace and reports progress in words', async () => {
	const statuses = [];
	const c = client(statuses);
	assert.equal(FakeWorker.made.length, 0, 'nothing starts before it is needed');
	const ready = await c.start();
	assert.equal(ready.root, '/work/rfe-ch03');
	assert.deepEqual(statuses, ['Loading Python…', 'Preparing the lab…']);
	const [init] = FakeWorker.made[0].sent;
	assert.deepEqual([init.type, init.runtime, init.folder, init.files], ['init', '/rfe-runtime/x/', 'rfe-ch03', [{ path: 'checks/a.robot', data: 'v1' }]]);
	assert.equal(await c.start(), ready, 'a second start reuses the worker');
});

test('stop during a run restarts the worker, resends the workspace, and resolves the run as stopped', async () => {
	const c = client();
	await c.start();
	c.write('checks/a.robot', 'v2');
	c.write('checks/new.robot', 'new');
	const run = c.exec('robot checks');
	await new Promise((r) => setTimeout(r, 0));
	const first = FakeWorker.made[0];
	assert.equal(first.sent.at(-1).type, 'exec');
	assert.equal(c.busy, true);

	const restarted = c.stop();
	assert.equal(first.terminated, true);
	const result = await run;
	assert.deepEqual([result.stopped, result.rc], [true, STOPPED_RC]);
	assert.equal(c.busy, false);

	await restarted;
	const second = FakeWorker.made[1];
	assert.ok(second && second !== first, 'a fresh worker');
	assert.deepEqual(second.sent[0].files, [
		{ path: 'checks/a.robot', data: 'v2' },
		{ path: 'checks/new.robot', data: 'new' },
	]);
	assert.equal(c.restarts, 1);
});

test('a finished run applies the files the command changed to the workspace', async () => {
	const c = client();
	await c.start();
	const run = c.exec('robocop format checks');
	await new Promise((r) => setTimeout(r, 0));
	const worker = FakeWorker.made[0];
	const { id } = worker.sent.at(-1);
	worker.emit({ type: 'out', text: 'formatted', err: false });
	worker.emit({ type: 'done', id, rc: 0, ms: 5, files: ['checks/a.robot'], changed: [{ path: 'checks/a.robot', data: 'formatted' }], deleted: [], results: [] });
	assert.equal((await run).rc, 0);
	assert.equal(c.files.get('checks/a.robot'), 'formatted');
});

test('rename and delete update the mirrored workspace', async () => {
	const c = client();
	c.write('libraries/Cart.py', 'x');
	c.rename('libraries', 'lib');
	assert.deepEqual([...c.files.keys()].sort(), ['checks/a.robot', 'lib/Cart.py']);
	c.delete('lib');
	assert.deepEqual([...c.files.keys()], ['checks/a.robot']);
	assert.equal(FakeWorker.made.length, 0, 'file operations alone do not start the worker');
});

test('worker errors reject the matching request', async () => {
	const c = client();
	await c.start();
	const reading = c.read('missing.txt');
	await new Promise((r) => setTimeout(r, 0));
	const worker = FakeWorker.made[0];
	worker.emit({ type: 'error', id: worker.sent.at(-1).id, message: 'No such file' });
	await assert.rejects(reading, /No such file/);
});
