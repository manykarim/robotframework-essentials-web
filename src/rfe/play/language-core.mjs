// Language side of the browser lab: RobotCode in Pyodide behind the bridge (rfe_bridge.py).
// This is the message handler of language.worker.ts; the Node tests drive it directly.
//
// Messages in: init { folder, files }, write { path, data }, delete { path },
//   rename { from, to }, lsp { data } (one JSON-RPC message), refresh (after a run).
// Messages out: status { step }, ready { id, root }, lsp { data },
//   unavailable { message } (RobotCode could not start; the editor keeps highlighting).
import { installModules, startPython, workspacePath } from './runtime.mjs';

export const LANGUAGE_GROUPS = ['core', 'language'];
const WATCHED = /\.(robot|resource|py|txt|tsv|rst|json|ya?ml)$/i;

/**
 * @param {{
 *   loadPyodide: (options: object) => Promise<any>,
 *   indexURL: string,
 *   lock: any,
 *   readBytes: (file: string) => Promise<Uint8Array>,
 *   sources: Record<string, string>,
 *   post: (message: any) => void,
 * }} options
 */
export function createLanguageServer({ loadPyodide, indexURL, lock, readBytes, sources, post }) {
	let py;
	let bridge = null;
	let root = '/work';
	/** @type {Set<string>} documents the editor has open (it sends their text itself) */
	const open = new Set();

	const uri = (rel) => `file://${root}/${workspacePath(rel)}`;
	const full = (rel) => `${root}/${workspacePath(rel)}`;
	function writeFile(rel, data) {
		const path = full(rel);
		py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
		py.FS.writeFile(path, data);
	}
	const exists = (rel) => py.FS.analyzePath(full(rel)).exists;
	const notify = (rel, kind) => {
		if (bridge && WATCHED.test(rel) && !open.has(uri(rel))) bridge.file_changed(uri(rel), kind);
	};

	async function init(m) {
		if (!py) {
			try {
				({ py } = await startPython({ loadPyodide, indexURL, lock, groups: LANGUAGE_GROUPS, readBytes, status: (step) => post({ type: 'status', step }) }));
				installModules(py, sources);
			} catch (error) {
				py = undefined;
				post({ type: 'unavailable', message: `Language features are unavailable: ${error?.message ?? error}` });
				return post({ type: 'ready', id: m.id, root, available: false });
			}
		}
		const ws = py.pyimport('rfe_workspace');
		root = ws.reset(m.folder);
		for (const f of m.files) writeFile(f.path, f.data);
		try {
			const { Bridge } = py.pyimport('rfe_bridge');
			bridge = Bridge((text) => post({ type: 'lsp', data: text }));
		} catch (error) {
			const reason = String(error?.message ?? error).split('\n').filter(Boolean).at(-1);
			post({ type: 'unavailable', message: `Language features are unavailable: ${reason}` });
		}
		post({ type: 'ready', id: m.id, root, available: Boolean(bridge) });
	}

	async function handle(m) {
		if (m.type === 'init') return init(m);
		if (!py) return; // not started, or unavailable: the editor works without language features
		switch (m.type) {
			case 'write': {
				const kind = exists(m.path) ? 2 : 1;
				writeFile(m.path, m.data);
				return notify(m.path, kind);
			}
			case 'delete':
				py.pyimport('rfe_workspace').remove(workspacePath(m.path));
				return notify(m.path, 3);
			case 'rename': {
				const to = full(m.to);
				py.FS.mkdirTree(to.slice(0, to.lastIndexOf('/')));
				py.FS.rename(full(m.from), to);
				notify(m.from, 3);
				return notify(m.to, 1);
			}
			case 'lsp': {
				if (!bridge) return;
				const message = JSON.parse(m.data);
				if (message.method === 'textDocument/didOpen') open.add(message.params.textDocument.uri);
				if (message.method === 'textDocument/didClose') open.delete(message.params.textDocument.uri);
				return bridge.receive(m.data);
			}
			case 'refresh':
				return bridge?.refresh();
			default:
				throw new Error(`unknown message "${m.type}"`);
		}
	}

	let queue = Promise.resolve();
	return {
		onMessage(m) {
			queue = queue.then(() => handle(m)).catch((error) => post({ type: 'error', id: m.id, message: String(error?.message ?? error) }));
			return queue;
		},
	};
}
