import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	firstSentence, markerProblems, markers, parseTaskParts, parseYoutube, scanFences, stripLeadingH1, taskHeadings,
} from './dialect.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const templates = fixture('templates.md');
const setup = fixture('architecture-and-setup.md');

test('templates lesson: task headings', () => {
	assert.deepEqual(
		taskHeadings(templates).map((t) => [t.n, t.title]),
		[
			[1, 'Collapse the repetitive suite into one template'],
			[2, 'Run the templated tests green'],
		],
	);
});

test('templates lesson: example, three hints and a solution', () => {
	const task1 = templates.split(/^## Task 2/m)[0].split(/^## Task 1.*$/m)[1];
	const parts = parseTaskParts(task1);
	assert.deepEqual(parts.map((p) => p.kind), ['prose', 'example', 'prose', 'ladder']);
	const ladder = parts.find((p) => p.kind === 'ladder');
	assert.equal(ladder.hints.length, 3);
	assert.match(ladder.solution, /Prices, checked with one template\./);
	assert.deepEqual(markerProblems(templates), []);
});

test('setup lesson: runner sections, fences inside list items, and a valid youtube block', () => {
	assert.deepEqual(
		markers(setup).map((m) => m.name),
		['runner:uv', '/runner', 'runner:venv', '/runner', 'runner:poetry', '/runner'],
	);
	assert.deepEqual(markerProblems(setup), []);
	const fences = scanFences(setup);
	assert.ok(fences.some((f) => f.lang === 'bash' && f.body === 'uv init --no-workspace --name rf-essentials'));
	const yt = fences.find((f) => f.lang === 'youtube');
	assert.deepEqual(parseYoutube(yt.body).errors, []);
	assert.equal(parseYoutube(yt.body).values.id, 'QpQwS3ErRC4');
});

test('marker problems: unknown, unclosed, stray close', () => {
	assert.match(markerProblems('<!-- spoiler -->\nx\n')[0], /unknown marker/);
	assert.match(markerProblems('<!-- hint -->\nx\n')[0], /never closed/);
	assert.match(markerProblems('x\n<!-- /hint -->\n')[0], /without a matching opener/);
	assert.deepEqual(markerProblems('```xml\n<!-- not a marker -->\n```\n'), []);
});

test('youtube validation errors', () => {
	const { errors } = parseYoutube('id: short\ntitle: T\ntitle: T2\nsummary:\nfoo: bar');
	assert.ok(errors.some((e) => /appears more than once/.test(e)));
	assert.ok(errors.some((e) => /unknown field "foo"/.test(e)));
	assert.ok(errors.some((e) => /missing field "duration"/.test(e)));
	assert.ok(errors.some((e) => /11-character/.test(e)));
});

test('description helpers', () => {
	assert.ok(!stripLeadingH1(templates).startsWith('# '));
	assert.equal(
		firstSentence(templates),
		'When several tests do the same thing with different data, a template collapses them into one keyword run once per row.',
	);
	assert.equal(
		firstSentence(setup),
		'Robot Framework sits in the middle of a simple stack.',
	);
});
