// Runner worker of the browser lab: Robot Framework, the shell and the substitutes in
// Pyodide (see runner-core.mjs for the messages). The page starts it on demand; the first
// `init` message names the staged runtime's URL.
import lock from './runtime.lock.json';
import { createRunner } from './runner-core.mjs';
import browser from './python/Browser.py?raw';
import demoShop from './python/rfe_demo_shop.py?raw';
import processModule from './python/rfe_process.py?raw';
import shell from './python/rfe_shell.py?raw';
import timeouts from './python/rfe_timeouts.py?raw';
import workspace from './python/rfe_workspace.py?raw';

const sources = {
	'Browser.py': browser,
	'rfe_demo_shop.py': demoShop,
	'rfe_process.py': processModule,
	'rfe_shell.py': shell,
	'rfe_timeouts.py': timeouts,
	'rfe_workspace.py': workspace,
};

const post = (message: unknown, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

async function start(runtime: string) {
	const { loadPyodide } = await import(/* @vite-ignore */ `${runtime}pyodide.mjs`);
	return createRunner({
		loadPyodide,
		indexURL: runtime,
		lock,
		readBytes: async (file: string) => {
			const response = await fetch(runtime + file);
			if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
			return new Uint8Array(await response.arrayBuffer());
		},
		sources,
		post,
	});
}

let runner: ReturnType<typeof start> | undefined;
self.onmessage = (event: MessageEvent) => {
	const message = event.data;
	runner ??= start(message.runtime);
	// Messages keep their order: each waits for the same start-up, then the runner's queue.
	runner.then(
		(r) => r.onMessage(message),
		(error) => post({ type: 'error', id: message.id, message: `the runtime could not start: ${error?.message ?? error}` }),
	);
};
