// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { BASE, SITE } from './site.config.mjs';
import { rfeMarkdown } from './src/rfe/markdown/index.mjs';

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

// Course structure written by scripts/rfe-import.mjs.
const course = readJson('./src/rfe/generated/course.json');
const sidebar = [
	{ label: 'Course overview', slug: 'index' },
	...course.parts.map((/** @type {any} */ part) => ({
		label: `Part ${part.n} · ${part.title}`,
		collapsed: true,
		items: [
			{ label: `Part ${part.n} overview`, slug: part.slug },
			...part.chapters.map((/** @type {any} */ chapter) => ({
				label: `${chapter.number} · ${chapter.title}`,
				collapsed: true,
				items: chapter.lessons.map((/** @type {any} */ lesson) => ({
					slug: `${chapter.id}/${lesson.slug}`,
				})),
			})),
		],
	})),
	{ label: 'Glossary', slug: 'glossary' },
];

// RobotCode's Robot Framework grammar (vendored, Apache-2.0; see src/rfe/vendor/NOTICE.md).
// Its own `fileTypes` would alias `robotframework` to itself, so they are replaced by `aliases`.
const { fileTypes: _fileTypes, ...robotframeworkTm } = readJson('./src/rfe/vendor/robotframework.tmLanguage.json');
const robotframeworkGrammar = { ...robotframeworkTm, name: 'robotframework', aliases: ['robot', 'resource'] };

// https://astro.build/config
export default defineConfig({
	// GitHub Pages project site; see site.config.mjs.
	site: SITE,
	base: BASE,
	trailingSlash: 'ignore',
	integrations: [
		// Must come before Starlight: its Markdown plugins run before Starlight's own.
		rfeMarkdown(),
		starlight({
			title: 'Robot Framework Essentials',
			description: 'A hands-on Robot Framework course: from your first suite to running Robot Framework in CI.',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/manykarim/robotframework-essentials-web' },
			],
			plugins: [starlightLinksValidator()],
			customCss: ['./src/rfe/styles/rfe.css'],
			components: {
				MarkdownContent: './src/rfe/components/MarkdownContent.astro',
			},
			head: [
				{
					// Apply the saved Python runner before first paint, so commands don't flash.
					tag: 'script',
					content:
						"try{var r=localStorage.getItem('rfe:v1:runner');if(r==='venv'||r==='poetry')document.documentElement.dataset.rfeRunner=r}catch(e){}",
				},
			],
			expressiveCode: {
				shiki: {
					langs: [robotframeworkGrammar],
				},
			},
			sidebar,
		}),
	],
});
