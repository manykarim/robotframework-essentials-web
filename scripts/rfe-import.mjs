#!/usr/bin/env node
// Robot Framework Essentials importer.
//
// Regenerates the web edition of the course from a local rf-training-platform checkout:
//   node scripts/rfe-import.mjs <path-to-rf-training-platform>
//
// Reads courses/rf-tutorial (manifests, lesson content, seed stages) and writes:
//   src/content/docs/              every page of the site: landing, parts, lessons, glossary
//   src/rfe/generated/course.json  course order, sidebar, labs, glossary
//   labs/                          source-only lab files per seed stage
// Hand-maintained inputs: src/rfe/overrides/, src/rfe/rewrites.json, src/rfe/templates/.
// Links are built from BASE in site.config.mjs; templates and overrides write `{{base}}`.
// Uses Node built-ins only, so it runs without `npm ci`.
import { execFileSync } from 'node:child_process';
import {
	copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	firstSentence, markerProblems, parseYoutube, scanFences, slugify, stripLeadingH1, taskHeadings,
} from '../src/rfe/lib/dialect.mjs';
import { renderDiagram } from '../src/rfe/vendor/diagram-renderer.mjs';
import { BASE } from '../site.config.mjs';

/** URL prefix of every page, e.g. `/robotframework-essentials-web`. */
export const BASE_PATH = BASE.replace(/\/+$/, '');
/** Generated directories, relative to the repository root. Everything in them is replaced. */
export const GENERATED = {
	pages: 'src/content/docs',
	data: 'src/rfe/generated',
	labs: 'labs',
};
/** Chapters whose tasks create the project from scratch, so they get no lab. */
const CHAPTERS_WITHOUT_LAB = ['ch00-orientation', 'ch01-introduction'];
/** The project the course builds in ch01; the lab for chapters before any seed. */
const INITIAL_STAGE = 'p1-first-suite';
const TASK_KINDS = ['edit', 'run', 'read', 'quiz'];
const DATA_OVERRIDE_FIELDS = ['title', 'tasks', 'quiz', 'deck'];
const KNOWN_FENCES = new Set([
	'', 'robotframework', 'robot', 'resource', 'python', 'py', 'bash', 'sh', 'shell', 'console',
	'toml', 'json', 'yaml', 'yml', 'ini', 'xml', 'csv', 'text', 'txt', 'md', 'markdown',
	'terminal', 'diagram', 'youtube',
]);

export class ImportError extends Error {
	/** @param {string[]} problems */
	constructor(problems) {
		super(`Import failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
		this.problems = problems;
	}
}

/** `0001-suite-files-and-sections` -> `suite-files-and-sections` */
export function lessonSlug(lessonId) {
	return lessonId.replace(/^\d+-/, '');
}

/** `ch02-first-suite` -> `2`, `ch19b-variable-files` -> `19b` */
function chapterNumber(chapterId) {
	const m = /^ch0*(\d+[a-z]?)/.exec(chapterId);
	return m ? m[1] : chapterId;
}

// ---------------------------------------------------------------------------
// YAML front matter (block style; every string double-quoted via JSON escaping,
// which is valid YAML).

// U+2028/U+2029 are line breaks in YAML 1.1 parsers; JSON.stringify leaves them raw.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
function yamlScalar(v) {
	if (typeof v === 'string') return JSON.stringify(v).split(LS).join('\\u2028').split(PS).join('\\u2029');
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (v === null) return 'null';
	throw new Error(`unsupported front matter value: ${typeof v}`);
}
const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** @returns {string[]} */
function yamlLines(value, indent) {
	const pad = ' '.repeat(indent);
	const lines = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			if (isScalar(item)) lines.push(`${pad}- ${yamlScalar(item)}`);
			else {
				const inner = yamlLines(item, indent + 2);
				lines.push(`${pad}- ${inner[0].trimStart()}`, ...inner.slice(1));
			}
		}
		return lines;
	}
	for (const [key, v] of Object.entries(value)) {
		if (v === undefined) continue;
		if (isScalar(v)) lines.push(`${pad}${key}: ${yamlScalar(v)}`);
		else if (Array.isArray(v) && v.length === 0) lines.push(`${pad}${key}: []`);
		else if (!Array.isArray(v) && Object.keys(v).length === 0) lines.push(`${pad}${key}: {}`);
		else lines.push(`${pad}${key}:`, ...yamlLines(v, indent + 2));
	}
	return lines;
}

function frontmatter(notice, data) {
	return ['---', ...notice.map((l) => `# ${l}`), ...yamlLines(data, 0), '---', ''].join('\n');
}

// ---------------------------------------------------------------------------

function readJson(file) {
	return JSON.parse(readFileSync(file, 'utf8'));
}

function git(cwd, args) {
	try {
		return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

/** Files under `dir`, relative, sorted, `/`-separated. */
function listFiles(dir, base = dir) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const name of readdirSync(dir).sort()) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
		else out.push(path.relative(base, full).split(path.sep).join('/'));
	}
	return out;
}

function writeFile(file, content) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

/**
 * Expand `{{base}}` in an override body. A `{{` right after a Robot Framework variable sigil
 * (`${{expression}}`) is code, not a placeholder.
 */
function fillOverride(text, rel, problems) {
	return text.replace(/(?<![$@&%])\{\{(\w+)\}\}/g, (match, key) => {
		if (key === 'base') return BASE_PATH;
		problems.push(`${rel}: unknown placeholder ${match} (allowed: {{base}})`);
		return match;
	});
}

function fillTemplate(text, values) {
	return text.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
		if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
		return String(values[key]);
	});
}

/** Load body (`.md`) and data (`.json`) overrides keyed `<chapterId>/<lessonId>`. */
function loadOverrides(dir, problems) {
	/** @type {Map<string, { body?: string, data?: Record<string, unknown>, files: string[] }>} */
	const overrides = new Map();
	if (!existsSync(dir)) return overrides;
	for (const chapter of readdirSync(dir).sort()) {
		const chapterDir = path.join(dir, chapter);
		if (!statSync(chapterDir).isDirectory()) continue;
		for (const file of readdirSync(chapterDir).sort()) {
			const ext = path.extname(file);
			const key = `${chapter}/${path.basename(file, ext)}`;
			const entry = overrides.get(key) ?? { files: [] };
			const rel = `src/rfe/overrides/${chapter}/${file}`;
			entry.files.push(rel);
			if (ext === '.md') entry.body = fillOverride(readFileSync(path.join(chapterDir, file), 'utf8'), rel, problems);
			else if (ext === '.json') {
				try {
					entry.data = readJson(path.join(chapterDir, file));
				} catch (e) {
					problems.push(`${rel}: invalid JSON (${e.message})`);
					continue;
				}
				for (const field of Object.keys(entry.data)) {
					if (!DATA_OVERRIDE_FIELDS.includes(field)) problems.push(`${rel}: unknown field "${field}" (allowed: ${DATA_OVERRIDE_FIELDS.join(', ')})`);
				}
			} else problems.push(`${rel}: overrides must be .md (body) or .json (data)`);
			overrides.set(key, entry);
		}
	}
	return overrides;
}

/** Load `[{ scope, find, replace }]` rewrite rules. */
function loadRewrites(file, problems) {
	if (!existsSync(file)) return [];
	let rules;
	try {
		rules = readJson(file);
	} catch (e) {
		problems.push(`src/rfe/rewrites.json: invalid JSON (${e.message})`);
		return [];
	}
	if (!Array.isArray(rules)) {
		problems.push('src/rfe/rewrites.json: must be an array of { scope, find, replace }');
		return [];
	}
	return rules.map((rule, i) => {
		const name = `rewrite #${i + 1} (${JSON.stringify(rule.find ?? '').slice(0, 50)})`;
		if (typeof rule.scope !== 'string' || typeof rule.find !== 'string' || !rule.find || typeof rule.replace !== 'string') {
			problems.push(`src/rfe/rewrites.json: ${name} needs string "scope", non-empty "find", and string "replace"`);
		}
		return { ...rule, name, hits: 0 };
	});
}

/**
 * Run the import.
 * @param {{ upstream: string, repo: string, log?: (msg: string) => void }} options
 */
export function runImport({ upstream, repo, log = console.log }) {
	const courseDir = path.join(upstream, 'courses', 'rf-tutorial');
	const manifestsDir = path.join(courseDir, 'manifests');
	if (!existsSync(manifestsDir)) {
		throw new ImportError([`no course found: expected ${path.join(path.resolve(upstream), 'courses/rf-tutorial/manifests/')}`]);
	}

	/** @type {string[]} */
	const problems = [];
	/** @type {string[]} */
	const warnings = [];

	// --- Provenance ---------------------------------------------------------
	let version = 'unknown';
	const configFile = path.join(upstream, 'fieldcraft.config.mjs');
	if (existsSync(configFile)) version = /\bversion:\s*['"]([^'"]+)['"]/.exec(readFileSync(configFile, 'utf8'))?.[1] ?? version;
	const commit = git(upstream, ['rev-parse', '--short', 'HEAD']) || 'unknown';
	const commitDate = git(upstream, ['log', '-1', '--format=%cs']) || 'unknown';
	const dirty = git(upstream, ['status', '--porcelain', '--', 'courses/rf-tutorial']) !== '';
	if (dirty) warnings.push('upstream courses/rf-tutorial has uncommitted changes; provenance is marked "-dirty"');
	const provenance = { courseName: 'Robot Framework Essentials', version, commit: dirty ? `${commit}-dirty` : commit, commitDate };

	const overrides = loadOverrides(path.join(repo, 'src/rfe/overrides'), problems);
	const rewrites = loadRewrites(path.join(repo, 'src/rfe/rewrites.json'), problems);
	const templates = Object.fromEntries(
		['landing', 'part', 'glossary'].map((t) => [t, readFileSync(path.join(repo, `src/rfe/templates/${t}.md`), 'utf8')]),
	);

	// --- Manifests -> lessons --------------------------------------------------
	const manifests = readdirSync(manifestsDir)
		.filter((f) => f.endsWith('.json'))
		.sort()
		.map((f) => readJson(path.join(manifestsDir, f)))
		.sort((a, b) => a.series.part - b.series.part);
	const partCount = manifests.length;

	const stagesDir = path.join(courseDir, 'stages');
	const stageCache = new Map();
	const stage = (id) => {
		if (!stageCache.has(id)) {
			const file = path.join(stagesDir, id, 'stage.json');
			if (!existsSync(file)) {
				problems.push(`seed stage "${id}" not found at ${file}`);
				stageCache.set(id, null);
			} else stageCache.set(id, readJson(file));
		}
		return stageCache.get(id);
	};

	const parts = [];
	const lessons = [];
	/** @type {Record<string, any>} */
	const labs = {};
	let activeStage = null;
	let manifestQuiz = 0;
	let manifestDeck = 0;
	const usedOverrides = new Set();

	for (const m of manifests) {
		const n = m.series.part;
		const partTitle = m.title.includes(': ') ? m.title.split(': ').slice(1).join(': ') : m.title;
		const part = { n, title: partTitle, slug: `part-${n}-${slugify(partTitle)}`, browserRequired: Boolean(m.browserRequired), chapters: [] };
		parts.push(part);

		for (const c of m.chapters) {
			const chapter = { id: c.id, number: chapterNumber(c.id), title: c.title, icon: c.waypoint?.icon ?? null, part: n, lab: null, lessons: [] };
			part.chapters.push(chapter);
			const withLab = !CHAPTERS_WITHOUT_LAB.includes(c.id);
			const slugs = new Set();
			let currentLab = null;

			c.lessons.forEach((l, index) => {
				const key = `${c.id}/${l.id}`;
				const slug = lessonSlug(l.id);
				if (slugs.has(slug)) problems.push(`${key}: lesson slug "${slug}" collides with another lesson in ${c.id}`);
				slugs.add(slug);
				manifestQuiz += l.quiz?.length ?? 0;
				manifestDeck += l.deck?.length ?? 0;

				// Labs: chapter lab at the first lesson, lesson lab for a later re-seed.
				if (index === 0) {
					if (l.seed) activeStage = l.seed;
					if (withLab) {
						const stageId = activeStage ?? INITIAL_STAGE;
						currentLab = c.id;
						labs[currentLab] = { id: currentLab, kind: 'chapter', stage: stageId, part: n, chapterId: c.id, title: c.title, lessons: [] };
						chapter.lab = currentLab;
					}
				} else if (l.seed) {
					activeStage = l.seed;
					if (withLab) {
						currentLab = `${c.id}--${slug}`;
						labs[currentLab] = { id: currentLab, kind: 'lesson', stage: l.seed, part: n, chapterId: c.id, title: l.title, lessons: [] };
					}
				}

				const contentFile = path.join(courseDir, c.id, l.id, 'content.en.md');
				if (!existsSync(contentFile)) {
					problems.push(`${key}: missing content file ${contentFile}`);
					return;
				}
				const override = overrides.get(key);
				if (override) usedOverrides.add(key);
				let body = override?.body ?? readFileSync(contentFile, 'utf8');
				for (const rule of rewrites) {
					if (rule.scope !== '*' && rule.scope !== key) continue;
					const hits = body.split(rule.find).length - 1;
					if (hits) {
						rule.hits += hits;
						body = body.split(rule.find).join(rule.replace);
					}
				}
				body = stripLeadingH1(body).replace(/\r\n/g, '\n').replace(/\s*$/, '\n');

				const data = override?.data ?? {};
				const title = /** @type {string} */ (data.title ?? l.title);
				const tasks = /** @type {{ title: string, kind?: string }[]} */ (
					data.tasks ?? l.tasks.map((t, i) => ({ title: t, kind: l.taskIcons?.[i] }))
				);
				const quiz = /** @type {any[]} */ (data.quiz ?? l.quiz ?? []);
				const deck = /** @type {any[]} */ (data.deck ?? l.deck ?? []);

				// Validation.
				for (const p of markerProblems(body)) problems.push(`${key}: ${p}`);
				const headings = taskHeadings(body);
				if (!(headings.length === tasks.length || (headings.length === 0 && tasks.length === 1))) {
					problems.push(`${key}: ${headings.length} "## Task N" headings but ${tasks.length} tasks`);
				}
				for (const t of tasks) {
					if (t.kind && !TASK_KINDS.includes(t.kind)) problems.push(`${key}: unknown task kind "${t.kind}"`);
				}
				for (const q of quiz) {
					if (!Array.isArray(q.options) || !(q.answerIndex >= 0 && q.answerIndex < q.options.length)) {
						problems.push(`${key}: quiz question "${q.question}" has no valid answerIndex`);
					}
				}
				for (const f of scanFences(body)) {
					if (f.lang === 'diagram') {
						const { error } = renderDiagram(f.body);
						if (error) problems.push(`${key}: diagram at line ${f.start}: ${error}`);
					} else if (f.lang === 'youtube') {
						for (const e of parseYoutube(f.body).errors) problems.push(`${key}: youtube block at line ${f.start}: ${e}`);
					} else if (!KNOWN_FENCES.has(f.lang)) {
						warnings.push(`${key}: fence language "${f.lang}" at line ${f.start} renders as plain text`);
					}
				}

				const lesson = {
					key, chapterId: c.id, lessonId: l.id, slug, href: `${BASE_PATH}/${c.id}/${slug}/`,
					title, description: firstSentence(body), part: n, partTitle, chapterTitle: c.title,
					chapterNumber: chapter.number, scope: l.officialScope ?? null, tasks, quiz, deck,
					lab: currentLab, body,
				};
				lessons.push(lesson);
				chapter.lessons.push({ id: l.id, slug, href: lesson.href, title, scope: lesson.scope, tasks: tasks.length, lab: currentLab });
				if (currentLab) labs[currentLab].lessons.push(lesson.href);
			});
		}
	}

	for (const [key, ov] of overrides) {
		if (!usedOverrides.has(key)) problems.push(`stale override ${ov.files.join(', ')}: no upstream lesson "${key}"`);
	}
	for (const rule of rewrites) {
		if (rule.hits === 0) problems.push(`src/rfe/rewrites.json: ${rule.name} matched nothing in scope "${rule.scope}"`);
	}

	// --- Lab stages ------------------------------------------------------------
	const stageIds = [...new Set(Object.values(labs).map((lab) => lab.stage))].sort();
	const stageFiles = {};
	let python = null;
	for (const id of stageIds) {
		const s = stage(id);
		if (!s) continue;
		stageFiles[id] = [...s.files].sort();
		for (const f of stageFiles[id]) {
			if (!existsSync(path.join(stagesDir, id, 'files', f))) problems.push(`stage ${id}: declared file "${f}" is missing`);
		}
		const pyproject = path.join(stagesDir, id, 'files', 'pyproject.toml');
		const req = existsSync(pyproject) ? /requires-python\s*=\s*"[>=~^]*\s*(\d+\.\d+)/.exec(readFileSync(pyproject, 'utf8'))?.[1] : null;
		if (req && (!python || Number(req.split('.')[1]) > Number(python.split('.')[1]))) python = req;
	}
	for (const lab of Object.values(labs)) {
		const s = stage(lab.stage);
		lab.requires = s?.requires ?? [];
		lab.validation = s?.validation ?? 'unknown';
		lab.files = stageFiles[lab.stage] ?? [];
	}
	for (const part of parts) {
		const req = new Set(part.chapters.flatMap((c) => (c.lab ? labs[c.lab].requires : [])));
		part.requires = [...req].sort();
	}

	if (problems.length) throw new ImportError(problems);

	// --- Glossary --------------------------------------------------------------
	/** @type {Map<string, { term: string, kind: string, entries: any[] }>} */
	const terms = new Map();
	for (const lesson of lessons) {
		for (const d of lesson.deck) {
			const k = d.term.toLowerCase();
			if (!terms.has(k)) terms.set(k, { term: d.term, kind: d.kind, entries: [] });
			terms.get(k).entries.push({ note: d.note, href: lesson.href, lesson: lesson.title, chapter: lesson.chapterTitle });
		}
	}
	const glossary = [...terms.values()].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }) || a.term.localeCompare(b.term));

	// --- Write to a staging directory, then swap -----------------------------------
	const staging = path.join(repo, '.rfe-import-tmp');
	rmSync(staging, { recursive: true, force: true });
	const out = (kind, rel) => path.join(staging, kind, rel);
	const notice = [
		`GENERATED by scripts/rfe-import.mjs from rf-training-platform ${provenance.version} (${provenance.commit}). Do not edit.`,
		'Change the upstream course, src/rfe/overrides/, src/rfe/rewrites.json or src/rfe/templates/,',
		'then re-run: node scripts/rfe-import.mjs <path-to-rf-training-platform>',
	];

	for (const lesson of lessons) {
		const fm = frontmatter(notice, {
			title: lesson.title,
			description: lesson.description,
			rfe: {
				kind: 'lesson', part: lesson.part, chapterId: lesson.chapterId, lessonId: lesson.lessonId,
				...(lesson.scope ? { scope: lesson.scope } : {}),
				tasks: lesson.tasks.map((t) => (t.kind ? { title: t.title, kind: t.kind } : { title: t.title })),
				quiz: lesson.quiz.map((q) => ({ question: q.question, options: q.options, answerIndex: q.answerIndex, explanation: q.explanation })),
				deck: lesson.deck.map((d) => ({ term: d.term, kind: d.kind, note: d.note })),
				...(lesson.lab ? { lab: lesson.lab } : {}),
			},
		});
		writeFile(out('pages', `${lesson.chapterId}/${lesson.slug}.md`), fm + '\n' + lesson.body);
	}

	const lessonCount = lessons.length;
	writeFile(
		out('pages', 'index.md'),
		frontmatter(notice, {
			title: provenance.courseName,
			description: `A hands-on Robot Framework course in ${partCount} parts, from your first suite to running Robot Framework in CI.`,
			// The course is the site, so the home page's <title> is just its name, not "name | name".
			head: [{ tag: 'title', content: provenance.courseName }],
			prev: false,
			rfe: { kind: 'landing' },
		}) + '\n' + fillTemplate(templates.landing, { ...provenance, python: python ?? '3', base: BASE_PATH }),
	);
	parts.forEach((part) => {
		const count = part.chapters.reduce((s, c) => s + c.lessons.length, 0);
		writeFile(
			out('pages', `${part.slug}.md`),
			frontmatter(notice, {
				title: `Part ${part.n}: ${part.title}`,
				description: `Part ${part.n} of Robot Framework Essentials: ${part.chapters.map((c) => c.title).join(', ')}.`,
				tableOfContents: false,
				rfe: { kind: 'part', part: part.n },
			}) + '\n' + fillTemplate(templates.part, { n: part.n, partCount, chapterCount: part.chapters.length, lessonCount: count, base: BASE_PATH }),
		);
	});
	writeFile(
		out('pages', 'glossary.md'),
		frontmatter(notice, {
			title: 'Glossary',
			description: 'Every key term from Robot Framework Essentials, with the lesson that introduces it.',
			next: false,
			tableOfContents: false,
			rfe: { kind: 'glossary' },
		}) + '\n' + fillTemplate(templates.glossary, { base: BASE_PATH }),
	);

	const course = {
		_generated: notice.join(' '),
		provenance,
		basePath: BASE_PATH,
		python,
		parts: parts.map((p) => ({ ...p, href: `${BASE_PATH}/${p.slug}/` })),
		labs: Object.fromEntries(Object.keys(labs).sort().map((k) => [k, labs[k]])),
		glossary,
	};
	writeFile(out('data', 'course.json'), JSON.stringify(course, null, '\t') + '\n');

	for (const id of stageIds) {
		for (const f of stageFiles[id]) {
			const target = out('labs', `${id}/${f}`);
			mkdirSync(path.dirname(target), { recursive: true });
			copyFileSync(path.join(stagesDir, id, 'files', f), target);
		}
	}
	writeFile(
		out('labs', 'GENERATED.md'),
		`# Generated lab sources\n\n${notice.join('\n')}\n\nFiles here are byte-identical copies of the upstream seed stages\n(courses/rf-tutorial/stages/<id>/files/). The site packages them into lab .zip downloads.\n`,
	);

	// Count what was written, to prove nothing was lost on the way.
	let writtenQuiz = 0;
	let writtenDeck = 0;
	for (const f of listFiles(path.join(staging, 'pages'))) {
		const text = readFileSync(out('pages', f), 'utf8');
		writtenQuiz += (text.match(/^ {4}- question: /gm) ?? []).length;
		writtenDeck += (text.match(/^ {4}- term: /gm) ?? []).length;
	}
	const expectedQuiz = lessons.reduce((s, l) => s + l.quiz.length, 0);
	const expectedDeck = lessons.reduce((s, l) => s + l.deck.length, 0);
	const lessonPages = listFiles(path.join(staging, 'pages')).filter((f) => f.includes('/')).length;
	const countProblems = [];
	if (lessonPages !== lessonCount) countProblems.push(`wrote ${lessonPages} lesson pages, expected ${lessonCount}`);
	if (writtenQuiz !== expectedQuiz || writtenQuiz < manifestQuiz) countProblems.push(`wrote ${writtenQuiz} quiz questions, expected ${expectedQuiz} (manifests declare ${manifestQuiz})`);
	if (writtenDeck !== expectedDeck || writtenDeck < manifestDeck) countProblems.push(`wrote ${writtenDeck} key terms, expected ${expectedDeck} (manifests declare ${manifestDeck})`);
	if (countProblems.length) {
		rmSync(staging, { recursive: true, force: true });
		throw new ImportError(countProblems);
	}

	// Diff summary against the current generated output, then swap.
	const changes = { added: 0, changed: 0, removed: 0 };
	for (const [kind, rel] of Object.entries(GENERATED)) {
		const before = new Set(listFiles(path.join(repo, rel)));
		for (const f of listFiles(path.join(staging, kind))) {
			if (!before.has(f)) changes.added++;
			else if (!readFileSync(path.join(repo, rel, f)).equals(readFileSync(out(kind, f)))) changes.changed++;
			before.delete(f);
		}
		changes.removed += before.size;
	}
	for (const [kind, rel] of Object.entries(GENERATED)) {
		const target = path.join(repo, rel);
		rmSync(target, { recursive: true, force: true });
		mkdirSync(path.dirname(target), { recursive: true });
		renameSync(path.join(staging, kind), target);
	}
	rmSync(staging, { recursive: true, force: true });

	const summary = {
		provenance, parts: parts.length, chapters: parts.reduce((s, p) => s + p.chapters.length, 0), lessons: lessonCount,
		quiz: writtenQuiz, deck: writtenDeck, glossaryTerms: glossary.length,
		chapterLabs: Object.values(labs).filter((l) => l.kind === 'chapter').length,
		lessonLabs: Object.values(labs).filter((l) => l.kind === 'lesson').length,
		stages: stageIds.length, python,
		rewrites: rewrites.map((r) => ({ rule: r.name, scope: r.scope, hits: r.hits })),
		overrides: [...usedOverrides].sort(),
		warnings, changes,
	};
	log(`Imported ${provenance.courseName} ${provenance.version} (${provenance.commit}, ${provenance.commitDate})`);
	log(`  ${summary.parts} parts, ${summary.chapters} chapters, ${summary.lessons} lessons, ${summary.quiz} quiz questions, ${summary.deck} key terms (${summary.glossaryTerms} glossary terms)`);
	log(`  labs: ${summary.chapterLabs} chapter, ${summary.lessonLabs} lesson, from ${summary.stages} stages (Python >= ${python})`);
	log(`  overrides: ${summary.overrides.length ? summary.overrides.join(', ') : 'none'}`);
	for (const r of summary.rewrites) log(`  ${r.rule} [${r.scope}]: ${r.hits} replacement(s)`);
	for (const w of warnings) log(`  warning: ${w}`);
	log(`  files: ${changes.added} added, ${changes.changed} changed, ${changes.removed} removed`);
	return summary;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const upstream = process.argv[2];
	if (!upstream || upstream === '--help' || upstream === '-h') {
		console.error('Usage: node scripts/rfe-import.mjs <path-to-rf-training-platform>');
		process.exit(upstream ? 0 : 2);
	}
	const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	try {
		runImport({ upstream: path.resolve(upstream), repo });
	} catch (e) {
		rmSync(path.join(repo, '.rfe-import-tmp'), { recursive: true, force: true });
		console.error(e instanceof ImportError ? e.message : e);
		process.exit(1);
	}
}
