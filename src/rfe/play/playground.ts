// The browser lab page (src/pages/labs/[lab]/index.astro): the lab's files, an editor with
// RobotCode, a terminal, Run and Stop, the report and log, and the learner's work kept in
// the browser. Python runs in two workers: the runner (Robot Framework and the shell) and
// the language worker (RobotCode), so a long run never blocks completion and Stop never
// costs the language server.
import { buildZip } from '../lib/zip-core.mjs';
import { RunnerClient, STOPPED_RC } from './client.mjs';
import { LabEditor, isRobotFile, isTextFile } from './editor';
import { readHandover } from './handover.mjs';
import { RESULT_FILE, activateResultsWorker, clearResults, resultUrl, storeResults } from './results.mjs';
import { LabTerminal } from './terminal';
import { unzip } from './unzip.mjs';
import { WorkspaceStore } from './workspace-store.mjs';

type Data = string | Uint8Array;

const page = document.getElementById('rfe-play') as HTMLElement;
const config = {
	lab: page.dataset.lab!,
	folder: page.dataset.folder!,
	zip: page.dataset.zip!,
	base: page.dataset.base!,
	runtime: new URL(page.dataset.runtime!, location.href).href,
	runCommand: page.dataset.run!,
	createSuite: page.dataset.createSuite || '',
};
const rootUri = `file:///work/${config.folder}`;
const $ = <T extends HTMLElement = HTMLElement>(name: string) => page.querySelector<T>(`[data-play="${name}"]`)!;

// ------------------------------------------------------------------ workspace state
let files = new Map<string, Data>();
const dirs = new Set<string>();
let generated: string[] = [];
let archive = { hash: '', files: new Map<string, Data>() };
let lastReport = 'results/report.html';
let lastLog = 'results/log.html';
const store = new WorkspaceStore();

const decoder = new TextDecoder('utf-8', { fatal: true });
function asText(path: string, data: Uint8Array): Data {
	if (!isTextFile(path)) return data;
	try {
		return decoder.decode(data);
	} catch {
		return data;
	}
}

const isGenerated = (path: string) => path.split('/')[0] === 'results' || (!path.includes('/') && RESULT_FILE.test(path));

// ------------------------------------------------------------------ status, notices, dialogs
function setStatus(text: string) {
	$('status').textContent = text;
}

function notice(id: string, html: string | null) {
	const box = $('notices');
	box.querySelector(`[data-notice="${id}"]`)?.remove();
	if (html === null) return;
	const p = document.createElement('p');
	p.className = 'rfe-play__notice';
	p.dataset.notice = id;
	p.innerHTML = html;
	box.append(p);
}

const dialog = $<HTMLDialogElement>('dialog');
// Enter in the text field confirms (the form's first button is Cancel).
dialog.querySelector('input')!.addEventListener('keydown', (event) => {
	if (event.key === 'Enter') {
		event.preventDefault();
		dialog.close('ok');
	}
});
/** A modal question: with `value`, a text field (resolves to its text); otherwise OK/cancel. */
function ask(text: string, { value, ok = 'OK', cancel = 'Cancel', label = '' }: { value?: string; ok?: string; cancel?: string; label?: string } = {}) {
	const field = dialog.querySelector<HTMLLabelElement>('[data-dialog="field"]')!;
	const input = field.querySelector('input')!;
	dialog.querySelector('[data-dialog="text"]')!.textContent = text;
	field.hidden = value === undefined;
	field.querySelector('span')!.textContent = label;
	input.value = value ?? '';
	dialog.querySelector<HTMLButtonElement>('[value="ok"]')!.textContent = ok;
	dialog.querySelector<HTMLButtonElement>('[value="cancel"]')!.textContent = cancel;
	const opener = document.activeElement as HTMLElement | null;
	dialog.showModal();
	if (value !== undefined) input.select();
	return new Promise<string | boolean | null>((resolve) => {
		dialog.addEventListener(
			'close',
			() => {
				opener?.focus();
				if (dialog.returnValue !== 'ok') resolve(value === undefined ? false : null);
				else resolve(value === undefined ? true : input.value.trim());
			},
			{ once: true },
		);
	});
}

// ------------------------------------------------------------------ workers
const runner = new RunnerClient({
	createWorker: () => new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module', name: 'rfe-runner' }),
	runtime: config.runtime,
	folder: config.folder,
	files: [],
	onStatus: (text, step) => {
		setStatus(text);
		if (step !== 'ready') terminal?.notice(`\x1b[2m${text}\x1b[0m`);
	},
	onOutput: (text, isError) => terminal.write(isError ? `\x1b[31m${text}\x1b[0m` : text),
});

/** RobotCode in its own worker; the editor connects once it is ready. */
const language = {
	worker: null as Worker | null,
	handlers: new Set<(message: string) => void>(),
	transport: {
		send: (message: string) => language.worker?.postMessage({ type: 'lsp', data: message }),
		subscribe: (handler: (message: string) => void) => language.handlers.add(handler),
		unsubscribe: (handler: (message: string) => void) => language.handlers.delete(handler),
	},
	start() {
		if (language.worker) return;
		page.dataset.language = 'starting';
		const worker = new Worker(new URL('./language.worker.ts', import.meta.url), { type: 'module', name: 'rfe-language' });
		language.worker = worker;
		worker.onmessage = (event) => {
			const m = event.data;
			if (m.type === 'lsp') for (const h of language.handlers) h(m.data);
			else if (m.type === 'unavailable') {
				page.dataset.language = 'unavailable';
				notice('language', `${escapeHtml(m.message)}. Highlighting, Run and the terminal still work.`);
			} else if (m.type === 'ready' && m.available) {
				page.dataset.language = 'ready';
				editor.connect({ transport: language.transport, rootUri, display });
			}
		};
		worker.onerror = () => {
			page.dataset.language = 'unavailable';
			notice('language', 'Language features are unavailable. Highlighting, Run and the terminal still work.');
		};
		worker.postMessage({ type: 'init', id: 1, runtime: config.runtime, folder: config.folder, files: fileList() });
	},
	post(message: object) {
		language.worker?.postMessage(message);
	},
	stop() {
		editor.disconnect();
		language.worker?.terminate();
		language.worker = null;
		page.dataset.language = 'off';
	},
};

const fileList = () => [...files].map(([path, data]) => ({ path, data }));
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ editor
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: { path: string; text: string } | null = null;

function flushWrite() {
	clearTimeout(writeTimer);
	if (!pendingWrite) return;
	const { path, text } = pendingWrite;
	pendingWrite = null;
	files.set(path, text);
	runner.write(path, text);
	language.post({ type: 'write', path, data: text });
	scheduleSave();
}

function scheduleSave() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(save, 400);
}

async function save() {
	clearTimeout(saveTimer);
	const record = new Map(files);
	for (const d of dirs) record.set(`${d}/`, '');
	await store.save(config.lab, archive.hash, record);
}

const editor = new LabEditor($('editor'), {
	onChange: (text) => {
		if (!editor.path || editor.view.state.readOnly) return;
		pendingWrite = { path: editor.path, text };
		clearTimeout(writeTimer);
		writeTimer = setTimeout(flushWrite, 250);
	},
	onRun: () => runAll(),
});

async function openFile(path: string) {
	flushWrite();
	const data = files.get(path);
	if (data === undefined) {
		if (!generated.includes(path)) return;
		if (RESULT_FILE.test(path) && /\.html$/.test(path)) return openResult(path);
		const bytes = await runner.read(path);
		const text = asText(path, bytes);
		editor.open(path, typeof text === 'string' ? text : `(${bytes.length} bytes of binary data)`, { readOnly: true, replace: true });
	} else if (typeof data !== 'string') {
		editor.open(path, `(${data.length} bytes of binary data: download the workspace to open it)`, { readOnly: true, replace: true });
	} else editor.open(path, data);
	$('current').textContent = path;
	renderFiles();
}

/** Go to definition: show the file and return the editor. */
async function display(uri: string) {
	const prefix = `${rootUri}/`;
	if (!uri.startsWith(prefix)) return null;
	await openFile(decodeURIComponent(uri.slice(prefix.length)));
	return editor.view;
}

// ------------------------------------------------------------------ file list
type Tree = { dirs: Map<string, Tree>; files: string[] };
function tree(paths: string[], extraDirs: Iterable<string> = []) {
	const root: Tree = { dirs: new Map(), files: [] };
	const dirOf = (parts: string[]) => {
		let node = root;
		for (const part of parts) {
			if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
			node = node.dirs.get(part)!;
		}
		return node;
	};
	for (const d of extraDirs) dirOf(d.split('/'));
	for (const p of paths) {
		const parts = p.split('/');
		dirOf(parts.slice(0, -1)).files.push(p);
	}
	return root;
}

function button(label: string, onClick: () => void, attrs: Record<string, string> = {}) {
	const b = document.createElement('button');
	b.type = 'button';
	b.textContent = label;
	for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
	b.addEventListener('click', onClick);
	return b;
}

function renderTree(node: Tree, prefix: string, depth: number, list: HTMLElement, { actions }: { actions: boolean }) {
	for (const [name, child] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
		const path = prefix + name;
		const li = document.createElement('li');
		li.className = 'rfe-play__entry rfe-play__entry--dir';
		li.style.setProperty('--depth', String(depth));
		const label = document.createElement('span');
		label.className = 'rfe-play__dirname';
		label.textContent = `${name}/`;
		li.append(label);
		if (actions) {
			li.append(
				button('Rename', () => renameEntry(path, true), { class: 'rfe-play__action', 'aria-label': `Rename folder ${path}` }),
				button('Delete', () => deleteEntry(path, true), { class: 'rfe-play__action', 'aria-label': `Delete folder ${path}` }),
			);
		}
		list.append(li);
		renderTree(child, `${path}/`, depth + 1, list, { actions });
	}
	for (const path of node.files.sort((a, b) => a.localeCompare(b))) {
		const li = document.createElement('li');
		li.className = 'rfe-play__entry';
		li.style.setProperty('--depth', String(depth));
		const open = button(path.split('/').pop()!, () => openFile(path), { class: 'rfe-play__open', 'data-path': path, title: path });
		if (path === editor.path) open.setAttribute('aria-current', 'true');
		li.append(open);
		if (actions) {
			li.append(
				button('Rename', () => renameEntry(path, false), { class: 'rfe-play__action', 'aria-label': `Rename ${path}` }),
				button('Delete', () => deleteEntry(path, false), { class: 'rfe-play__action', 'aria-label': `Delete ${path}` }),
			);
		}
		list.append(li);
	}
}

function renderFiles() {
	const list = $('files');
	list.replaceChildren();
	renderTree(tree([...files.keys()], dirs), '', 0, list, { actions: true });
	const results = generated.filter((p) => !files.has(p));
	const resultList = $('results-list');
	resultList.replaceChildren();
	renderTree(tree(results), '', 0, resultList, { actions: false });
	$('results-group').hidden = results.length === 0;
}

const validPath = (p: string) => /^[\w.-]+(\/[\w.-]+)*$/.test(p) && !p.split('/').some((s) => s === '..' || s === '.') && !isGenerated(p);

async function newFile() {
	const path = await ask('New file', { value: editor.path.includes('/') ? editor.path.replace(/[^/]+$/, '') : '', label: 'Path in the lab, for example libraries/CartMath.py', ok: 'Create' });
	if (typeof path !== 'string' || !path) return;
	if (!validPath(path)) return void notice('path', `“${escapeHtml(path)}” is not a valid file path in the lab.`);
	notice('path', null);
	if (!files.has(path)) {
		files.set(path, '');
		runner.write(path, '');
		language.post({ type: 'write', path, data: '' });
		for (const d of [...dirs]) if (path.startsWith(`${d}/`)) dirs.delete(d);
		scheduleSave();
	}
	await openFile(path);
	editor.focus();
}

async function newFolder() {
	const path = await ask('New folder', { value: '', label: 'Folder path in the lab, for example libraries', ok: 'Create' });
	if (typeof path !== 'string' || !path) return;
	if (!validPath(path)) return void notice('path', `“${escapeHtml(path)}” is not a valid folder path in the lab.`);
	notice('path', null);
	dirs.add(path.replace(/\/+$/, ''));
	scheduleSave();
	renderFiles();
}

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

async function renameEntry(from: string, isDir: boolean) {
	flushWrite();
	const to = await ask(`Rename ${isDir ? 'folder ' : ''}${from}`, { value: from, label: 'New path', ok: 'Rename' });
	if (typeof to !== 'string' || !to || to === from) return;
	if (!validPath(to) || [...files.keys()].some((p) => under(p, to))) return void notice('path', `“${escapeHtml(to)}” can’t be used: it is not a valid path or already exists.`);
	notice('path', null);
	for (const [p, data] of [...files]) {
		if (under(p, from)) {
			files.delete(p);
			files.set(to + p.slice(from.length), data);
			editor.forget(p);
		}
	}
	for (const d of [...dirs]) {
		if (under(d, from)) {
			dirs.delete(d);
			dirs.add(to + d.slice(from.length));
		}
	}
	runner.rename(from, to);
	language.post({ type: 'rename', from, to });
	scheduleSave();
	if (under(editor.path, from)) await openFile(to + editor.path.slice(from.length));
	else renderFiles();
}

async function deleteEntry(path: string, isDir: boolean) {
	const ok = await ask(`Delete ${isDir ? 'the folder ' : ''}${path}${isDir ? ' and everything in it' : ''}?`, { ok: 'Delete' });
	if (!ok) return;
	if (editor.path && under(editor.path, path)) pendingWrite = null;
	for (const p of [...files.keys()]) if (under(p, path)) files.delete(p);
	for (const d of [...dirs]) if (under(d, path)) dirs.delete(d);
	editor.forget(path);
	runner.delete(path);
	language.post({ type: 'delete', path });
	scheduleSave();
	if (editor.path && under(editor.path, path)) await openFile(firstFile());
	else renderFiles();
}

function firstFile() {
	const paths = [...files.keys()];
	return paths.find((p) => p.startsWith('checks/') && isRobotFile(p)) ?? paths.find(isRobotFile) ?? paths.find((p) => p === 'LAB.md') ?? paths[0] ?? '';
}

// ------------------------------------------------------------------ terminal and runs
const prompt = () => `\x1b[36m${config.folder}\x1b[0m $ `;
const terminal = new LabTerminal($('terminal'), prompt, {
	onCommand: (line) => void execute(line),
	onInterrupt: () => stop(),
	onLink: (uri) => {
		const prefix = `file:///work/${config.folder}/`;
		if (!uri.startsWith(prefix)) return;
		const path = uri.slice(prefix.length);
		if (RESULT_FILE.test(path) && /\.html$/.test(path)) openResult(path);
		else void openFile(path);
	},
});

function setRunning(running: boolean) {
	page.dataset.runner = running ? 'running' : 'ready';
	$<HTMLButtonElement>('run').disabled = running;
	$<HTMLButtonElement>('stop').disabled = !running;
	terminal.busy = running;
}

const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

async function execute(line: string) {
	if (runner.busy || page.dataset.runner !== 'ready') return;
	flushWrite();
	setRunning(true);
	const t0 = performance.now();
	const done = await runner.exec(line, terminal.cols);
	const ms = performance.now() - t0;
	if (done.stopped) {
		terminal.write(`\r\n\x1b[33mStopped (exit ${STOPPED_RC} · ${duration(ms)}).\x1b[0m Python restarts with your files; no reload needed.\r\n`);
		return;
	}
	for (const f of done.changed) {
		const data = asText(f.path, f.data);
		files.set(f.path, data);
		if (typeof data === 'string') editor.setText(f.path, data);
		language.post({ type: 'write', path: f.path, data: f.data });
	}
	for (const p of done.deleted) {
		files.delete(p);
		editor.forget(p);
		language.post({ type: 'delete', path: p });
	}
	if (done.changed.length || done.deleted.length) scheduleSave();
	generated = done.files.filter(isGenerated);
	if (done.results.length) {
		await resultsReady.catch(() => {});
		await storeResults(config.base, config.lab, done.results);
		lastReport = done.results.find((r: { path: string }) => /report\.html$/.test(r.path))?.path ?? lastReport;
		lastLog = done.results.find((r: { path: string }) => /log\.html$/.test(r.path))?.path ?? lastLog;
		updateResultButtons();
		language.post({ type: 'refresh' });
	}
	const colour = done.rc === 0 ? '32' : '31';
	terminal.write(`\x1b[2m[\x1b[0m\x1b[${colour}mexit ${done.rc}\x1b[0m\x1b[2m · ${duration(ms)}]\x1b[0m\r\n`);
	setRunning(false);
	renderFiles();
	terminal.showPrompt();
}

function runAll() {
	if (page.dataset.runner !== 'ready') return;
	if (!config.createSuite || [...files.keys()].some((p) => p.startsWith('checks/'))) return terminal.run(config.runCommand);
	terminal.notice(`This lab has no checks/ folder yet. The lesson asks you to create \x1b[1m${config.createSuite}\x1b[0m: use New file, then press Run.`);
}

async function stop() {
	if (!runner.busy) return;
	page.dataset.runner = 'starting';
	$<HTMLButtonElement>('stop').disabled = true;
	terminal.busy = false;
	setStatus('Stopping…');
	try {
		await runner.stop();
		setRunning(false);
		setStatus('Ready');
		terminal.showPrompt();
	} catch (error) {
		setStatus(`Python could not restart: ${(error as Error).message}`);
	}
}

// ------------------------------------------------------------------ results
let resultsReady: Promise<unknown> = Promise.resolve();

function updateResultButtons() {
	const has = (p: string) => generated.includes(p);
	$<HTMLButtonElement>('report').disabled = !has(lastReport);
	$<HTMLButtonElement>('log').disabled = !has(lastLog);
}

/** The report and log take the course's light or dark theme (`?theme=`). */
const themed = (url: string) => `${url}?theme=${document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}`;

const viewer = $<HTMLDialogElement>('viewer');
let viewerOpener: HTMLElement | null = null;

/** Show a result page in the viewer, a dialog that fills the window. */
async function openResult(path: string, fragment = '') {
	await resultsReady;
	const url = themed(resultUrl(config.base, config.lab, path)) + fragment;
	const frame = $<HTMLIFrameElement>('viewer-frame');
	frame.src = url;
	frame.title = `${path} of the last run`;
	$('viewer-title').textContent = path;
	$<HTMLAnchorElement>('viewer-tab').href = url;
	if (!viewer.open) {
		viewerOpener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : $('report');
		viewer.showModal();
	}
	page.dataset.viewer = 'open';
	$('viewer-close').focus();
}

function closeViewer() {
	if (viewer.open) viewer.close();
}

// Close button, Escape, or close(): reset the frame and return focus.
viewer.addEventListener('close', () => {
	page.dataset.viewer = '';
	$<HTMLIFrameElement>('viewer-frame').src = 'about:blank';
	(viewerOpener?.isConnected ? viewerOpener : $('report')).focus();
	viewerOpener = null;
});

// ------------------------------------------------------------------ download and reset
function downloadWorkspace() {
	flushWrite();
	const zip = buildZip(fileList().map((f) => ({ path: `${config.folder}/${f.path}`, data: f.data })), { mtime: new Date() });
	const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = `${config.lab}-workspace.zip`;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function resetLab() {
	if (!(await ask('Reset the lab? This replaces your files with the original lab files and removes your changes.', { ok: 'Reset lab' }))) return;
	if (runner.busy) await stop();
	pendingWrite = null;
	files = new Map(archive.files);
	dirs.clear();
	generated = [];
	updateResultButtons();
	await store.remove(config.lab);
	await clearResults(config.base, config.lab).catch(() => {});
	for (const p of [...files.keys()]) editor.forget(p);
	notice('updated', null);
	language.stop();
	page.dataset.runner = 'starting';
	await runner.reset([...files]);
	setRunning(false);
	if (startLanguageNow()) language.start();
	await openFile(firstFile());
	terminal.notice('\x1b[2mThe lab is back to its original files.\x1b[0m');
	setStatus('Ready');
}

// ------------------------------------------------------------------ start-up
async function sha256(bytes: ArrayBuffer) {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** On small devices RobotCode starts when the editor is first used, not with the page. */
function startLanguageNow() {
	const memory = (navigator as { deviceMemory?: number }).deviceMemory;
	return !((memory !== undefined && memory <= 4) || matchMedia('(max-width: 50rem)').matches);
}

/** Files a lesson handed over in the address (`#add=…`): added, never run. Returns their paths. */
async function applyHandover() {
	const handed = readHandover(location.hash);
	if (!handed) return null;
	window.history.replaceState(null, '', location.pathname + location.search);
	const written: string[] = [];
	for (const f of handed) {
		const existing = files.get(f.path);
		if (existing === f.text) continue;
		if (typeof existing === 'string') {
			const replace = await ask(`${f.path} already has your own version. Replace it with the one from the lesson, or keep yours?`, { ok: 'Replace it', cancel: 'Keep mine' });
			if (!replace) continue;
		}
		files.set(f.path, f.text);
		editor.forget(f.path);
		written.push(f.path);
	}
	await save();
	return { first: handed[0].path, written };
}

async function start() {
	page.dataset.runner = 'starting';
	page.dataset.language = 'off';
	setStatus('Preparing the lab…');
	const response = await fetch(config.zip);
	if (!response.ok) throw new Error(`the lab archive could not be loaded (HTTP ${response.status})`);
	const bytes = await response.arrayBuffer();
	archive = { hash: await sha256(bytes), files: new Map() };
	const prefix = `${config.folder}/`;
	for (const f of await unzip(bytes)) if (f.path.startsWith(prefix)) archive.files.set(f.path.slice(prefix.length), asText(f.path, f.data));

	const saved = await store.load(config.lab);
	if (saved) {
		files = new Map();
		for (const [p, data] of saved.files) {
			if (p.endsWith('/')) dirs.add(p.slice(0, -1));
			else files.set(p, data);
		}
		if (saved.archive !== archive.hash) {
			notice('updated', 'This lab was updated since you started it. Your files are kept; <strong>Reset lab</strong> loads the new version.');
		}
	} else files = new Map(archive.files);
	if (!(await store.persistent())) {
		notice('storage', 'This browser doesn’t let the page store data, so your edits are lost when you leave. Use <strong>Download workspace</strong> to keep them.');
	}

	const handed = await applyHandover();
	await openFile(handed?.first ?? firstFile());

	resultsReady = activateResultsWorker(config.base).then(
		() => (page.dataset.results = 'ready'),
		(error) => {
			page.dataset.results = 'unavailable';
			notice('results', `Reports and logs can’t be shown in this browser: ${escapeHtml(error.message)}.`);
		},
	);
	runner.files = new Map(files);
	if (startLanguageNow()) language.start();
	else $('editor').addEventListener('focusin', () => language.start(), { once: true });
	await runner.start();
	setRunning(false);
	setStatus('Ready');
	terminal.write('\x1b[2mType help for the commands of this terminal. Run (or Ctrl+Enter) runs: \x1b[0m' + config.runCommand + '\r\n');
	terminal.showPrompt();
}

// ------------------------------------------------------------------ controls
$('run').addEventListener('click', runAll);
$('stop').addEventListener('click', () => void stop());
$('report').addEventListener('click', () => void openResult(lastReport));
$('log').addEventListener('click', () => void openResult(lastLog));
$('viewer-close').addEventListener('click', closeViewer);
$('download').addEventListener('click', downloadWorkspace);
$('reset').addEventListener('click', () => void resetLab());
$('new-file').addEventListener('click', () => void newFile());
$('new-folder').addEventListener('click', () => void newFolder());
page.addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.defaultPrevented) {
		event.preventDefault();
		runAll();
	}
});
// A lesson link into a playground that is already open in this tab.
addEventListener('hashchange', async () => {
	if (page.dataset.runner === 'starting' || page.dataset.runner === 'failed') return;
	flushWrite();
	const handed = await applyHandover();
	if (!handed) return;
	for (const path of handed.written) {
		runner.write(path, files.get(path)!);
		language.post({ type: 'write', path, data: files.get(path) });
	}
	await openFile(handed.first);
});
addEventListener('beforeunload', () => {
	flushWrite();
	void save();
});
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') {
		flushWrite();
		void save();
	}
});

/** For the end-to-end checks: read-only views of the page state. */
(window as unknown as { __rfePlay: object }).__rfePlay = {
	terminalText: () => terminal.text(),
	editorPath: () => editor.path,
	editorText: () => editor.text(),
	files: () => [...files.keys()],
	generated: () => [...generated],
	view: () => editor.view,
};

start().catch((error) => {
	page.dataset.runner = 'failed';
	setStatus('The browser lab could not start.');
	notice('start', `The browser lab could not start: ${escapeHtml(String(error?.message ?? error))}. Download the lab to work on your machine.`);
});
