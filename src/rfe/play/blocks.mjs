// Run controls of lesson code blocks, decided at build time. The Markdown pipeline marks
// each Robot Framework block with the result, and the lesson-block test runs exactly the
// blocks this module marks, so both read the lesson source the same way:
//   - no control for a block that imports the Browser library, or that defines no test or
//     task (a fragment of a suite, or a file such as an `__init__.robot` that suites use);
//   - "lab" (Open in browser lab) for a lab step: it imports a file the lab doesn't ship,
//     which the learner creates in a task;
//   - "inline" (Run in browser) for every other block.
import { scanFences } from '../lib/dialect.mjs';

export const ROBOT_FENCES = new Set(['robotframework', 'robot', 'resource']);
const MARKER = /^<!--\s*(\/?)(example|hint|solution|runner)(?::\w+)?\s*-->\s*$/;
const BROWSER = /^[ \t]*Library(?: {2,}|\t)[ \t]*Browser(?: {2,}|\t|[ \t]*$)/m;
const TESTS = /^\*+[ \t]*(test cases?|tasks?)\b/im;
const IMPORT = /^[ \t]*(Library|Resource|Variables)(?: {2,}|\t)[ \t]*(\S(?:.*?\S)?)(?= {2,}|\t|[ \t]*$)/gm;
const FILE_LIKE = /[/\\]|\.(py|resource|robot|txt|tsv|rst|json|ya?ml)$/i;
const SUITE_FILE = /^(checks|tests|tasks)\/[\w./-]+\.robot$/;

/** `a/b/../c` -> `a/c`; null when the path leaves the lab. */
function normalize(p) {
	const out = [];
	for (const part of p.replace(/\\/g, '/').split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (!out.length) return null;
			out.pop();
		} else out.push(part);
	}
	return out.join('/');
}

/**
 * File imports of a suite that the lab doesn't ship, resolved from `checks/` (where the
 * suite runs) or the lab root. Imports by module name and paths built from variables other
 * than `${CURDIR}` are left alone.
 * @param {string} code
 * @param {string[]} labFiles  lab-relative paths
 */
export function missingImports(code, labFiles) {
	const missing = [];
	for (const [, , raw] of code.matchAll(IMPORT)) {
		const value = raw.replace(/\$\{CURDIR\}/g, 'checks');
		if (!FILE_LIKE.test(value) || value.includes('${') || /^([a-zA-Z]:)?[/\\]/.test(value)) continue;
		const shipped = [normalize(`checks/${value}`), value.startsWith('.') ? null : normalize(value)].some(
			(p) => p !== null && labFiles.some((f) => f === p || (value.endsWith('/') && f.startsWith(`${p}/`))),
		);
		if (!shipped) missing.push(raw);
	}
	return missing;
}

/**
 * The Run control of one Robot Framework block, and the file it goes to in the browser lab:
 * the suite the introducing paragraph names (such as "Create `checks/cart.robot`"), or
 * `checks/<lesson-slug>.robot`.
 * @param {{ code: string, labFiles: string[], lead: string[], lessonSlug: string }} block
 *   lead: inline code of the paragraph that introduces the block
 * @returns {{ run: 'none' | 'inline' | 'lab', file?: string, missing?: string[] }}
 */
export function classifyBlock({ code, labFiles, lead, lessonSlug }) {
	if (BROWSER.test(code) || !TESTS.test(code)) return { run: 'none' };
	const file = lead.find((c) => SUITE_FILE.test(c)) ?? `checks/${lessonSlug}.robot`;
	const missing = missingImports(code, labFiles);
	return missing.length ? { run: 'lab', file, missing } : { run: 'inline', file };
}

/** Inline code spans of a paragraph's text. */
const inlineCode = (text) => [...text.matchAll(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g)].map((m) => m[2].trim());

/**
 * Every fenced block of a lesson, in order, with its region (`text`, `example`, `hint` or
 * `solution`), the region's number, and `lead`: the inline code of the paragraph or list
 * item right before it, when only blank lines separate them.
 * @param {string} markdown
 */
export function lessonFences(markdown) {
	const lines = markdown.split('\n');
	const fences = scanFences(markdown);
	const blocks = [];
	let region = 'text';
	let regionNo = 0;
	/** @type {string[] | null} lines of the paragraph being read */
	let current = null;
	/** @type {string[] | null} inline code of the paragraph that just ended */
	let ended = null;
	let next = 0;
	for (let i = 0; i < lines.length; i++) {
		const fence = fences[next];
		if (fence && i === fence.start - 1) {
			const lead = current ? inlineCode(current.join(' ')) : (ended ?? []);
			blocks.push({ lang: fence.lang, code: fence.body, line: fence.start, region, regionNo, lead });
			i = fence.end - 1;
			next++;
			current = ended = null;
			continue;
		}
		const line = lines[i].trim();
		const marker = MARKER.exec(line);
		if (marker) {
			if (marker[2] !== 'runner') region = marker[1] ? 'text' : marker[2];
			regionNo++;
			current = ended = null;
		} else if (line === '') {
			if (current) ended = inlineCode(current.join(' '));
			current = null;
		} else if (/^(#|>|\|)/.test(line)) {
			current = ended = null;
		} else {
			if (/^([-*+]|\d+[.)])\s/.test(line)) current = null;
			(current ??= []).push(line);
			ended = null;
		}
	}
	return blocks;
}

/**
 * The Robot Framework blocks of a lesson with their Run controls.
 * @param {string} markdown  the lesson's Markdown source
 * @param {{ labFiles: string[], lessonSlug: string }} context
 */
export function robotBlocks(markdown, { labFiles, lessonSlug }) {
	return lessonFences(markdown)
		.filter((b) => ROBOT_FENCES.has(b.lang))
		.map((b, index) => ({ ...b, index, ...classifyBlock({ code: b.code, labFiles, lead: b.lead, lessonSlug }) }));
}
