import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_PATH, ImportError, runImport } from './rfe-import.mjs';

const realRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LESSON_READ = '# Reading lesson\n\nRobot Framework is a generic automation framework. It reads like prose.\n';
const LESSON_BUILD =
	'# Build lesson\n\nInitialize the chapter, then write a suite.\n\n' +
	'## Task 1 — Write it\n\n<!-- hint -->\nUse `Log`.\n<!-- /hint -->\n\n**Check:** it exists.\n\n' +
	'## Task 2 — Run it\n\n```bash\nuv run robot checks\n```\n\n**Check:** it passes.\n';

function write(file, content) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

/** A tiny upstream course: ch00 (no lab) + ch02 (two lessons, the second re-seeds). */
function makeUpstream(root, { readBody = LESSON_READ, buildBody = LESSON_BUILD } = {}) {
	const course = path.join(root, 'courses/rf-tutorial');
	const quiz = [{ question: 'Q?', options: ['a', 'b'], answerIndex: 0, explanation: 'Because a.' }];
	write(path.join(course, 'manifests/rfe-test.json'), JSON.stringify({
		id: 'rfe-test', title: 'Robot Framework Essentials — Part 1: Fundamentals', series: { part: 1, of: 1 },
		browserRequired: false,
		chapters: [
			{ id: 'ch00-orientation', title: 'Orientation', waypoint: { icon: 'compass' }, lessons: [
				{ id: '0001-how-to-use-this-course', title: 'How this course works', taskIcons: ['read'], tasks: ['Take the tour'], seed: null,
					quiz, deck: [{ term: 'Check', kind: 'concept', note: 'The extension button.' }] },
			] },
			{ id: 'ch02-first-suite', title: 'Your first suite', waypoint: { icon: 'terminal' }, lessons: [
				{ id: '0001-suite-files', title: 'Suite files', taskIcons: ['edit', 'run'], tasks: ['Write it', 'Run it'], seed: null, quiz, deck: [] },
				{ id: '0002-syntax-rules', title: 'Syntax rules', taskIcons: ['edit', 'run'], tasks: ['Write it', 'Run it'], seed: 'p1-broken-syntax', quiz, deck: [{ term: 'library', kind: 'concept', note: 'Adds keywords.' }] },
			] },
		],
	}));
	write(path.join(course, 'ch00-orientation/0001-how-to-use-this-course/content.en.md'), readBody);
	write(path.join(course, 'ch02-first-suite/0001-suite-files/content.en.md'), buildBody);
	write(path.join(course, 'ch02-first-suite/0002-syntax-rules/content.en.md'), buildBody);
	for (const [id, validation] of [['p1-first-suite', 'sync-only'], ['p1-broken-syntax', 'red']]) {
		const files = ['pyproject.toml', 'checks/first_suite.robot'];
		write(path.join(course, `stages/${id}/stage.json`), JSON.stringify({ id, files, validation, requires: [] }));
		write(path.join(course, `stages/${id}/files/pyproject.toml`), '[project]\nname = "x"\nrequires-python = ">=3.13"\n');
		write(path.join(course, `stages/${id}/files/checks/first_suite.robot`), `*** Test Cases ***\n${id}\n    Log    hi\n`);
		write(path.join(course, `stages/${id}/files/__pycache__/junk.pyc`), 'not declared');
	}
	write(path.join(root, 'fieldcraft.config.mjs'), "export default { brand: { version: '9.9.9' } };\n");
}

/** A file outside the generated directories; the importer must leave it alone. */
const HAND_WRITTEN = '# Notes\n\nHand-written.\n';

/** A scratch repository with the real templates and the given overrides/rewrites. */
function makeRepo(root, { overrides = {}, rewrites } = {}) {
	cpSync(path.join(realRepo, 'src/rfe/templates'), path.join(root, 'src/rfe/templates'), { recursive: true });
	for (const [rel, content] of Object.entries(overrides)) write(path.join(root, 'src/rfe/overrides', rel), content);
	if (rewrites) write(path.join(root, 'src/rfe/rewrites.json'), JSON.stringify(rewrites));
	write(path.join(root, 'README.md'), HAND_WRITTEN);
}

function scratch(t) {
	const dir = mkdtempSync(path.join(tmpdir(), 'rfe-import-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const upstream = path.join(dir, 'upstream');
	const repo = path.join(dir, 'repo');
	return { upstream, repo };
}

const quiet = () => {};
const page = (repo, rel) => readFileSync(path.join(repo, 'src/content/docs', rel), 'utf8');

function expectProblem(fn, pattern) {
	assert.throws(fn, (e) => e instanceof ImportError && e.problems.some((p) => pattern.test(p)));
}

test('wrong path fails without touching the repository', (t) => {
	const { repo } = scratch(t);
	makeRepo(repo);
	expectProblem(() => runImport({ upstream: '/nonexistent', repo, log: quiet }), /expected .*courses\/rf-tutorial\/manifests\//);
	assert.equal(existsSync(path.join(repo, 'src/content/docs')), false);
});

test('imports pages, labs and course data', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream);
	makeRepo(repo, { rewrites: [{ scope: '*', find: 'Initialize the chapter', replace: "Download this chapter's lab" }] });
	const summary = runImport({ upstream, repo, log: quiet });
	assert.equal(summary.lessons, 3);
	assert.equal(summary.quiz, 3);
	assert.deepEqual(summary.rewrites.map((r) => r.hits), [2]);

	const lesson = page(repo, 'ch02-first-suite/suite-files.md');
	assert.match(lesson, /^---\n# GENERATED by scripts\/rfe-import\.mjs from rf-training-platform 9\.9\.9/);
	assert.match(lesson, /title: "Suite files"/);
	assert.match(lesson, /lab: "ch02-first-suite"\n/);
	assert.doesNotMatch(lesson, /Initialize the chapter|^# Build lesson/m);
	assert.match(lesson, /Download this chapter's lab/);
	assert.match(page(repo, 'ch02-first-suite/syntax-rules.md'), /lab: "ch02-first-suite--syntax-rules"/);

	const course = JSON.parse(readFileSync(path.join(repo, 'src/rfe/generated/course.json'), 'utf8'));
	assert.deepEqual(Object.keys(course.labs), ['ch02-first-suite', 'ch02-first-suite--syntax-rules']);
	assert.equal(course.labs['ch02-first-suite'].stage, 'p1-first-suite');
	assert.equal(course.parts[0].chapters[0].lab, null, 'ch00 has no lab');
	assert.equal(course.python, '3.13');
	assert.equal(course.basePath, BASE_PATH);
	assert.equal(course.parts[0].chapters[1].lessons[0].href, `${BASE_PATH}/ch02-first-suite/suite-files/`);
	assert.equal(course.parts[0].href, `${BASE_PATH}/part-1-fundamentals/`);
	assert.match(page(repo, 'index.md'), /head:\n {2}- tag: "title"\n {4}content: "Robot Framework Essentials"\n/);
	assert.match(page(repo, 'index.md'), new RegExp(`\\]\\(${BASE_PATH}/ch00-orientation/how-to-use-this-course/\\)`));

	const labs = path.join(repo, 'labs');
	assert.ok(existsSync(path.join(labs, 'GENERATED.md')));
	assert.equal(existsSync(path.join(labs, 'p1-first-suite/__pycache__')), false, 'undeclared files are not copied');
	assert.equal(
		readFileSync(path.join(labs, 'p1-broken-syntax/checks/first_suite.robot'), 'utf8'),
		readFileSync(path.join(upstream, 'courses/rf-tutorial/stages/p1-broken-syntax/files/checks/first_suite.robot'), 'utf8'),
	);
	assert.equal(readFileSync(path.join(repo, 'README.md'), 'utf8'), HAND_WRITTEN);
});

test('re-running is byte-identical, and removed lessons disappear', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream);
	makeRepo(repo);
	runImport({ upstream, repo, log: quiet });
	const first = page(repo, 'ch02-first-suite/suite-files.md') + readFileSync(path.join(repo, 'src/rfe/generated/course.json'), 'utf8');
	const again = runImport({ upstream, repo, log: quiet });
	assert.deepEqual(again.changes, { added: 0, changed: 0, removed: 0 });
	assert.equal(page(repo, 'ch02-first-suite/suite-files.md') + readFileSync(path.join(repo, 'src/rfe/generated/course.json'), 'utf8'), first);

	const manifest = path.join(upstream, 'courses/rf-tutorial/manifests/rfe-test.json');
	const m = JSON.parse(readFileSync(manifest, 'utf8'));
	m.chapters[1].lessons.pop();
	writeFileSync(manifest, JSON.stringify(m));
	runImport({ upstream, repo, log: quiet });
	assert.equal(existsSync(path.join(repo, 'src/content/docs/ch02-first-suite/syntax-rules.md')), false);
});

test('body and data overrides: data fields replace, omitted fields stay upstream', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream);
	makeRepo(repo, {
		overrides: {
			'ch00-orientation/0001-how-to-use-this-course.md': '# Web tour\n\nThis is the web edition. Read on.\n',
			'ch00-orientation/0001-how-to-use-this-course.json': JSON.stringify({
				quiz: [{ question: 'Where is progress kept?', options: ['In this browser', 'On a server'], answerIndex: 0, explanation: 'Locally.' }],
				deck: [{ term: 'Done when', kind: 'concept', note: 'What you verify locally.' }],
			}),
		},
	});
	runImport({ upstream, repo, log: quiet });
	const lesson = page(repo, 'ch00-orientation/how-to-use-this-course.md');
	assert.match(lesson, /title: "How this course works"/, 'title stays upstream');
	assert.match(lesson, /question: "Where is progress kept\?"/);
	assert.match(lesson, /term: "Done when"/);
	assert.doesNotMatch(lesson, /The extension button/);
	assert.match(lesson, /This is the web edition\./);
});

test('{{base}} in an override becomes the site prefix; Robot ${{...}} stays code', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream);
	makeRepo(repo, {
		overrides: {
			'ch00-orientation/0001-how-to-use-this-course.md':
				'# Web tour\n\nSee the [glossary]({{base}}/glossary/).\n\n```robotframework\n${sum}    Set Variable    ${{1 + 2}}    ${{x}}\n```\n',
		},
	});
	runImport({ upstream, repo, log: quiet });
	const lesson = page(repo, 'ch00-orientation/how-to-use-this-course.md');
	assert.match(lesson, new RegExp(`\\[glossary\\]\\(${BASE_PATH}/glossary/\\)`));
	assert.match(lesson, /\$\{\{1 \+ 2\}\}    \$\{\{x\}\}/);
});

test('an unknown placeholder in an override fails', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream);
	makeRepo(repo, { overrides: { 'ch00-orientation/0001-how-to-use-this-course.md': '# Tour\n\nGo to {{site}}.\n' } });
	expectProblem(() => runImport({ upstream, repo, log: quiet }), /0001-how-to-use-this-course\.md: unknown placeholder \{\{site\}\}/);
});

test('stale override, unknown data field and task mismatch fail', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream);
	makeRepo(repo, {
		overrides: {
			'ch00-orientation/0009-removed-lesson.md': 'Gone.\n',
			'ch00-orientation/0001-how-to-use-this-course.json': JSON.stringify({ subtitle: 'x', tasks: [{ title: 'a' }, { title: 'b' }] }),
		},
	});
	const run = () => runImport({ upstream, repo, log: quiet });
	expectProblem(run, /stale override .*0009-removed-lesson\.md/);
	expectProblem(run, /0001-how-to-use-this-course\.json: unknown field "subtitle"/);
	expectProblem(run, /0001-how-to-use-this-course: 0 "## Task N" headings but 2 tasks/);
});

test('a rewrite rule that matches nothing fails, naming the rule', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream);
	makeRepo(repo, { rewrites: [{ scope: 'ch02-first-suite/0001-suite-files', find: 'this panel', replace: 'this page' }] });
	expectProblem(() => runImport({ upstream, repo, log: quiet }), /rewrite #1 \("this panel"\) matched nothing in scope "ch02-first-suite\/0001-suite-files"/);
});

test('invalid diagram, bad youtube block and unknown marker fail the import', (t) => {
	const { upstream, repo } = scratch(t);
	makeUpstream(upstream, {
		readBody:
			'# R\n\nText.\n\n```diagram\ntree "x"\nnode a {\n```\n\n```youtube\nid: nope\n```\n\n<!-- spoiler -->\nx\n',
	});
	makeRepo(repo);
	const run = () => runImport({ upstream, repo, log: quiet });
	expectProblem(run, /diagram at line \d+: .*line/);
	expectProblem(run, /youtube block at line \d+: .*11-character/);
	expectProblem(run, /unknown marker <!-- spoiler -->/);
});
