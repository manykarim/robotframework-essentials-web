import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ansiToHtml } from './ansi.mjs';

// Console output captured from Robot Framework in the browser runtime
// (`robot --consolecolors ansi --consolewidth 72`).
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('a passing run: green PASS, one line per test, links reduced to their text', () => {
	const html = ansiToHtml(fixture('console-pass.txt'));
	assert.doesNotMatch(html, /[\x1b\r]/);
	assert.match(html, /\| <span class="rfe-ansi-green">PASS<\/span> \|/);
	const lines = text(html).split('\n');
	assert.equal(lines.filter((l) => l.startsWith('Greeting Works')).length, 1, 'the progress marker line is rewritten');
	assert.match(lines.find((l) => l.startsWith('Greeting Works')), /^Greeting Works\s+\| PASS \|$/);
	assert.ok(lines.includes('Log:     /work/rfe-ch03-keywords-imports/results/log.html'));
	assert.ok(lines.includes('2 tests, 2 passed, 0 failed'));
});

test('a failing run: red FAIL, yellow SKIP, messages kept', () => {
	const html = ansiToHtml(fixture('console-fail.txt'));
	assert.match(html, /Fails On Purpose\s+\| <span class="rfe-ansi-red">FAIL<\/span> \|\n1 != 2\n/);
	assert.match(html, /Skipped\s+\| <span class="rfe-ansi-yellow">SKIP<\/span> \|\nnot today/);
	assert.match(text(html), /3 tests, 1 passed, 1 failed, 1 skipped/);
	assert.doesNotMatch(text(html), /\s[F.]\s*\n/, 'no leftover progress markers');
});

test('HTML in the output is escaped', () => {
	assert.equal(ansiToHtml('<script>alert(1)</script> & co'), '&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
});

test('bold, dim, bright and reset codes; unknown escapes are dropped', () => {
	assert.equal(ansiToHtml('\x1b[1;31mx\x1b[22my\x1b[0mz'), '<span class="rfe-ansi-red rfe-ansi-bold">x</span><span class="rfe-ansi-red">y</span>z');
	assert.equal(ansiToHtml('\x1b[2m(loading)\x1b[0m'), '<span class="rfe-ansi-dim">(loading)</span>');
	assert.equal(ansiToHtml('\x1b[92mok\x1b[39m!'), '<span class="rfe-ansi-green">ok</span>!');
	assert.equal(ansiToHtml('\x1b[38;5;208morange\x1b[0m'), 'orange');
	assert.equal(ansiToHtml('a\x1b[2Kb\x1b[2J\x1b[Hc'), 'abc');
	assert.equal(ansiToHtml('\x1b[31munclosed'), '<span class="rfe-ansi-red">unclosed</span>');
});

test('carriage returns rewrite the line; a trailing one keeps the text', () => {
	assert.equal(ansiToHtml('progress .\rfinal line\nnext'), 'final line\nnext');
	assert.equal(ansiToHtml('kept\r'), 'kept');
	assert.equal(ansiToHtml('windows\r\nline'), 'windows\nline');
});
