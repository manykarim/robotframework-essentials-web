// Every lesson block with a Run control behaves in the browser runtime as its lesson
// describes: inline blocks in a fresh copy of their lab, lab steps together with the
// Python files from their lesson's solution. Blocks recorded in expected-failures.json
// must fail with their message; every other block must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lessonFences, robotBlocks } from './blocks.mjs';
import { hasPlayground } from './labs.mjs';
import { REPO, course, plain, startRunner } from './testing.mjs';

const expectedFailures = JSON.parse(readFileSync(new URL('./expected-failures.json', import.meta.url), 'utf8'));
const normalizeName = (s) => s.toLowerCase().replace(/[\s_]/g, '');

/** `checks/../libraries/x.py` -> `libraries/x.py` */
function resolve(fromChecks) {
	const out = [];
	for (const part of `checks/${fromChecks}`.split('/')) {
		if (part === '..') out.pop();
		else if (part && part !== '.') out.push(part);
	}
	return out.join('/');
}

/**
 * The lesson's Python files for a lab step's missing imports: the solution's (or the
 * lesson text's) Python block that its lead names, whose class matches the file, or that
 * defines what the suite uses.
 */
function labStepFiles(fences, block) {
	const pythons = fences.filter((f) => f.lang === 'python' && f.region !== 'example' && f.region !== 'hint');
	const ordered = [...pythons.filter((f) => f.region === 'solution'), ...pythons.filter((f) => f.region === 'text')];
	const used = new Set([...block.code.matchAll(/^ {4}(?:[$@&]\{[^}]+\}=?\s+)*([A-Za-z][\w ]*?)(?= {2,}|$)/gm)].map((m) => normalizeName(m[1])));
	const files = {};
	for (const raw of block.missing) {
		const target = resolve(raw);
		const base = path.basename(target, '.py');
		const defines = (f) =>
			[...f.code.matchAll(/^\s*def\s+([a-z]\w*)|^([A-Z][A-Z0-9_]*)\s*=/gm)].some((m) => (m[1] && used.has(normalizeName(m[1]))) || (m[2] && block.code.includes(`{${m[2]}}`)));
		const match =
			ordered.find((f) => f.lead.some((c) => c === target || c.endsWith(`/${base}.py`))) ??
			ordered.find((f) => new RegExp(`^class\\s+${base}\\b`, 'm').test(f.code)) ??
			ordered.find(defines) ??
			ordered.find((f) => /def get_variables|@keyword\(/.test(f.code)) ??
			(ordered.length === 1 ? ordered[0] : undefined);
		if (match) files[target] = match.code;
	}
	return files;
}

const cases = [];
for (const part of course.parts) for (const chapter of part.chapters) for (const lesson of chapter.lessons) {
	const lab = lesson.lab ? course.labs[lesson.lab] : null;
	if (!hasPlayground(lab)) continue;
	const md = readFileSync(path.join(REPO, 'src/content/docs', chapter.id, `${lesson.slug}.md`), 'utf8');
	const fences = lessonFences(md);
	for (const block of robotBlocks(md, { labFiles: lab.files, lessonSlug: lesson.slug })) {
		if (block.run === 'none') continue;
		const name = `${chapter.id}/${lesson.slug}`;
		const expected = expectedFailures.find((e) => e.lesson === name && e.block === block.index + 1);
		cases.push({ name, number: block.index + 1, lab: lesson.lab, block, expected, extra: block.run === 'lab' ? labStepFiles(fences, block) : {} });
	}
}

const runner = await startRunner();

test('the expected-failures list names existing blocks', () => {
	for (const e of expectedFailures) assert.ok(cases.some((c) => c.name === e.lesson && c.number === e.block), `${e.lesson} block ${e.block}`);
});

test('every lab step finds its lesson’s Python files', () => {
	for (const c of cases.filter((c) => c.block.run === 'lab')) {
		assert.deepEqual(Object.keys(c.extra).sort(), c.block.missing.map(resolve).sort(), `${c.name} block ${c.number}`);
	}
});

for (const c of cases) {
	test(`${c.name} block ${c.number} (${c.block.run}, ${c.block.region}) ${c.expected ? 'fails as the lesson shows' : 'passes'}`, async () => {
		const file = c.block.run === 'inline' ? 'checks/_example.robot' : c.block.file;
		const extra = Object.entries(c.extra).map(([p, text]) => ({ path: p, data: text }));
		await runner.init(c.lab, [...extra, { path: file, data: c.block.code }]);
		const run = await runner.exec(`robot --outputdir results --consolecolors off ${file}`);
		const output = plain(run.text);
		if (c.expected) {
			assert.notEqual(run.rc, 0, `${c.name} block ${c.number} should fail:\n${output}`);
			assert.ok(output.includes(c.expected.message), `${c.name} block ${c.number} should fail with "${c.expected.message}":\n${output}`);
		} else {
			assert.equal(run.rc, 0, `${c.name} block ${c.number} should pass:\n${output}`);
		}
	});
}
