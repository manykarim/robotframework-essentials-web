import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Robot Framework Essentials data, written by scripts/rfe-import.mjs into the
// front matter of the pages under src/content/docs/.
const rfeTask = z.object({
	title: z.string(),
	kind: z.enum(['edit', 'run', 'read', 'quiz']).optional(),
});
const rfeQuestion = z.object({
	question: z.string(),
	options: z.array(z.string()).min(2),
	answerIndex: z.number().int().nonnegative(),
	explanation: z.string(),
}).refine((q) => q.answerIndex < q.options.length, { message: 'answerIndex is out of range' });
const rfeTerm = z.object({
	term: z.string(),
	kind: z.enum(['concept', 'keyword', 'command']),
	note: z.string(),
});
const rfe = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('lesson'),
		part: z.number().int().positive(),
		chapterId: z.string(),
		lessonId: z.string(),
		scope: z.string().optional(),
		tasks: z.array(rfeTask).min(1),
		quiz: z.array(rfeQuestion),
		deck: z.array(rfeTerm),
		lab: z.string().optional(),
	}),
	z.object({ kind: z.literal('landing') }),
	z.object({ kind: z.literal('part'), part: z.number().int().positive() }),
	z.object({ kind: z.literal('glossary') }),
]);

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({ extend: z.object({ rfe: rfe.optional() }) }),
	}),
};
