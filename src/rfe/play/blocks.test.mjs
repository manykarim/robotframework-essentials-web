import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyBlock, lessonFences, missingImports, robotBlocks } from './blocks.mjs';
import { hasPlayground } from './labs.mjs';
import { REPO, course } from './testing.mjs';

const labFiles = ['checks/imports.robot', 'resources/common.resource', 'libraries/shop.py', 'README.md'];
const classify = (code, lead = []) => classifyBlock({ code, labFiles, lead, lessonSlug: 'my-lesson' });

const T = '\n*** Test Cases ***\nT\n    No Operation\n';

test('a block importing the Browser library gets no control', () => {
	assert.deepEqual(classify(`*** Settings ***\nLibrary    Browser    timeout=10s\n${T}`), { run: 'none' });
	assert.equal(classify(`*** Settings ***\nLibrary    BrowserTools\n${T}`).run, 'inline');
});

test('a block without tests or tasks gets no control', () => {
	assert.deepEqual(classify('Given A Positive Number\n    Given Number 7 Is Positive\n'), { run: 'none' });
	assert.deepEqual(classify('*** Settings ***\nSuite Setup    Log    hi\n'), { run: 'none' });
	assert.equal(classify('*** Tasks ***\nT\n    No Operation\n').run, 'inline');
});

test('a block importing only shipped files or libraries by name runs inline', () => {
	assert.deepEqual(classify(`*** Settings ***\nResource    ../resources/common.resource\nLibrary    Collections\n${T}`), {
		run: 'inline',
		file: 'checks/my-lesson.robot',
	});
	assert.equal(classify(`*** Settings ***\nLibrary    \${CURDIR}/../libraries/shop.py\n${T}`).run, 'inline');
	assert.equal(classify(`*** Settings ***\nVariables    \${ENV_FILE}\n${T}`).run, 'inline', 'paths built from variables are left alone');
	assert.equal(classify(`*** Settings ***\nLibrary    my_module\n${T}`).run, 'inline', 'imports by module name');
});

test('a block importing a file the lab does not ship is a lab step, named by its lesson text', () => {
	const step = classify(`*** Settings ***\nLibrary    ../libraries/CartMath.py\n${T}`, ['libraries/CartMath.py', 'checks/cart.robot']);
	assert.deepEqual(step, { run: 'lab', file: 'checks/cart.robot', missing: ['../libraries/CartMath.py'] });
	assert.equal(classify(`*** Settings ***\nResource    ../resources/new.resource\n${T}`).file, 'checks/my-lesson.robot');
	assert.deepEqual(missingImports('Library    ../libraries/shop.py\nLibrary    ../libraries/other.py\n', labFiles), ['../libraries/other.py']);
});

test('fences keep their region and the inline code of the paragraph before them', () => {
	const md = [
		'Create `checks/cart.robot`:',
		'',
		'```robotframework',
		'*** Test Cases ***',
		'```',
		'',
		'<!-- example -->',
		'```robotframework',
		'*** Test Cases ***',
		'```',
		'<!-- /example -->',
		'## Task 2 — `checks/x.robot`',
		'',
		'```robotframework',
		'*** Keywords ***',
		'```',
		'- Save it as `checks/list.robot`:',
		'',
		'  ```robotframework',
		'  *** Settings ***',
		'  ```',
	].join('\n');
	assert.deepEqual(lessonFences(md).map((b) => [b.region, b.lead]), [
		['text', ['checks/cart.robot']],
		['example', []],
		['text', []],
		['text', ['checks/list.robot']],
	]);
});

/** Every lesson's Robot blocks, classified. */
function courseBlocks() {
	const out = [];
	for (const part of course.parts) for (const chapter of part.chapters) for (const lesson of chapter.lessons) {
		const md = readFileSync(path.join(REPO, 'src/content/docs', chapter.id, `${lesson.slug}.md`), 'utf8');
		const lab = lesson.lab ? course.labs[lesson.lab] : null;
		for (const b of robotBlocks(md, { labFiles: lab?.files ?? [], lessonSlug: lesson.slug })) {
			out.push({ ...b, lesson: `${chapter.id}/${lesson.slug}`, lab: lesson.lab, playground: hasPlayground(lab) });
		}
	}
	return out;
}

test('the course has the Run controls the exploration counted', () => {
	const blocks = courseBlocks();
	assert.equal(blocks.length, 92);
	assert.ok(blocks.every((b) => b.lab), 'every Robot block is in a lesson with a lab');
	const count = (run) => blocks.filter((b) => b.run === run).length;
	assert.deepEqual([count('none'), count('lab'), count('inline')], [18, 11, 63]);
	assert.equal(blocks.filter((b) => /^\s*Library\s{2,}Browser\b/m.test(b.code)).length, 16, 'Browser blocks');
	assert.deepEqual(
		blocks.filter((b) => b.run === 'none' && !/Library\s{2,}Browser/.test(b.code)).map((b) => `${b.lesson} block ${b.index + 1}`),
		['ch03-keywords-imports/calling-styles block 3', 'ch06-structure-control/initialization-files block 2'],
		'blocks without tests: a fragment and an __init__.robot',
	);
	assert.ok(blocks.filter((b) => !b.playground).every((b) => b.run === 'none'), 'web-lab lessons only have Browser blocks');
	assert.deepEqual(
		blocks.filter((b) => b.run === 'lab').map((b) => `${b.lesson} -> ${b.file}`),
		[
			'ch17-python-basics/functions-as-keywords -> checks/orders.robot',
			'ch17-python-basics/data-and-failures -> checks/rules.robot',
			'ch17-python-basics/type-hints-and-conversion -> checks/pricing.robot',
			'ch18-custom-libraries/module-library -> checks/order_lib.robot',
			'ch18-custom-libraries/class-library-with-state -> checks/cart.robot',
			'ch18-custom-libraries/embedded-args-and-libdoc -> checks/order_state.robot',
			'ch19-libraries-that-scale/pythonlibcore -> checks/shop.robot',
			'ch19-libraries-that-scale/dynamic-api -> checks/echo.robot',
			'ch19b-variable-files/static-variable-file -> checks/shop_config.robot',
			'ch19b-variable-files/dynamic-variable-file -> checks/env_config.robot',
			'ch22-extension-lab/extension-lab -> checks/shipping.robot',
		],
	);
});

test('the built lesson pages carry exactly these controls', { skip: !existsSync(path.join(REPO, 'dist/index.html')) && 'site not built' }, () => {
	for (const [lesson, blocks] of Object.entries(Object.groupBy(courseBlocks(), (b) => b.lesson))) {
		const html = readFileSync(path.join(REPO, 'dist', lesson, 'index.html'), 'utf8');
		const built = [...html.matchAll(/data-rfe-run="(\w+)" data-lab="([^"]*)" data-file="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
		const expected = blocks.filter((b) => b.run !== 'none').map((b) => `${b.run} ${b.lab} ${b.file}`);
		assert.deepEqual(built, expected, lesson);
	}
});
