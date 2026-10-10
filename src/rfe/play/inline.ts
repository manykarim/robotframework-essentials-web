// Inline runs of lesson examples ("Run in browser"): loaded on the first click. Each run
// starts from a fresh copy of the lesson's lab, writes the block to checks/_example.robot
// and runs it; the learner's saved browser-lab workspace is never touched.
import { ansiToHtml } from './ansi.mjs';
import { RunnerClient } from './client.mjs';
import { handoverUrl } from './handover.mjs';
import { activateResultsWorker, resultUrl, storeResults } from './results.mjs';
import { pyodide } from './runtime.lock.json';
import { runtimeFolder } from './runtime.mjs';
import { unzip } from './unzip.mjs';

type Data = string | Uint8Array;
export const EXAMPLE_FILE = 'checks/_example.robot';
const COMMAND = `robot --outputdir results --consolewidth 78 ${EXAMPLE_FILE}`;

let client: RunnerClient | null = null;
let clientLab = '';
/** Where the shared runner's progress and output go: the run in progress. */
let sink: { progress: (text: string) => void; output: (text: string) => void } | null = null;
const archives = new Map<string, Map<string, Data>>();
let queue: Promise<unknown> = Promise.resolve();

async function labFiles(base: string, lab: string) {
	if (!archives.has(lab)) {
		const response = await fetch(`${base}/labs/${lab}.zip`);
		if (!response.ok) throw new Error(`the lab could not be loaded (HTTP ${response.status})`);
		const prefix = `rfe-${lab}/`;
		const files = new Map<string, Data>();
		for (const f of await unzip(await response.arrayBuffer())) if (f.path.startsWith(prefix)) files.set(f.path.slice(prefix.length), f.data);
		archives.set(lab, files);
	}
	return archives.get(lab)!;
}

const element = (tag: string, className: string, text = '') => {
	const el = document.createElement(tag);
	el.className = className;
	el.textContent = text;
	return el;
};

const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

interface InlineRun {
	block: HTMLElement;
	run: HTMLElement;
	base: string;
	lab: string;
	file: string;
	code: string;
}

/** Run one block; runs on a page wait for each other. */
export function runInline(options: InlineRun) {
	const next = queue.then(() => runNow(options));
	queue = next.catch(() => {});
	return next;
}

async function runNow({ run, base, lab, file, code }: InlineRun) {
	run.setAttribute('aria-busy', 'true');
	try {
		return await runBlock({ run, base, lab, file, code });
	} finally {
		run.setAttribute('aria-busy', 'false');
		run.dataset.runs = String(Number(run.dataset.runs ?? 0) + 1);
	}
}

async function runBlock({ run, base, lab, file, code }: Omit<InlineRun, 'block'>) {
	run.querySelector('.rfe-run__output')?.remove();
	run.querySelector('.rfe-run__links')?.remove();
	const output = element('pre', 'rfe-run__output');
	output.setAttribute('role', 'log');
	output.setAttribute('aria-label', 'Output of the run');
	output.tabIndex = 0;
	run.append(output);
	let text = '';
	const show = (more: string) => {
		text += more;
		output.innerHTML = ansiToHtml(text);
		output.scrollTop = output.scrollHeight;
	};
	const progress = (step: string) => {
		output.innerHTML = '';
		output.append(element('span', 'rfe-ansi-dim', `Starting Python in your browser: ${step}`));
	};
	const t0 = performance.now();
	sink = {
		progress,
		output: (chunk) => {
			if (!text) output.innerHTML = '';
			show(chunk);
		},
	};
	try {
		const files = await labFiles(base, lab);
		const results = activateResultsWorker(base);
		if (!client || clientLab !== lab) {
			client?.dispose();
			progress('Loading Python…');
			client = new RunnerClient({
				createWorker: () => new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module', name: 'rfe-runner' }),
				runtime: new URL(`${base}/${runtimeFolder({ pyodide })}`, location.href).href,
				folder: `rfe-${lab}`,
				files,
				onStatus: (status, step) => step !== 'ready' && sink?.progress(status),
				onOutput: (chunk) => sink?.output(chunk),
			});
			clientLab = lab;
		}
		await client.reset(files);
		client.write(EXAMPLE_FILE, code);
		const done = await client.exec(COMMAND, 80);
		await results;
		await storeResults(base, 'example', done.results);
		const links = element('div', 'rfe-run__bar rfe-run__links');
		const passed = done.rc === 0;
		links.append(element('span', `rfe-run__status rfe-run__status--${passed ? 'pass' : 'fail'}`, passed ? 'Passed' : `Failed (exit ${done.rc})`));
		links.append(element('span', '', `exit ${done.rc} · ${duration(performance.now() - t0)}`));
		for (const [label, name] of [['Report', 'report.html'], ['Log', 'log.html']] as const) {
			if (!done.results.some((r: { path: string }) => r.path === `results/${name}`)) continue;
			const a = element('a', '', label) as HTMLAnchorElement;
			a.href = `${resultUrl(base, 'example', `results/${name}`)}?theme=${document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}`;
			a.target = '_blank';
			a.rel = 'noopener';
			links.append(a);
		}
		const more = element('a', '', 'Continue in the browser lab') as HTMLAnchorElement;
		more.href = handoverUrl(base, lab, [{ path: file, text: code }]);
		more.target = '_blank';
		more.rel = 'noopener';
		links.append(more);
		run.append(links);
		(window as unknown as { __rfeInline?: object }).__rfeInline = { rc: done.rc, text, ms: Math.round(performance.now() - t0) };
		return done;
	} catch (error) {
		output.textContent = `The example could not run in your browser: ${(error as Error).message}. Download the lab to run it in VS Code.`;
		throw error;
	}
}
