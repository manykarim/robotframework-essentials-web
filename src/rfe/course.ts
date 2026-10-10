// Typed view of src/rfe/generated/course.json (written by scripts/rfe-import.mjs).
import data from './generated/course.json';

export interface CourseLesson {
	id: string;
	slug: string;
	href: string;
	title: string;
	scope: string | null;
	tasks: number;
	lab: string | null;
}
export interface CourseChapter {
	id: string;
	number: string;
	title: string;
	icon: string | null;
	part: number;
	lab: string | null;
	lessons: CourseLesson[];
}
export interface CoursePart {
	n: number;
	title: string;
	slug: string;
	href: string;
	browserRequired: boolean;
	requires: string[];
	chapters: CourseChapter[];
}
export interface CourseLab {
	id: string;
	kind: 'chapter' | 'lesson';
	stage: string;
	part: number;
	chapterId: string;
	title: string;
	lessons: string[];
	requires: string[];
	validation: string;
	files: string[];
}
export interface GlossaryTerm {
	term: string;
	kind: string;
	entries: { note: string; href: string; lesson: string; chapter: string }[];
}
export interface Course {
	provenance: { courseName: string; version: string; commit: string; commitDate: string };
	basePath: string;
	python: string | null;
	parts: CoursePart[];
	labs: Record<string, CourseLab>;
	glossary: GlossaryTerm[];
}

export const course = data as unknown as Course;
