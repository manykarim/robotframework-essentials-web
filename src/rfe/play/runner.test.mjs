// The runner under Node, started from the staged runtime: start-up, Run, the terminal's
// shell, and reloading of edited workspace files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plain, startRunner } from './testing.mjs';

const r = await startRunner();
const ready = await r.init('ch03-keywords-imports');

test('init reports the start-up steps and the lab files', () => {
	const steps = r.messages.filter((m) => m.type === 'status').map((m) => m.step);
	assert.deepEqual(steps, ['python', 'packages', 'lab', 'ready']);
	assert.equal(ready.root, '/work/rfe-ch03-keywords-imports');
	assert.ok(ready.files.includes('checks/imports.robot') && ready.files.includes('resources/common.resource'), ready.files.join(' '));
});

test('Run streams the console output and returns the exit code and result files', async () => {
	const run = await r.exec('robot --outputdir results checks');
	assert.equal(run.rc, 0, plain(run.text));
	assert.match(run.text, /\x1b\[32mPASS\x1b\[0m/, 'Robot Framework colours in the output');
	assert.match(plain(run.text), /2 tests, 2 passed, 0 failed/);
	assert.deepEqual(run.results.map((f) => f.path), ['results/log.html', 'results/output.xml', 'results/report.html']);
	assert.ok(run.results.every((f) => f.data.length > 1000));
	assert.ok(run.files.includes('results/log.html'));
	assert.deepEqual(run.changed, []);

	const suite = await r.read('checks/imports.robot');
	await r.write('checks/imports.robot', `${suite.trimEnd()}\n    No Such Keyword Here\n`);
	const failing = await r.exec('robot --outputdir results checks');
	assert.equal(failing.rc, 1);
	assert.match(plain(failing.text), /No keyword with name 'No Such Keyword Here' found/);
	assert.deepEqual(failing.results.map((f) => f.path), ['results/log.html', 'results/output.xml', 'results/report.html']);
	await r.write('checks/imports.robot', suite);
});

test('lesson commands work for every runner', async () => {
	for (const line of [
		'uv run robot --dryrun checks',
		'poetry run robot --dryrun checks',
		'python -m robot --dryrun checks',
		'python3 -m robot --dryrun checks',
		'.venv/bin/robot --dryrun checks',
		'.venv\\Scripts\\robot --dryrun checks',
		'robot --dryrun checks',
	]) {
		const run = await r.exec(line);
		assert.equal(run.rc, 0, `${line}: ${plain(run.text)}`);
		assert.match(plain(run.text), /2 tests, 2 passed, 0 failed/, line);
	}
});

test('without --outputdir, results go to the current directory', async () => {
	const run = await r.exec('uv run robot --dryrun checks');
	assert.match(plain(run.text), /Report:\s+\/work\/rfe-ch03-keywords-imports\/report\.html/);
	assert.ok(run.files.includes('report.html'));
	for (const f of ['output.xml', 'log.html', 'report.html']) await r.runner.onMessage({ type: 'delete', path: f });
});

test('rebot and libdoc run', async () => {
	await r.exec('robot --outputdir results checks');
	const rebot = await r.exec('uv run rebot --outputdir results --name Combined results/output.xml');
	assert.equal(rebot.rc, 0, plain(rebot.text));
	assert.match(plain(rebot.text), /Report:\s+.*results\/report\.html/);
	const libdoc = await r.exec('python -m robot.libdoc resources/common.resource results/common.html');
	assert.equal(libdoc.rc, 0, plain(libdoc.text));
	assert.ok(libdoc.files.includes('results/common.html'));
});

test('setup commands exit 0 and say the packages are installed', async () => {
	for (const line of ['uv sync', 'uv add robotframework-requests', 'pip install -r requirements.txt', 'poetry install --no-root', 'python -m venv .venv', 'source .venv/bin/activate']) {
		const run = await r.exec(line);
		assert.equal(run.rc, 0, line);
		assert.match(run.text, /already installed in the browser lab \(robotframework 7\.4\.2/, line);
	}
});

test('tools that need a real machine say so and point to the downloaded lab', async () => {
	for (const [line, reason] of [
		['pabot checks', /pabot runs suites in parallel processes/],
		['uv run pabot --processes 2 checks', /pabot runs suites in parallel processes/],
		['rfbrowser init chromium', /Browser library needs a real browser engine/],
		['git status', /needs a real machine/],
		['python -m http.server', /starting servers needs a real machine/],
	]) {
		const run = await r.exec(line);
		assert.equal(run.rc, 127, line);
		assert.match(run.text, reason, line);
		assert.match(run.text, /Download the lab/, line);
	}
	const unknown = await r.exec('frobnicate');
	assert.equal(unknown.rc, 127);
	assert.match(unknown.text, /frobnicate: command not found\. Type 'help'/);
});

test('a suite importing the Browser library explains the limitation', async () => {
	await r.write('checks/web.robot', '*** Settings ***\nLibrary    Browser\n\n*** Test Cases ***\nOpen\n    New Page    https://example.com\n');
	const run = await r.exec('robot --outputdir results checks/web.robot');
	assert.notEqual(run.rc, 0);
	assert.match(plain(run.text), /Browser library needs a real browser engine and cannot run in the browser lab/);
	await r.runner.onMessage({ type: 'delete', path: 'checks/web.robot' });
});

test('help lists the commands, what needs a real machine and the Python version', async () => {
	const run = await r.exec('help');
	assert.equal(run.rc, 0);
	for (const word of ['robot [options]', 'rebot', 'libdoc', 'robocop', 'python <script.py>', 'ls', 'cat', 'cd', 'pwd', 'clear', 'help', 'pabot', 'Browser library', 'Python 3.14']) {
		assert.ok(run.text.includes(word), word);
	}
});

test('file commands', async () => {
	assert.deepEqual(plain((await r.exec('ls checks')).text).trim().split('\n'), ['imports.robot']);
	assert.match((await r.exec('cat resources/common.resource')).text, /\*\*\* Keywords \*\*\*/);
	assert.equal((await r.exec('cd checks')).rc, 0);
	assert.equal(plain((await r.exec('pwd')).text).trim(), '/work/rfe-ch03-keywords-imports/checks');
	assert.equal((await r.exec('cd /')).rc, 1, 'cannot leave the lab folder');
	assert.equal((await r.exec('cd')).rc, 0);
	assert.match((await r.exec('tree')).text, /checks\/imports\.robot/);
	assert.equal((await r.exec('clear')).text, '\x1b[2J\x1b[3J\x1b[H');
	assert.equal((await r.exec('python --version')).text.trim(), 'Python 3.14.2');
});

test('python scripts run with their arguments and exit codes, and their file changes are reported', async () => {
	await r.write('tools/hello.py', 'import sys, pathlib\nprint("hi", *sys.argv[1:])\npathlib.Path("notes.txt").write_text("written")\nsys.exit(3)\n');
	const run = await r.exec('uv run python tools/hello.py a b');
	assert.equal(run.rc, 3);
	assert.equal(plain(run.text).trim(), 'hi a b');
	assert.deepEqual(run.changed.map((f) => [f.path, new TextDecoder().decode(f.data)]), [['notes.txt', 'written']]);
	await r.runner.onMessage({ type: 'delete', path: 'notes.txt' });
	await r.runner.onMessage({ type: 'delete', path: 'tools' });
});

test('the next run uses edited libraries, variable files and resources', async () => {
	const suite = [
		'*** Settings ***',
		'Library      ../libraries/Lib.py',
		'Library      helper_mod',
		'Variables    ../variables/vars.py',
		'Resource     ../resources/r.resource',
		'',
		'*** Test Cases ***',
		'T',
		'    ${a}=    Path Lib',
		'    ${b}=    Name Lib',
		'    ${c}=    Res Kw',
		'    Should Be Equal    ${a}-${b}-${VALUE}-${c}    ${EXPECTED}',
		'',
	].join('\n');
	const write = async (v) => {
		await r.write('libraries/Lib.py', `def path_lib():\n    return "path${v}"\n`);
		await r.write('libraries/helper_mod.py', `def name_lib():\n    return "name${v}"\n`);
		await r.write('variables/vars.py', `VALUE = "var${v}"\n`);
		await r.write('resources/r.resource', `*** Keywords ***\nRes Kw\n    RETURN    res${v}\n`);
	};
	await r.write('checks/reload.robot', suite);
	await write(1);
	assert.equal((await r.exec('robot --outputdir results --pythonpath libraries --variable EXPECTED:path1-name1-var1-res1 checks/reload.robot')).rc, 0);
	await write(2);
	const second = await r.exec('robot --outputdir results --pythonpath libraries --variable EXPECTED:path2-name2-var2-res2 checks/reload.robot');
	assert.equal(second.rc, 0, plain(second.text));
	for (const p of ['checks/reload.robot', 'libraries', 'variables', 'resources/r.resource']) await r.runner.onMessage({ type: 'delete', path: p });
});

test('paths outside the workspace are refused', async () => {
	const before = r.messages.length;
	await r.runner.onMessage({ type: 'write', id: 99, path: '../escape.txt', data: 'x' });
	assert.deepEqual(r.messages.slice(before).map((m) => [m.type, m.message]), [['error', 'path leaves the workspace: ../escape.txt']]);
});
