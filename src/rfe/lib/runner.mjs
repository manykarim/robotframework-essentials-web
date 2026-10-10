// Python runner modes for displayed commands.
// Port of the Fieldcraft framework's webview/src/runner.ts (MIT, see ../vendor/NOTICE.md),
// display form only. Differences from upstream:
// - transforms each line of a multi-line block (upstream matched only single-line blocks);
// - `uv sync` becomes `poetry install --no-root`, which is what the extension executes,
//   because the lab projects are not installable packages.

/** @typedef {'uv' | 'venv' | 'poetry'} RunnerMode */

/** @type {readonly RunnerMode[]} */
export const RUNNERS = ['uv', 'venv', 'poetry'];
export const DEFAULT_RUNNER = 'uv';

/**
 * Transform one authored command line for `runner`, keeping its indentation.
 * @param {string} line
 * @param {RunnerMode} runner
 */
export function transformLine(line, runner) {
	if (runner === 'uv') return line;
	const indent = /^\s*/.exec(line)?.[0] ?? '';
	const cmd = line.trim();

	const run = /^uv\s+run\s+(.+)$/.exec(cmd);
	if (run) return indent + (runner === 'poetry' ? `poetry run ${run[1]}` : run[1]);

	const add = /^uv\s+add\s+(.+)$/.exec(cmd);
	if (add) return indent + (runner === 'poetry' ? `poetry add ${add[1]}` : `pip install ${add[1]}`);

	if (/^uv\s+sync$/.test(cmd)) {
		return indent + (runner === 'poetry' ? 'poetry install --no-root' : 'pip install -r requirements.txt');
	}
	// `uv init ...` and non-uv commands stay as authored; lessons give runner-specific
	// steps for project creation.
	return line;
}

/**
 * Transform every line of a command block.
 * @param {string} text
 * @param {RunnerMode} runner
 */
export function transformCommand(text, runner) {
	return text
		.split('\n')
		.map((line) => transformLine(line, runner))
		.join('\n');
}

/**
 * Whether any runner shows `text` differently from the uv form.
 * @param {string} text
 */
export function isRunnerSensitive(text) {
	return RUNNERS.some((runner) => transformCommand(text, runner) !== text);
}
