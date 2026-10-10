// Sätteri Markdown plugins for the Robot Framework Essentials lesson dialect, usable on
// every page:
//   ```terminal / ```diagram / ```youtube fences, <!-- example|hint|solution|runner:X -->
//   regions, uv/venv/poetry command variants, Note/Tip/Warning callouts, **Check:** lines,
//   and task bars under `## Task N` headings (course lessons).
// Astro 7 renders Markdown with Sätteri; these are registered by `rfeMarkdown()`, an Astro
// integration listed before Starlight so they run before Starlight's own plugins (its
// aside plugin then renders the callouts this file turns into `:::note` directives).
import { fileURLToPath } from 'node:url';
import { parseYoutube } from '../lib/dialect.mjs';
import { iconSvg } from '../lib/icons.mjs';
import { RUNNERS, isRunnerSensitive, transformLine } from '../lib/runner.mjs';
import { renderDiagram } from '../vendor/diagram-renderer.mjs';

const SHELL = new Set(['bash', 'sh', 'shell']);
const MARKER = /^<!--\s*(\/?)(example|hint|solution|runner)(?::(\w+))?\s*-->\s*$/;
const TASK_HEADING = /^Task\s+(\d+)\b/;
const CALLOUTS = { 'Note:': 'note', 'Tip:': 'tip', 'Warning:': 'caution' };
const TASK_KIND_LABELS = { edit: 'Edit', run: 'Run', read: 'Read', quiz: 'Quiz' };

/** @param {string} text */
export function escapeHtml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** An element node in mdast: a paragraph whose `data.hName` sets the tag (as Starlight does). */
function el(tagName, properties, children = []) {
	return { type: 'paragraph', data: { hName: tagName, hProperties: properties }, children };
}
const html = (value) => ({ type: 'html', value });
const text = (value) => ({ type: 'text', value });

// ---------------------------------------------------------------------------
// Fences

/** Runner-variant spans for one command line; plain text when no runner changes it. */
function commandVariants(line) {
	if (!isRunnerSensitive(line)) return escapeHtml(line);
	return RUNNERS.map(
		(r) => `<span class="rfe-variant" data-runner="${r}"${r === 'uv' ? '' : ' data-pagefind-ignore'}>${escapeHtml(transformLine(line, r))}</span>`,
	).join('');
}

export function terminalHtml(source) {
	const rows = source
		.replace(/\n$/, '')
		.split('\n')
		.map((line) => {
			if (/^\$\s?/.test(line)) {
				return (
					'<div class="rfe-terminal__line rfe-terminal__line--input">' +
					'<span class="rfe-terminal__prompt" aria-hidden="true">$ </span>' +
					`<span class="rfe-terminal__cmd">${commandVariants(line.replace(/^\$\s?/, ''))}</span></div>`
				);
			}
			return `<div class="rfe-terminal__line rfe-terminal__line--output">${escapeHtml(line) || '&nbsp;'}</div>`;
		})
		.join('');
	return (
		'<div class="rfe-terminal not-content" data-rfe-terminal role="group" aria-label="Terminal demo">' +
		'<div class="rfe-terminal__bar" aria-hidden="true"><span></span><span></span><span></span></div>' +
		`<div class="rfe-terminal__frame">${rows}</div>` +
		'<button class="rfe-terminal__replay" type="button" data-pagefind-ignore hidden>↻ Replay</button>' +
		'</div>'
	);
}

export function diagramHtml(source) {
	const { svg, error } = renderDiagram(source);
	if (error || !svg) {
		return `<div class="rfe-block-error" role="note">Diagram error: ${escapeHtml(error ?? 'empty diagram')}</div>`;
	}
	const steps = svg.includes('class="fc-step"') ? ' data-steps="true"' : '';
	return `<figure class="rfe-diagram not-content" data-rfe-diagram${steps}><div class="rfe-diagram__stage">${svg}</div></figure>`;
}

export function youtubeHtml(source) {
	const { values, errors } = parseYoutube(source);
	if (errors.length) return `<div class="rfe-block-error" role="note">Video block error: ${escapeHtml(errors.join('; '))}</div>`;
	const { id } = values;
	const title = escapeHtml(values.title);
	return (
		`<figure class="rfe-video not-content" data-video-id="${id}">` +
		`<figcaption><span class="rfe-video__kicker">YouTube video · ${escapeHtml(values.duration)}</span>` +
		`<strong class="rfe-video__title">${title}</strong></figcaption>` +
		`<a class="rfe-video__link" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${title} on YouTube (opens in a new tab)">` +
		'<span class="rfe-video__media">' +
		`<img class="rfe-video__thumbnail" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" width="480" height="360" loading="lazy" decoding="async" referrerpolicy="no-referrer">` +
		'<span class="rfe-video__fallback" hidden><span class="rfe-video__fallback-icon" aria-hidden="true">▶</span><span>Preview unavailable</span></span>' +
		'<span class="rfe-video__play" aria-hidden="true">▶</span>' +
		'</span>' +
		'<span class="rfe-video__watch" aria-hidden="true">Watch on YouTube ↗</span>' +
		'</a>' +
		`<p class="rfe-video__summary">${escapeHtml(values.summary)}</p>` +
		'</figure>'
	);
}

export function runnerPickerHtml() {
	return (
		'<div class="rfe-runner-picker not-content" data-rfe-runner-picker data-pagefind-ignore hidden>' +
		'<span class="rfe-runner-picker__label" id="rfe-run-with">Run with</span>' +
		'<span class="rfe-runner-picker__options" role="radiogroup" aria-labelledby="rfe-run-with">' +
		RUNNERS.map((r) => `<button type="button" role="radio" data-runner="${r}" aria-checked="${r === 'uv'}">${r}</button>`).join('') +
		'</span></div>'
	);
}

function taskBarHtml(lessonKey, index, task) {
	const kind = task?.kind;
	const badge = kind
		? `<span class="rfe-task-badge rfe-task-badge--${kind}">${iconSvg(kind)}${TASK_KIND_LABELS[kind] ?? kind}</span>`
		: '';
	return (
		`<div class="rfe-task-bar not-content" data-rfe-task="${escapeHtml(lessonKey)}#${index}" data-pagefind-ignore>${badge}` +
		'<button type="button" class="rfe-task-done" aria-pressed="false" hidden>' +
		`${iconSvg('check')}<span class="rfe-task-done__label">Mark done</span></button></div>`
	);
}

// ---------------------------------------------------------------------------
// Pass 1: structure (regions, task bars, runner picker) over the document root.

/** Whether any code below `node` shows differently per runner. */
function hasRunnerContent(node) {
	if (node.type === 'code') {
		if (SHELL.has(node.lang ?? '')) return isRunnerSensitive(node.value);
		if (node.lang === 'terminal') return node.value.split('\n').some((l) => /^\$\s?/.test(l) && isRunnerSensitive(l.replace(/^\$\s?/, '')));
		return false;
	}
	return Array.isArray(node.children) && node.children.some(hasRunnerContent);
}

/** Group `<!-- marker -->` regions among `children` into wrapper elements. */
function groupRegions(children, report) {
	/** @type {any[]} */
	const out = [];
	let i = 0;
	let hintNo = 0;
	/** @type {any} */
	let ladder = null;
	const closeLadder = () => {
		if (ladder) out.push(ladder);
		ladder = null;
		hintNo = 0;
	};
	while (i < children.length) {
		const node = children[i];
		const m = node.type === 'html' ? MARKER.exec(node.value.trim()) : null;
		if (!m || m[1] === '/') {
			if (m) report(`stray ${node.value.trim()}`, node);
			// Whitespace-only nodes never appear in mdast, so any other node ends a ladder.
			closeLadder();
			out.push(node);
			i++;
			continue;
		}
		const [, , name, mode] = m;
		let j = i + 1;
		while (j < children.length && !(children[j].type === 'html' && new RegExp(`^<!--\\s*/${name}\\s*-->\\s*$`).test(children[j].value.trim()))) j++;
		if (j >= children.length) {
			report(`unclosed ${node.value.trim()}`, node);
			closeLadder();
			out.push(node);
			i++;
			continue;
		}
		const inner = children.slice(i + 1, j);
		if (name === 'example') {
			closeLadder();
			out.push(el('div', { class: 'rfe-example' }, [
				el('p', { class: 'rfe-example__label' }, [text('Worked example — adapt it, don’t copy it')]),
				...inner,
			]));
		} else if (name === 'runner') {
			closeLadder();
			out.push(el('div', { class: 'rfe-runner-only', 'data-runner-only': mode ?? 'uv' }, inner));
		} else {
			ladder ??= el('div', { class: 'rfe-ladder', 'data-rfe-ladder': '' }, []);
			if (name === 'hint') {
				hintNo++;
				ladder.children.push(el('details', { class: 'rfe-ladder__hint' }, [el('summary', {}, [text(`Hint ${hintNo}`)]), ...inner]));
			} else {
				ladder.children.push(
					el('details', { class: 'rfe-ladder__solution', 'data-pagefind-ignore': '' }, [el('summary', {}, [text('Solution')]), ...inner]),
				);
			}
		}
		i = j + 1;
	}
	closeLadder();
	return out;
}

export const structurePlugin = {
	name: 'rfe-structure',
	before(root, ctx) {
		const report = (message, node) => ctx.report({ message, node, severity: 'warning' });
		let children = groupRegions([...root.children], report);

		// Task bars: under each `## Task N` heading, or at the end of a one-task reading lesson.
		const rfe = ctx.data?.astro?.frontmatter?.rfe;
		if (rfe?.kind === 'lesson') {
			const key = `${rfe.chapterId}/${rfe.lessonId}`;
			const withBars = [];
			let seen = 0;
			for (const node of children) {
				withBars.push(node);
				if (node.type === 'heading' && node.depth === 2) {
					const m = TASK_HEADING.exec(ctx.textContent(node));
					if (m) {
						const index = Number(m[1]) - 1;
						withBars.push(html(taskBarHtml(key, index, rfe.tasks?.[index])));
						seen++;
					}
				}
			}
			if (seen === 0 && rfe.tasks?.length === 1) {
				withBars.push(html(
					`<div class="rfe-reading-task not-content"><p>${escapeHtml(rfe.tasks[0].title)}</p>${taskBarHtml(key, 0, rfe.tasks[0])}</div>`,
				));
			}
			children = withBars;
		}

		// Runner picker before the first runner-sensitive block.
		const first = children.findIndex(hasRunnerContent);
		if (first >= 0) children.splice(first, 0, html(runnerPickerHtml()));

		ctx.replaceNode(root, { type: 'root', children });
	},
};

// ---------------------------------------------------------------------------
// Pass 2: node-level transforms.

function isVariantWrapper(node) {
	return node?.data?.hProperties?.class === 'rfe-variant';
}

export const nodePlugin = {
	name: 'rfe-nodes',
	code(node, ctx) {
		const lang = (node.lang ?? '').trim();
		if (lang === 'terminal') return html(terminalHtml(node.value));
		if (lang === 'diagram') return html(diagramHtml(node.value));
		if (lang === 'youtube') return html(youtubeHtml(node.value));
		if (SHELL.has(lang) && isRunnerSensitive(node.value) && !isVariantWrapper(ctx.parent(node))) {
			return el(
				'div',
				{ class: 'rfe-runner-variants' },
				RUNNERS.map((r) =>
					el('div', { class: 'rfe-variant', 'data-runner': r, ...(r === 'uv' ? {} : { 'data-pagefind-ignore': '' }) }, [
						{ type: 'code', lang: node.lang, meta: node.meta, value: node.value.split('\n').map((l) => transformLine(l, r)).join('\n') },
					]),
				),
			);
		}
	},
	blockquote(node) {
		const [first, ...rest] = node.children;
		if (first?.type !== 'paragraph') return;
		const [label, ...inline] = first.children;
		if (label?.type !== 'strong' || label.children.length !== 1 || label.children[0].type !== 'text') return;
		const variant = CALLOUTS[label.children[0].value.trim()];
		if (!variant) return;
		const [head, ...tail] = inline;
		const body = head?.type === 'text' ? [text(head.value.replace(/^\s+/, '')), ...tail] : inline;
		const children = [
			...(variant === 'caution' ? [{ type: 'paragraph', data: { directiveLabel: true }, children: [text('Warning')] }] : []),
			...(body.length ? [{ type: 'paragraph', children: body }] : []),
			...rest,
		];
		return { type: 'containerDirective', name: variant, attributes: {}, children };
	},
	paragraph(node) {
		if (node.data?.hName) return;
		const [label, ...inline] = node.children;
		if (label?.type !== 'strong' || label.children.length !== 1 || label.children[0].type !== 'text') return;
		if (label.children[0].value.trim() !== 'Check:') return;
		const [head, ...tail] = inline;
		const body = head?.type === 'text' ? [text(head.value.replace(/^\s+/, '')), ...tail] : inline;
		return el('div', { class: 'rfe-done-when' }, [
			el('p', { class: 'rfe-done-when__label' }, [html(iconSvg('check')), text('Done when')]),
			{ type: 'paragraph', children: body },
		]);
	},
};

// ---------------------------------------------------------------------------

/** Astro integration registering the plugins on the Sätteri processor. List it before Starlight. */
export function rfeMarkdown() {
	return {
		name: 'rfe-markdown',
		hooks: {
			'astro:config:setup': ({ config }) => {
				const processor = config.markdown?.processor;
				if (processor?.name !== 'satteri' || !Array.isArray(processor.options?.mdastPlugins)) {
					throw new Error('rfe-markdown needs Astro’s default Sätteri Markdown processor (markdown.processor).');
				}
				const docsDir = fileURLToPath(new URL('src/content/docs/', config.root)).replace(/\\/g, '/');
				const onlyDocs = (plugin) => ({ fileURL }) =>
					fileURL && fileURLToPath(fileURL).replace(/\\/g, '/').startsWith(docsDir) ? plugin : null;
				processor.options.mdastPlugins.push(onlyDocs(structurePlugin), onlyDocs(nodePlugin));
			},
		},
	};
}
