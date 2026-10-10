// Node test helpers: start the runtime from the staged files (public/rfe-runtime/), with the
// real lab files, exactly as the workers do in the browser. Used by the *.test.mjs files only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { labEntries, labFolder } from '../lib/labs.mjs';
import { lessonFences } from './blocks.mjs';
import { createLanguageServer } from './language-core.mjs';
import { createRunner } from './runner-core.mjs';
import { runtimeFolder } from './runtime.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const lock = JSON.parse(readFileSync(path.join(REPO, 'src/rfe/play/runtime.lock.json'), 'utf8'));
export const course = JSON.parse(readFileSync(path.join(REPO, 'src/rfe/generated/course.json'), 'utf8'));
export const STAGED = path.join(REPO, 'public', runtimeFolder(lock));

/** The staged Pyodide loader; fails with a hint when the runtime was not staged. */
export async function stagedLoadPyodide() {
	if (!existsSync(path.join(STAGED, 'pyodide.mjs'))) {
		throw new Error(`runtime not staged in ${path.relative(REPO, STAGED)}: run \`npm run runtime\` first`);
	}
	return (await import(pathToFileURL(path.join(STAGED, 'pyodide.mjs')).href)).loadPyodide;
}

export const readStaged = async (file) => new Uint8Array(await readFile(path.join(STAGED, file)));

/** The runtime's Python modules, as the worker bundles them. */
export function pythonSources() {
	const dir = path.join(REPO, 'src/rfe/play/python');
	return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.py')).sort().map((f) => [f, readFileSync(path.join(dir, f), 'utf8')]));
}

/** A lab's files as in its archive, relative to the archive folder. */
export function labFiles(labId) {
	const folder = labFolder(labId);
	return labEntries(course, labId, { site: new URL('https://example.invalid/'), root: REPO }).map((e) => ({
		path: e.path.slice(folder.length + 1),
		data: typeof e.data === 'string' ? new TextEncoder().encode(e.data) : new Uint8Array(e.data),
	}));
}

/**
 * A runner driven like the worker: `init(labId)`, then `exec(line)` returns the done message
 * with the streamed output collected as `text`.
 */
export async function startRunner() {
	const messages = [];
	let output = '';
	const runner = createRunner({
		loadPyodide: await stagedLoadPyodide(),
		indexURL: STAGED + path.sep,
		lock,
		readBytes: readStaged,
		sources: pythonSources(),
		post: (m) => {
			if (m.type === 'out') output += m.text;
			messages.push(m);
		},
	});
	let seq = 0;
	const reply = async (message, type) => {
		const id = ++seq;
		const from = messages.length;
		await runner.onMessage({ ...message, id });
		const found = messages.slice(from).find((m) => m.id === id && (m.type === type || m.type === 'error'));
		if (found?.type === 'error') throw new Error(found.message);
		return found;
	};
	return {
		runner,
		messages,
		init: (labId, extra = []) => reply({ type: 'init', folder: labFolder(labId), files: [...labFiles(labId), ...extra] }, 'ready'),
		write: (p, text) => runner.onMessage({ type: 'write', path: p, data: text }),
		read: async (p) => new TextDecoder().decode((await reply({ type: 'read', path: p }, 'read')).data),
		async exec(line, cols = 100) {
			output = '';
			const done = await reply({ type: 'exec', line, cols }, 'done');
			return { ...done, text: output };
		},
	};
}

/** Remove ANSI escapes, for assertions on console text. */
export const plain = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\]8;[^\x1b]*\x1b\\/g, '');

/** The fenced blocks of a lesson page (see blocks.mjs), e.g. `lessonFencesOf('ch23-running-with-confidence', 'timeouts')`. */
export function lessonFencesOf(chapterId, slug) {
	return lessonFences(readFileSync(path.join(REPO, 'src/content/docs', chapterId, `${slug}.md`), 'utf8'));
}

/**
 * The language server driven like the worker. `request(method, params)` resolves with the
 * response; `diagnostics(uri, until)` waits for a publishDiagnostics that satisfies `until`.
 */
export async function startLanguage({ sources = pythonSources() } = {}) {
	const messages = [];
	const lsp = [];
	const server = createLanguageServer({
		loadPyodide: await stagedLoadPyodide(),
		indexURL: STAGED + path.sep,
		lock,
		readBytes: readStaged,
		sources,
		post: (m) => {
			messages.push(m);
			if (m.type === 'lsp') lsp.push(JSON.parse(m.data));
		},
	});
	let seq = 0;
	const send = (message) => server.onMessage({ type: 'lsp', data: JSON.stringify({ jsonrpc: '2.0', ...message }) });
	const waitFor = async (find, ms = 15000) => {
		const t0 = Date.now();
		for (;;) {
			const found = find();
			if (found) return found;
			if (Date.now() - t0 > ms) throw new Error('timed out waiting for the language server');
			await new Promise((r) => setTimeout(r, 20));
		}
	};
	return {
		server,
		messages,
		lsp,
		async init(labId, extra = []) {
			await server.onMessage({ type: 'init', id: 1, folder: labFolder(labId), files: [...labFiles(labId), ...extra] });
			return messages.find((m) => m.type === 'ready' || m.type === 'error');
		},
		send,
		async request(method, params) {
			const id = 1000 + ++seq;
			await send({ id, method, params });
			return (await waitFor(() => lsp.find((m) => m.id === id && !m.method))).result;
		},
		/** The next publishDiagnostics for `uri` (after message index `from`) that satisfies `until`. */
		diagnostics(uri, until = () => true, from = 0) {
			return waitFor(() => lsp.slice(from).find((m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri && until(m.params.diagnostics))?.params.diagnostics);
		},
	};
}
