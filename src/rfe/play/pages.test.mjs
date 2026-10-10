// The built site's browser-lab pages and links (runs after the build in test:ci).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { hasPlayground, playgroundLabs } from './labs.mjs';
import { REPO, course } from './testing.mjs';

const dist = path.join(REPO, 'dist');
const built = existsSync(path.join(dist, 'index.html'));
const skip = !built && 'site not built';

test('one playground page per lab without the Browser library, none for ch08–ch10', { skip }, () => {
	const pages = readdirSync(path.join(dist, 'labs'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
	assert.deepEqual(pages, playgroundLabs(course).sort());
	assert.equal(pages.length, 26);
	for (const id of ['ch08-web-foundations', 'ch09-web-flows', 'ch10-web-robustness']) assert.ok(!pages.includes(id), id);
	for (const id of pages) {
		const html = readFileSync(path.join(dist, 'labs', id, 'index.html'), 'utf8');
		assert.ok(!html.includes('data-pagefind-body'), `${id} is left out of the search index`);
		assert.match(html, new RegExp(`href="/robotframework-essentials-web/labs/${id}\\.zip"`), `${id} links to its zip`);
		assert.match(html, /id="rfe-play"/, id);
	}
});

test('lab cards offer "Open in browser" exactly for labs with a playground', { skip }, () => {
	const seen = new Map();
	for (const part of course.parts) for (const chapter of part.chapters) for (const lesson of chapter.lessons) {
		if (!lesson.lab) continue;
		const html = readFileSync(path.join(dist, chapter.id, lesson.slug, 'index.html'), 'utf8');
		const links = [...html.matchAll(/class="rfe-lab__open" href="([^"]+)" data-rfe-playground/g)].map((m) => m[1]);
		const lab = course.labs[lesson.lab];
		if (hasPlayground(lab)) {
			assert.deepEqual(links, [`/robotframework-essentials-web/labs/${lesson.lab}/`], `${chapter.id}/${lesson.slug}`);
			assert.ok(existsSync(path.join(dist, 'labs', lesson.lab, 'index.html')), lesson.lab);
			const card = html.slice(html.indexOf('data-rfe-lab'));
			assert.ok(card.indexOf('rfe-lab__download') < card.indexOf('rfe-lab__open'), `${lesson.lab}: the download comes first`);
		} else {
			assert.deepEqual(links, [], `${chapter.id}/${lesson.slug} has no browser lab`);
		}
		seen.set(lesson.lab, hasPlayground(lab));
	}
	assert.equal([...seen.values()].filter(Boolean).length, 26);
});

test('the results service worker and the runtime are deployed', { skip }, () => {
	const sw = readFileSync(path.join(dist, 'labs/rfe-results-sw.js'), 'utf8');
	assert.match(sw, /sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox/);
	assert.ok(existsSync(path.join(dist, 'rfe-runtime/314.0.7/pyodide.asm.wasm')));
});
