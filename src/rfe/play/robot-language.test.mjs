import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { StringStream } from '@codemirror/language';
import { ROBOT_FENCES, lessonFences } from './blocks.mjs';
import { robotStreamParser } from './robot-language.mjs';
import { REPO, course } from './testing.mjs';

/** Tokens of a source as [line, text, style] (styles from the parser; null for separators). */
function tokenize(source) {
	const state = robotStreamParser.startState();
	const out = [];
	source.split('\n').forEach((line, n) => {
		const stream = new StringStream(line, 4, 4);
		while (!stream.eol()) {
			const start = stream.pos;
			const style = robotStreamParser.token(stream, state);
			if (stream.pos === start) throw new Error(`line ${n + 1} did not advance at ${start}: ${JSON.stringify(line)}`);
			out.push([n + 1, line.slice(start, stream.pos), style]);
		}
	});
	return out;
}
const styleOf = (tokens, text) => tokens.find(([, t]) => t.trim() === text)?.[2];

test('every Robot Framework block of the lessons and every lab suite tokenizes', () => {
	const sources = [];
	for (const part of course.parts) for (const chapter of part.chapters) for (const lesson of chapter.lessons) {
		const md = readFileSync(path.join(REPO, 'src/content/docs', chapter.id, `${lesson.slug}.md`), 'utf8');
		for (const b of lessonFences(md)) if (ROBOT_FENCES.has(b.lang)) sources.push([`${chapter.id}/${lesson.slug}:${b.line}`, b.code]);
	}
	for (const lab of Object.values(course.labs)) {
		for (const f of lab.files.filter((f) => /\.(robot|resource)$/.test(f))) sources.push([`${lab.stage}/${f}`, readFileSync(path.join(REPO, 'labs', lab.stage, f), 'utf8')]);
	}
	assert.ok(sources.length > 100, `${sources.length} sources`);
	const seen = new Set();
	for (const [name, source] of sources) {
		const tokens = tokenize(source);
		for (const [, , style] of tokens) seen.add(style);
		for (const [line, text, style] of tokens) {
			if (/^\*{3}/.test(text)) assert.equal(style, 'heading', `${name}:${line}`);
		}
	}
	for (const style of ['heading', 'definition', 'function', 'keyword', 'meta', 'string', 'variableName.special', 'variableName.definition', 'comment']) {
		assert.ok(seen.has(style), `${style} is used`);
	}
});

test('cells are classified by section and position', () => {
	const tokens = tokenize([
		'*** Settings ***',
		'Library        Collections',
		'Suite Setup    Log    starting',
		'',
		'*** Variables ***',
		'${GREETING}    Hello',
		'',
		'*** Test Cases ***',
		'Greeting Works',
		'    [Tags]    smoke',
		'    # a comment',
		'    ${name}=    Set Variable    world',
		'    Greet    ${name}',
		'    FOR    ${i}    IN RANGE    3',
		'        Log    ${i}',
		'    END',
		'    Should Be Equal    a',
		'    ...    a',
		'',
		'*** Keywords ***',
		'Greet',
		'    [Arguments]    ${who}',
		'    Log To Console    ${GREETING}, ${who}!',
	].join('\n'));
	const expected = {
		'*** Settings ***': 'heading',
		Library: 'keyword',
		Collections: 'string',
		'Suite Setup': 'keyword',
		Log: 'function',
		starting: 'string',
		'${GREETING}': 'variableName.definition',
		Hello: 'string',
		'Greeting Works': 'definition',
		'[Tags]': 'meta',
		smoke: 'string',
		'# a comment': 'comment',
		'${name}=': 'variableName.special',
		'Set Variable': 'function',
		Greet: 'function',
		FOR: 'keyword',
		'IN RANGE': 'keyword',
		END: 'keyword',
		'Should Be Equal': 'function',
		'...': 'operator',
		'[Arguments]': 'meta',
		'Log To Console': 'function',
	};
	for (const [text, style] of Object.entries(expected)) assert.equal(styleOf(tokens, text), style, text);
	assert.equal(tokens.filter(([line, t]) => line === 21 && t === 'Greet')[0][2], 'definition', 'keyword names in *** Keywords ***');
});
