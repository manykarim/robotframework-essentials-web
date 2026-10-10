// Which labs get a browser lab, and what their playground pages need. Used at build time by
// the playground pages, the lab cards and the Markdown pipeline.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { robotBlocks } from './blocks.mjs';

/** Labs that need the Browser library (ch08–ch10) have no browser lab. */
export const hasPlayground = (lab) => Boolean(lab) && !lab.requires.includes('browser');

/** Path of a lab's playground page, e.g. `/robotframework-essentials-web/labs/ch03-keywords-imports/`. */
export const playgroundPath = (basePath, labId) => `${basePath.replace(/\/+$/, '')}/labs/${labId}/`;

/** Lab ids with a playground, in course order. */
export function playgroundLabs(course) {
	return Object.keys(course.labs).filter((id) => hasPlayground(course.labs[id]));
}

/** What Run executes: the lessons' own command. */
export const RUN_COMMAND = 'robot --outputdir results checks';

/** The lessons of a lab, with their chapter. */
export function labLessons(course, labId) {
	const lab = course.labs[labId];
	const out = [];
	for (const part of course.parts) {
		for (const chapter of part.chapters) {
			for (const lesson of chapter.lessons) if (lab.lessons.includes(lesson.href)) out.push({ chapter, lesson });
		}
	}
	return out;
}

/**
 * For a lab without `checks/` (ch02's starter): the suite file its first lessons ask the
 * learner to create, from the paragraph that introduces the first lab-step block.
 */
export function firstSuiteToCreate(course, labId, root) {
	const lab = course.labs[labId];
	if (lab.files.some((f) => f.startsWith('checks/'))) return null;
	for (const { chapter, lesson } of labLessons(course, labId)) {
		const md = readFileSync(path.join(root, 'src/content/docs', chapter.id, `${lesson.slug}.md`), 'utf8');
		for (const block of robotBlocks(md, { labFiles: lab.files, lessonSlug: lesson.slug })) {
			const named = block.lead.find((c) => /^checks\/[\w./-]+\.robot$/.test(c));
			if (named) return named;
		}
	}
	return 'checks/first_suite.robot';
}
