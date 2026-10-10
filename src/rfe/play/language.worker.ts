// Language worker of the browser lab: RobotCode behind the bridge (see language-core.mjs for
// the messages). The playground starts it next to the runner, or when the editor first gets
// focus on small devices; it receives the same file writes as the runner.
import lock from './runtime.lock.json';
import { createLanguageServer } from './language-core.mjs';
import browser from './python/Browser.py?raw';
import bridge from './python/rfe_bridge.py?raw';
import workspace from './python/rfe_workspace.py?raw';

const sources = { 'Browser.py': browser, 'rfe_bridge.py': bridge, 'rfe_workspace.py': workspace };
const post = (message: unknown) => self.postMessage(message);

async function start(runtime: string) {
	const { loadPyodide } = await import(/* @vite-ignore */ `${runtime}pyodide.mjs`);
	return createLanguageServer({
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

let server: ReturnType<typeof start> | undefined;
self.onmessage = (event: MessageEvent) => {
	const message = event.data;
	server ??= start(message.runtime);
	server.then(
		(s) => s.onMessage(message),
		(error) => post({ type: 'unavailable', message: `Language features are unavailable: ${error?.message ?? error}` }),
	);
};
