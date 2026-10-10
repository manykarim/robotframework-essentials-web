// Text-level helpers for the Robot Framework Essentials lesson dialect: fenced code,
// `## Task N` headings, `<!-- marker -->` comments, and `youtube` block validation.
// Shared by the importer (validation) and the remark plugin (rendering).
// The hint-part and youtube rules are ports of the Fieldcraft framework's
// webview/src/markdown.ts (MIT, see ../vendor/NOTICE.md).

/** Comment markers the dialect defines; any other `<!-- name -->` is unknown. */
export const KNOWN_MARKERS = new Set([
	'example', '/example', 'hint', '/hint', 'solution', '/solution',
	'runner:uv', 'runner:venv', 'runner:poetry', '/runner',
]);

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)?.*$/;

/**
 * Find fenced code blocks. Lines are 1-based.
 * @param {string} markdown
 * @returns {{ lang: string, body: string, start: number, end: number }[]}
 */
export function scanFences(markdown) {
	const lines = markdown.split('\n');
	const fences = [];
	/** @type {{ char: string, len: number, lang: string, start: number, indent: number, body: string[] } | null} */
	let open = null;
	lines.forEach((line, i) => {
		if (!open) {
			const m = FENCE_OPEN.exec(line);
			if (m) open = { char: m[2][0], len: m[2].length, lang: m[3] ?? '', start: i + 1, indent: m[1].length, body: [] };
			return;
		}
		const close = new RegExp(`^\\s*${open.char === '`' ? '`' : '~'}{${open.len},}\\s*$`);
		if (close.test(line)) {
			fences.push({ lang: open.lang, body: open.body.join('\n'), start: open.start, end: i + 1 });
			open = null;
		} else {
			// Remove the fence's own indentation (fences inside list items).
			open.body.push(line.slice(Math.min(open.indent, /^\s*/.exec(line)?.[0].length ?? 0)));
		}
	});
	return fences;
}

/**
 * Blank out fenced code so prose scans never see code; line numbers are preserved.
 * @param {string} markdown
 */
export function stripFences(markdown) {
	const lines = markdown.split('\n');
	for (const f of scanFences(markdown)) {
		for (let i = f.start - 1; i < f.end; i++) lines[i] = '';
	}
	return lines.join('\n');
}

/**
 * `## Task N — Title` headings outside code, in order.
 * @param {string} markdown
 * @returns {{ n: number, title: string, line: number }[]}
 */
export function taskHeadings(markdown) {
	const out = [];
	stripFences(markdown).split('\n').forEach((line, i) => {
		const m = /^##\s+Task\s+(\d+)\s*(?:[—–-]\s*)?(.*)$/.exec(line);
		if (m) out.push({ n: Number(m[1]), title: m[2].trim(), line: i + 1 });
	});
	return out;
}

/**
 * `<!-- name -->` comment markers outside code, in order.
 * @param {string} markdown
 * @returns {{ name: string, line: number }[]}
 */
export function markers(markdown) {
	const out = [];
	stripFences(markdown).split('\n').forEach((line, i) => {
		for (const m of line.matchAll(/<!--\s*(\/?[\w:-]+)[^>]*?-->/g)) out.push({ name: m[1], line: i + 1 });
	});
	return out;
}

/**
 * Problems with markers: unknown names, and unbalanced or nested open/close pairs.
 * @param {string} markdown
 * @returns {string[]}
 */
export function markerProblems(markdown) {
	const problems = [];
	/** @type {{ name: string, line: number } | null} */
	let open = null;
	for (const m of markers(markdown)) {
		if (!KNOWN_MARKERS.has(m.name)) {
			problems.push(`line ${m.line}: unknown marker <!-- ${m.name} -->`);
			continue;
		}
		const base = m.name.replace(/^\//, '').replace(/:.*$/, '');
		if (!m.name.startsWith('/')) {
			if (open) problems.push(`line ${m.line}: <!-- ${m.name} --> opened inside <!-- ${open.name} --> (line ${open.line})`);
			open = m;
		} else if (!open || open.name.replace(/:.*$/, '') !== base) {
			problems.push(`line ${m.line}: <!-- ${m.name} --> without a matching opener`);
		} else {
			open = null;
		}
	}
	if (open) problems.push(`line ${open.line}: <!-- ${open.name} --> is never closed`);
	return problems;
}

/**
 * Split a task's markdown into prose, worked examples, and hint ladders.
 * @param {string} taskMarkdown
 * @returns {({ kind: 'prose' | 'example', markdown: string } | { kind: 'ladder', hints: string[], solution?: string })[]}
 */
export function parseTaskParts(taskMarkdown) {
	/** @type {any[]} */
	const parts = [];
	/** @type {{ hints: string[], solution?: string } | null} */
	let ladder = null;
	const flush = () => {
		if (ladder) parts.push({ kind: 'ladder', ...ladder });
		ladder = null;
	};
	const prose = (text) => {
		if (text.trim()) {
			flush();
			parts.push({ kind: 'prose', markdown: text.trim() });
		}
	};
	const re = /<!--\s*(example|hint|solution)\s*-->\n?([\s\S]*?)<!--\s*\/\1\s*-->\n?/g;
	let last = 0;
	for (const m of taskMarkdown.matchAll(re)) {
		prose(taskMarkdown.slice(last, m.index));
		last = (m.index ?? 0) + m[0].length;
		const body = m[2].trim();
		if (m[1] === 'example') {
			flush();
			parts.push({ kind: 'example', markdown: body });
		} else if (m[1] === 'hint') {
			(ladder ??= { hints: [] }).hints.push(body);
		} else {
			(ladder ??= { hints: [] }).solution = body;
		}
	}
	prose(taskMarkdown.slice(last));
	flush();
	return parts;
}

const YOUTUBE_FIELDS = ['id', 'title', 'duration', 'summary'];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Parse and validate a `youtube` fence body.
 * @param {string} source
 * @returns {{ values: Record<string, string>, errors: string[] }}
 */
export function parseYoutube(source) {
	/** @type {Record<string, string>} */
	const values = {};
	const errors = [];
	source.replace(/\n$/, '').split('\n').forEach((raw, index) => {
		const line = raw.trim();
		if (!line) return;
		const m = /^([a-z]+):\s*(.*)$/.exec(line);
		if (!m) return errors.push(`line ${index + 1} must use "key: value"`);
		const [, key, value] = m;
		if (!YOUTUBE_FIELDS.includes(key)) return errors.push(`line ${index + 1} has unknown field "${key}"`);
		if (values[key] !== undefined) return errors.push(`field "${key}" appears more than once`);
		if (!value.trim()) return errors.push(`field "${key}" cannot be blank`);
		values[key] = value.trim();
	});
	for (const field of YOUTUBE_FIELDS) if (values[field] === undefined) errors.push(`missing field "${field}"`);
	if (values.id !== undefined && !YOUTUBE_ID.test(values.id)) errors.push('field "id" must be an 11-character YouTube video ID');
	return { values, errors };
}

/**
 * Remove a leading `# H1` line (Starlight renders the title itself).
 * @param {string} markdown
 */
export function stripLeadingH1(markdown) {
	return markdown.replace(/^\s*# [^\n]*\n+/, '');
}

/**
 * The first sentence of the first prose paragraph, as plain text.
 * @param {string} markdown
 */
export function firstSentence(markdown) {
	const text = stripFences(stripLeadingH1(markdown));
	const para = text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.find((p) => p && !/^(#|>|<!--|[-*] |\d+\. |\|)/.test(p));
	if (!para) return '';
	const plain = para
		.replace(/\s*\n\s*/g, ' ')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[*_`]/g, '');
	const m = /^(.+?[.!?])(\s|$)/.exec(plain);
	return (m ? m[1] : plain).trim();
}

/**
 * URL-safe slug: `Files & Processes` -> `files-processes`.
 * @param {string} text
 */
export function slugify(text) {
	return text.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
