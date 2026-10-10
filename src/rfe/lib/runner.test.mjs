import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRunnerSensitive, transformCommand, transformLine } from './runner.mjs';

const table = [
	// [uv form, venv form, poetry form]
	['uv run robot checks', 'robot checks', 'poetry run robot checks'],
	['uv run robot --outputdir results checks', 'robot --outputdir results checks', 'poetry run robot --outputdir results checks'],
	['uv run python demo_app/serve.py', 'python demo_app/serve.py', 'poetry run python demo_app/serve.py'],
	['uv add robotframework', 'pip install robotframework', 'poetry add robotframework'],
	['uv add robotframework-browser robotframework-requests', 'pip install robotframework-browser robotframework-requests', 'poetry add robotframework-browser robotframework-requests'],
	['uv sync', 'pip install -r requirements.txt', 'poetry install --no-root'],
];

for (const [uv, venv, poetry] of table) {
	test(`transforms "${uv}"`, () => {
		assert.equal(transformLine(uv, 'uv'), uv);
		assert.equal(transformLine(uv, 'venv'), venv);
		assert.equal(transformLine(uv, 'poetry'), poetry);
	});
}

test('leaves other commands unchanged', () => {
	for (const cmd of ['uv init --no-workspace --name rf-essentials', 'python -m venv .venv', 'echo $?', 'robot --version', 'uv venv --seed .venv']) {
		assert.equal(transformLine(cmd, 'venv'), cmd);
		assert.equal(transformLine(cmd, 'poetry'), cmd);
	}
	assert.equal(isRunnerSensitive('echo $?'), false);
});

test('transforms each line of a block and keeps indentation', () => {
	const block = 'uv run robot checks/order_state.robot\n  uv run libdoc libraries/order_state.py results/order_state.html';
	assert.equal(
		transformCommand(block, 'venv'),
		'robot checks/order_state.robot\n  libdoc libraries/order_state.py results/order_state.html',
	);
	assert.equal(isRunnerSensitive(block), true);
});
