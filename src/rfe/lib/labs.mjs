// Lab downloads: what goes into each lab archive and the whole-course starter kit.
// Shared by the zip endpoint (src/pages/labs/[lab].zip.ts) and
// the lab card, so the file tree shown on a lesson is exactly what the archive holds.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createZip } from './zip.mjs';

export const STARTER_KIT = 'rf-essentials-starter-kit';
export const LAB_SOURCES = 'labs';

export const VSCODE_EXTENSIONS = JSON.stringify({ recommendations: ['d-biehl.robotcode', 'ms-python.python'] }, null, '\t') + '\n';

/** Setup steps per runner, as shell commands (bash/zsh and PowerShell where they differ). */
export const SETUP = {
	uv: { bash: 'uv sync', powershell: 'uv sync' },
	venv: {
		bash: 'python3 -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt',
		powershell: 'python -m venv .venv\n.venv\\Scripts\\Activate.ps1\npip install -r requirements.txt',
	},
	poetry: { bash: 'poetry install --no-root', powershell: 'poetry install --no-root' },
};

/** @param {string} labId */
export const labFolder = (labId) => (labId === STARTER_KIT ? STARTER_KIT : `rfe-${labId}`);
/** @param {string} labId */
export const labFile = (labId) => `${labId}.zip`;

/**
 * Absolute URL of a lab archive.
 * @param {URL | string | undefined} site
 * @param {string} basePath  e.g. `/robotframework-essentials-web`
 * @param {string} labId
 */
export function labUrl(site, basePath, labId) {
	const pathname = `${basePath}/labs/${labFile(labId)}`;
	return site ? new URL(pathname, site).href : pathname;
}

/** Text of a lab's LAB.md. */
export function labReadme(course, lab, site) {
	const abs = (href) => (site ? new URL(href, site).href : href);
	const part = course.parts.find((p) => p.n === lab.part);
	const chapter = part?.chapters.find((c) => c.id === lab.chapterId);
	const lessons = (chapter?.lessons ?? []).filter((l) => lab.lessons.includes(l.href));
	const lines = [
		`# Robot Framework Essentials — ${lab.kind === 'lesson' ? `${lab.title} (lesson lab)` : `${chapter?.number ?? ''} · ${lab.title}`}`,
		'',
		`Lab for Part ${lab.part} · ${part?.title ?? ''}${lab.kind === 'lesson' ? `, chapter ${chapter?.number} · ${chapter?.title}` : ''}.`,
		'',
		'## Lessons',
		'',
		...lessons.map((l) => `- [${l.title}](${abs(l.href)})`),
		'',
		'## Set up',
		'',
		'Open this folder in VS Code (`code .`) and run one of these in its terminal:',
		'',
		'- uv (recommended): `uv sync`',
		'- venv: `python3 -m venv .venv`, activate it (`source .venv/bin/activate`, or',
		'  `.venv\\Scripts\\Activate.ps1` on Windows), then `pip install -r requirements.txt`.',
		'  Keep the environment active in every terminal you run lesson commands in.',
		'- poetry: `poetry install --no-root`',
		'',
		`Python ${course.python ?? '3'} or newer is required; uv installs it when it is missing.`,
	];
	if (lab.requires.includes('browser')) {
		lines.push(
			'',
			'## Also needed: a browser engine',
			'',
			'The Browser library needs Node.js (an LTS release) installed. Then, once, run',
			'`uv run rfbrowser init chromium` (`rfbrowser init chromium` in an active venv,',
			'`poetry run rfbrowser init chromium` with poetry). It is a large download.',
		);
	}
	if (lab.requires.includes('sut')) {
		lines.push(
			'',
			'## Also needed: the RF Demo Shop',
			'',
			'Start it in its own terminal and keep it running while you work:',
			'`uv run python demo_app/serve.py` (`python demo_app/serve.py` in an active venv,',
			'`poetry run python demo_app/serve.py` with poetry).',
		);
	}
	lines.push('', `Content: ${course.provenance.courseName} ${course.provenance.version} (${course.provenance.commit}).`, '');
	return lines.join('\n');
}

/**
 * Entries of one lab archive (relative to the archive root).
 * @returns {{ path: string, data: Buffer | string }[]}
 */
export function labEntries(course, labId, { site, root }) {
	const lab = course.labs[labId];
	if (!lab) throw new Error(`unknown lab "${labId}"`);
	const folder = labFolder(labId);
	const sources = path.join(root, LAB_SOURCES, lab.stage);
	return [
		...lab.files.map((f) => ({ path: `${folder}/${f}`, data: readFileSync(path.join(sources, f)) })),
		{ path: `${folder}/LAB.md`, data: labReadme(course, lab, site) },
		{ path: `${folder}/.vscode/extensions.json`, data: VSCODE_EXTENSIONS },
	];
}

/** Lab ids in course order (chapter labs and the lesson labs inside them). */
export function labsInOrder(course) {
	const order = [];
	for (const part of course.parts) {
		for (const chapter of part.chapters) {
			for (const lesson of chapter.lessons) if (lesson.lab && !order.includes(lesson.lab)) order.push(lesson.lab);
		}
	}
	return order;
}

/** Text of the starter kit's README.md. */
export function starterKitReadme(course, site) {
	const abs = (href) => (site ? new URL(href, site).href : href);
	const lines = [
		'# Robot Framework Essentials — starter kit',
		'',
		'Every lab of the course, one folder each. Open the folder of the chapter you are',
		'working on in VS Code and set it up as its LAB.md describes.',
		'',
		`Course: ${abs(`${course.basePath}/`)}`,
		'',
		'| Folder | Lab for |',
		'| --- | --- |',
	];
	for (const id of labsInOrder(course)) {
		const lab = course.labs[id];
		lines.push(`| \`${labFolder(id)}/\` | Part ${lab.part}: ${lab.kind === 'lesson' ? `${lab.title} (lesson lab)` : lab.title} |`);
	}
	lines.push('', `Content: ${course.provenance.courseName} ${course.provenance.version} (${course.provenance.commit}).`, '');
	return lines.join('\n');
}

/** Entries of the starter kit archive. */
export function starterKitEntries(course, { site, root }) {
	return [
		{ path: `${STARTER_KIT}/README.md`, data: starterKitReadme(course, site) },
		{ path: `${STARTER_KIT}/.vscode/extensions.json`, data: VSCODE_EXTENSIONS },
		...labsInOrder(course).flatMap((id) => labEntries(course, id, { site, root }).map((e) => ({ ...e, path: `${STARTER_KIT}/${e.path}` }))),
	];
}

/** Build the archive for a lab id or the starter kit. */
export function labArchive(course, labId, { site, root }) {
	const entries = labId === STARTER_KIT ? starterKitEntries(course, { site, root }) : labEntries(course, labId, { site, root });
	return createZip(entries, { mtime: zipTime(course) });
}

/** Archive timestamp: the imported upstream commit date (stable across builds). */
function zipTime(course) {
	const d = new Date(`${course.provenance.commitDate}T00:00:00Z`);
	return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1980 ? new Date(Date.UTC(1980, 0, 1)) : d;
}
