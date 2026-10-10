// Page side of the runner worker: starts it on demand, mirrors the workspace so a restart
// can resend it, and turns the message protocol (runner-core.mjs) into promises.
// Stop terminates the worker (Python can't be interrupted without SharedArrayBuffer) and
// starts a fresh one with the same files.

export const STEP_TEXT = {
	python: 'Loading Python…',
	packages: 'Loading Robot Framework and packages…',
	lab: 'Preparing the lab…',
	ready: 'Ready',
};

/** Exit code reported for a stopped command, as a shell reports Ctrl+C. */
export const STOPPED_RC = 130;

export class RunnerClient {
	/**
	 * @param {{
	 *   createWorker: () => Worker,
	 *   runtime: string,
	 *   folder: string,
	 *   files: Iterable<[string, string | Uint8Array]>,
	 *   onStatus?: (text: string, step: string) => void,
	 *   onOutput?: (text: string, isError: boolean) => void,
	 * }} options
	 */
	constructor({ createWorker, runtime, folder, files, onStatus = () => {}, onOutput = () => {} }) {
		this.createWorker = createWorker;
		this.runtime = runtime;
		this.folder = folder;
		/** @type {Map<string, string | Uint8Array>} the workspace as the page knows it */
		this.files = new Map(files);
		this.onStatus = onStatus;
		this.onOutput = onOutput;
		/** @type {Worker | null} */
		this.worker = null;
		/** @type {Promise<any> | null} */
		this.ready = null;
		/** @type {Map<number, { type: string, resolve: (m: any) => void, reject: (e: Error) => void }>} */
		this.pending = new Map();
		this.seq = 0;
		this.running = 0;
		this.restarts = 0;
		/** @type {string | null} the last start-up step reported */
		this.step = null;
	}

	/** Start the worker (once) and send the workspace; resolves with the `ready` message. */
	start() {
		if (this.ready) return this.ready;
		const worker = this.createWorker();
		this.worker = worker;
		worker.onmessage = (event) => this.#receive(event.data);
		worker.onerror = (event) => this.#fail(new Error(event.message || 'the runner stopped unexpectedly'));
		this.step = 'python';
		this.onStatus(STEP_TEXT.python, 'python');
		const ready = this.#request('init', 'ready', { runtime: this.runtime, folder: this.folder, files: this.#fileList() });
		this.ready = ready;
		ready.catch(() => {
			// A failed start can be retried: the next start() makes a new worker.
			if (this.ready !== ready) return;
			worker.terminate();
			this.worker = null;
			this.ready = null;
		});
		return ready;
	}

	/** Start over with a different set of files (a fresh lab copy), keeping Python loaded. */
	async reset(files) {
		this.files = new Map(files);
		if (!this.ready) return this.start();
		await this.ready;
		this.ready = this.#request('init', 'ready', { runtime: this.runtime, folder: this.folder, files: this.#fileList() });
		return this.ready;
	}

	write(path, data) {
		this.files.set(path, data);
		this.#post({ type: 'write', path, data });
	}

	delete(path) {
		for (const key of [...this.files.keys()]) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
		this.#post({ type: 'delete', path });
	}

	rename(from, to) {
		for (const [key, data] of [...this.files]) {
			if (key === from || key.startsWith(`${from}/`)) {
				this.files.delete(key);
				this.files.set(to + key.slice(from.length), data);
			}
		}
		this.#post({ type: 'rename', from, to });
	}

	async read(path) {
		await this.start();
		return (await this.#request('read', 'read', { path })).data;
	}

	async list() {
		await this.start();
		return (await this.#request('list', 'files', {})).files;
	}

	/**
	 * Run a command line. Resolves with the `done` message, or `{ stopped: true }` after stop().
	 * Files the command changed are applied to the mirrored workspace.
	 */
	async exec(line, cols = 100) {
		await this.start();
		this.running++;
		try {
			const done = await this.#request('exec', 'done', { line, cols });
			if (!done.stopped) {
				for (const f of done.changed) this.files.set(f.path, f.data);
				for (const p of done.deleted) this.files.delete(p);
			}
			return done;
		} finally {
			this.running--;
		}
	}

	get busy() {
		return this.running > 0;
	}

	/** Stop whatever runs: terminate the worker, settle pending requests, start a fresh one. */
	stop() {
		this.worker?.terminate();
		this.worker = null;
		this.ready = null;
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const p of pending) {
			if (p.type === 'done') p.resolve({ type: 'done', stopped: true, rc: STOPPED_RC, files: [], changed: [], deleted: [], results: [] });
			else p.reject(new Error('stopped'));
		}
		this.restarts++;
		return this.start();
	}

	/** End the worker for good. */
	dispose() {
		this.worker?.terminate();
		this.worker = null;
		this.ready = null;
		this.#fail(new Error('closed'));
	}

	#fileList() {
		return [...this.files].map(([path, data]) => ({ path, data }));
	}

	/** Without a worker the mirror is enough: the next start sends every file. */
	#post(message) {
		this.worker?.postMessage(message);
	}

	#request(type, reply, fields) {
		const id = ++this.seq;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { type: reply, resolve, reject });
			this.worker?.postMessage({ type, id, ...fields });
		});
	}

	#receive(m) {
		if (m.type === 'status') {
			if (m.step === this.step) return; // start() already reported it
			this.step = m.step;
			return this.onStatus(STEP_TEXT[m.step] ?? m.step, m.step);
		}
		if (m.type === 'out') return this.onOutput(m.text, Boolean(m.err));
		const pending = m.id === undefined ? undefined : this.pending.get(m.id);
		if (m.type === 'error') {
			if (pending) {
				this.pending.delete(m.id);
				pending.reject(new Error(m.message));
			} else this.onOutput(`${m.message}\n`, true);
			return;
		}
		if (pending && pending.type === m.type) {
			this.pending.delete(m.id);
			pending.resolve(m);
		}
	}

	#fail(error) {
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const p of pending) p.reject(error);
	}
}
