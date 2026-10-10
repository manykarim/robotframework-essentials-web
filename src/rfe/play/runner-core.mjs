// Runner side of the browser lab: Robot Framework, the terminal's shell and the in-browser
// substitutes, in Pyodide. This is the message handler of runner.worker.ts; the Node tests
// drive it directly.
//
// Messages in (handled one at a time, in order):
//   init   { folder, files: [{ path, data }] }   start Python (first time), fresh workspace
//   write  { path, data }    delete { path }    rename { from, to }
//   read   { id, path }      list { id }        exec { id, line, cols }
// Messages out:
//   status { step: 'python' | 'packages' | 'lab' | 'ready', ms }   start-up progress
//   ready  { id, root, files, timings }   out { text, err }   read { id, path, data }
//   files  { id, files }   done { id, rc, ms, files, changed, deleted, results }
//     (changed/deleted: the learner's files the command touched; results: result files it wrote)
//   error  { id, message }
import { addGroups, describeGroup, installModules, startPython, workspacePath } from './runtime.mjs';

export const RUNNER_GROUPS = ['core'];
export const WORK = '/work';

/**
 * @param {{
 *   loadPyodide: (options: object) => Promise<any>,
 *   indexURL: string,
 *   lock: any,
 *   readBytes: (file: string) => Promise<Uint8Array>,
 *   sources: Record<string, string>,
 *   post: (message: any, transfer?: Transferable[]) => void,
 *   now?: () => number,
 * }} options
 */
export function createRunner({ loadPyodide, indexURL, lock, readBytes, sources, post, now = () => performance.now() }) {
	const started = now();
	const timings = {};
	/** @type {any} */
	let py;
	/** @type {Set<string>} */
	let loaded;
	let ws, shell, demo;
	let root = WORK;
	const status = (step) => {
		timings[step] = Math.round(now() - started);
		post({ type: 'status', step, ms: timings[step] });
	};

	async function boot() {
		({ py, loaded } = await startPython({ loadPyodide, indexURL, lock, groups: RUNNER_GROUPS, readBytes, status }));
		installModules(py, sources);
		ws = py.pyimport('rfe_workspace');
		shell = py.pyimport('rfe_shell');
		demo = py.pyimport('rfe_demo_shop');
		py.pyimport('rfe_process').install();
		py.pyimport('rfe_timeouts').install();
		const packages = describeGroup(lock, 'core', ['robotframework', 'robotframework-requests', 'robotframework-pythonlibcore']);
		shell.configure(
			(text, err) => post({ type: 'out', text, err }),
			async (group) => {
				await addGroups(py, { lock, groups: [group], readBytes, loaded });
			},
			`${packages}, robotframework-robocop ${lock.files.find((f) => f.name === 'robotframework-robocop')?.version}`,
		);
	}

	const full = (rel) => `${root}/${workspacePath(rel)}`;
	function writeFile(rel, data) {
		const path = full(rel);
		py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
		py.FS.writeFile(path, data);
	}
	const readFile = (rel) => py.FS.readFile(full(rel));
	const listFiles = () => JSON.parse(ws.list_files());

	async function init(m) {
		if (!py) await boot();
		status('lab');
		root = ws.reset(m.folder);
		for (const f of m.files) writeFile(f.path, f.data);
		const routes = demo.install(root);
		routes.destroy?.();
		status('ready');
		post({ type: 'ready', id: m.id, root, files: listFiles(), timings: { ...timings } });
	}

	async function exec(m) {
		const t0 = now();
		const before = ws.snapshot();
		const rc = await shell.sh(m.line, m.cols ?? 100);
		const { changed, deleted, results: written } = JSON.parse(ws.changes(before));
		before.destroy();
		const changedFiles = changed.map((path) => ({ path, data: readFile(path) }));
		const results = written.map((path) => ({ path, data: readFile(path) }));
		post(
			{ type: 'done', id: m.id, rc, ms: Math.round(now() - t0), files: listFiles(), changed: changedFiles, deleted, results },
			[...new Set([...changedFiles, ...results].map((f) => f.data.buffer))],
		);
	}

	async function handle(m) {
		if (m.type === 'init') return init(m);
		if (!py) throw new Error(`"${m.type}" before "init"`);
		switch (m.type) {
			case 'write':
				return writeFile(m.path, m.data);
			case 'delete':
				return ws.remove(workspacePath(m.path));
			case 'rename': {
				const to = full(m.to);
				py.FS.mkdirTree(to.slice(0, to.lastIndexOf('/')));
				return py.FS.rename(full(m.from), to);
			}
			case 'read': {
				const data = readFile(m.path);
				return post({ type: 'read', id: m.id, path: m.path, data }, [data.buffer]);
			}
			case 'list':
				return post({ type: 'files', id: m.id, files: listFiles() });
			case 'exec':
				return exec(m);
			default:
				throw new Error(`unknown message "${m.type}"`);
		}
	}

	let queue = Promise.resolve();
	return {
		/** Queue a message; the returned promise settles when it has been handled. */
		onMessage(m) {
			queue = queue
				.then(() => handle(m))
				.catch((error) => post({ type: 'error', id: m.id, message: String(error?.message ?? error) }));
			return queue;
		},
	};
}
