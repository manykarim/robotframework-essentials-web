// In-browser substitutes under Node: the demo shop, the Process library, timeouts, plus
// Robocop and a sqlite3 listener, in the labs and lessons that use them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonFencesOf, plain, startRunner } from './testing.mjs';

const r = await startRunner();
const robot = (chapterId, slug, region) => lessonFencesOf(chapterId, slug).find((b) => b.lang === 'robotframework' && b.region === region).code;

test('the ch11 lab suites pass against the in-browser demo shop', async () => {
	await r.init('ch11-api-foundations');
	const run = await r.exec('uv run robot --outputdir results checks');
	assert.equal(run.rc, 0, plain(run.text));
	assert.match(plain(run.text), /Api Is Healthy\s+\| PASS \|/);
	assert.equal((await r.exec('uv run python demo_app/serve.py')).rc, 0, 'starting the demo shop is not needed');
});

test('the ch12 web-and-API example and solution pass (API on 7273, web shop on 7272)', async () => {
	await r.init('ch12-api-in-practice');
	for (const region of ['example', 'solution']) {
		await r.write('checks/_example.robot', robot('ch12-api-in-practice', 'api-and-web-combined', region));
		const run = await r.exec('robot --outputdir results checks/_example.robot');
		assert.equal(run.rc, 0, `${region}: ${plain(run.text)}`);
	}
});

test('demo data behaves as on a real machine, including POST /api/reset and cookies', async () => {
	await r.write('checks/state.robot', [
		'*** Settings ***',
		'Library     RequestsLibrary',
		'Resource    ../resources/api.resource',
		'',
		'*** Test Cases ***',
		'Reset Restores The Seed',
		'    POST    ${API_URL}/api/reset',
		'    ${before}=    GET    ${API_URL}/api/orders',
		'    ${body}=    Create Dictionary    product=travel-mug    quantity=1',
		'    POST    ${API_URL}/api/orders    json=${body}    expected_status=201',
		'    ${grown}=    GET    ${API_URL}/api/orders',
		'    Should Not Be Equal    ${grown.text}    ${before.text}',
		'    POST    ${API_URL}/api/reset',
		'    ${after}=    GET    ${API_URL}/api/orders',
		'    Should Be Equal    ${after.text}    ${before.text}',
		'',
		'Https Works Too',
		'    ${resp}=    GET    https://localhost:7273/api/health',
		'    Status Should Be    200    ${resp}',
		'',
	].join('\n'));
	const run = await r.exec('robot --outputdir results checks/state.robot');
	assert.equal(run.rc, 0, plain(run.text));
});

test('requests to other hosts fail with the browser-lab message', async () => {
	const suite = '*** Settings ***\nLibrary    RequestsLibrary\n\n*** Test Cases ***\nOutside\n    GET    https://example.com/\n';
	for (const lab of ['ch12-api-in-practice', 'ch03-keywords-imports']) {
		await r.init(lab);
		await r.write('checks/outside.robot', suite);
		const t0 = Date.now();
		const run = await r.exec('robot --outputdir results checks/outside.robot');
		assert.equal(run.rc, 1, lab);
		assert.match(plain(run.text), /example\.com is not reachable from the browser lab: only the demo shop on ports 7272 and 7273 is/, lab);
		assert.ok(Date.now() - t0 < 3000, 'no retries against a refused host');
	}
});

test('the Process library runs Python commands in the ch14 lab', async () => {
	await r.init('ch14-processes');
	await r.write('checks/process.robot', [
		'*** Settings ***',
		'Library    Process',
		'Library    OperatingSystem',
		'',
		'*** Test Cases ***',
		'Python Version',
		'    ${r}=    Run Process    python3    --version',
		'    Should Be Equal As Integers    ${r.rc}    0',
		'    Should Start With    ${r.stdout}    Python 3',
		'Inventory Lists Products',
		'    ${r}=    Run Process    python3    tools/inventory.py    list',
		'    Should Be Equal As Integers    ${r.rc}    0',
		'    Should Not Be Empty    ${r.stdout}',
		'Stock Check Fails With Exit Code 1',
		'    ${r}=    Run Process    python3    tools/inventory.py    check    --min-stock    100',
		'    Should Be Equal As Integers    ${r.rc}    1',
		'    Should Contain    ${r.stderr}    low stock',
		'Deliberate Failure',
		'    ${r}=    Run Process    python3    tools/inventory.py    fail',
		'    Should Be Equal As Integers    ${r.rc}    1',
		'    Should Be Equal    ${r.stderr}    inventory: deliberate failure',
		'Stdout To A File',
		'    ${r}=    Run Process    python3    tools/inventory.py    list    stdout=${OUTPUT_DIR}/inventory.txt',
		'    File Should Exist    ${OUTPUT_DIR}/inventory.txt',
		'    ${text}=    Get File    ${OUTPUT_DIR}/inventory.txt',
		'    Should Be Equal    ${text.rstrip()}    ${r.stdout}',
		'Cwd And Code',
		'    ${r}=    Run Process    python    -c    import os; print(os.getcwd())    cwd=tools',
		'    Should End With    ${r.stdout}    /tools',
		'Start Process Returns A Finished Process',
		'    ${handle}=    Start Process    python3    tools/inventory.py    list',
		'    ${r}=    Wait For Process    ${handle}',
		'    Should Be Equal As Integers    ${r.rc}    0',
		'Unsupported Command Explains Itself',
		'    ${r}=    Run Process    git    status',
		'    Should Be Equal As Integers    ${r.rc}    127',
		'    Should Contain    ${r.stderr}    only Python commands',
		'',
	].join('\n'));
	const run = await r.exec('robot --outputdir results checks/process.robot');
	assert.equal(run.rc, 0, plain(run.text));
	assert.match(plain(run.text), /8 tests, 8 passed, 0 failed/);
});

test('the ch23 timeouts solution fails with the timeout message in under a second', async () => {
	await r.init('ch23-running-with-confidence');
	await r.write('checks/guarded.robot', robot('ch23-running-with-confidence', 'timeouts', 'solution'));
	const run = await r.exec('uv run robot --outputdir results checks/guarded.robot');
	assert.equal(run.rc, 1);
	assert.match(plain(run.text), /Test timeout 300 milliseconds exceeded\./);
	assert.ok(run.ms < 1000, `${run.ms} ms`);
});

test('a keyword timeout fails only its test, and passing tests under a timeout pass', async () => {
	await r.write('checks/timeouts.robot', [
		'*** Test Cases ***',
		'Slow Keyword',
		'    Slow Step',
		'Quick Under A Timeout',
		'    [Timeout]    2s',
		'    Sleep    0.05s',
		'    ${n}=    Evaluate    sum(range(1000))',
		'    Should Be Equal As Integers    ${n}    499500',
		'',
		'*** Keywords ***',
		'Slow Step',
		'    [Timeout]    0.2s',
		'    Sleep    2s',
		'',
	].join('\n'));
	const run = await r.exec('robot --outputdir results checks/timeouts.robot');
	assert.equal(run.rc, 1);
	assert.match(plain(run.text), /Slow Keyword\s+\| FAIL \|\s*Keyword timeout 200 milliseconds exceeded\./);
	assert.match(plain(run.text), /Quick Under A Timeout\s+\| PASS \|/);
	assert.ok(run.ms < 1500, `${run.ms} ms`);
});

test('robocop format --diff --no-overwrite shows the diff and leaves the file, robocop check lints (ch25)', async () => {
	await r.init('ch25-team-tooling');
	const before = await r.read('checks/unformatted.robot');
	const format = await r.exec('uv run robocop format --diff --no-overwrite checks/unformatted.robot');
	assert.match(plain(format.text), /loading Robocop/);
	assert.match(plain(format.text), /^[-+]/m, plain(format.text));
	assert.equal(await r.read('checks/unformatted.robot'), before);
	assert.deepEqual(format.changed, []);
	const check = await r.exec('robocop check checks');
	assert.match(plain(check.text), /Found \d+ issues?|\b[A-Z]{3,4}\d{2,}\b/, plain(check.text));
	const overwrite = await r.exec('robocop format checks/unformatted.robot');
	assert.deepEqual(overwrite.changed.map((f) => f.path), ['checks/unformatted.robot'], plain(overwrite.text));
});

test('a listener writes rows to results/ with sqlite3 (ch20)', async () => {
	await r.init('ch20-listening-to-execution');
	const listener = lessonFencesOf('ch20-listening-to-execution', 'listener-sqlite').find((b) => b.lang === 'python' && b.region === 'solution').code;
	await r.write('ext/SqliteResults.py', listener);
	const run = await r.exec('uv run robot --listener ext/SqliteResults.py --outputdir results checks/orders.robot');
	assert.equal(run.rc, 0, plain(run.text));
	const rows = await r.exec(`python -c "import sqlite3; print(sqlite3.connect('results/results.db').execute('select count(*) from results').fetchone()[0])"`);
	assert.ok(Number(plain(rows.text).trim()) > 0, plain(rows.text));
	assert.ok(run.files.includes('results/results.db'));
});
