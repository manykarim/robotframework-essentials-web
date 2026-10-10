// Hint ladders, video thumbnails, task ticks, quizzes, progress summaries, the glossary
// filter, and lab one-liners. All progressive enhancement over server-rendered HTML.
// The hint ladder and quiz follow the Fieldcraft framework's HintLadder.tsx and Quiz.tsx
// (MIT, see ../vendor/NOTICE.md).
import { PROGRESS_EVENT, clearAll, notifyProgress, readQuiz, readTasks, writeJson } from './storage';

// --- Hint ladders ------------------------------------------------------------

export function initLadders(): void {
	for (const ladder of document.querySelectorAll<HTMLElement>('[data-rfe-ladder]')) {
		const hints = [...ladder.querySelectorAll<HTMLDetailsElement>(':scope > .rfe-ladder__hint')];
		const solution = ladder.querySelector<HTMLDetailsElement>(':scope > .rfe-ladder__solution');
		const rungs = solution ? [...hints, solution] : hints;
		if (!rungs.length) continue;
		let revealed = 0;
		for (const rung of rungs) rung.hidden = true;

		const controls = document.createElement('div');
		controls.className = 'rfe-ladder__controls';
		const next = document.createElement('button');
		next.type = 'button';
		next.className = 'rfe-ladder__next';
		const skip = document.createElement('button');
		skip.type = 'button';
		skip.className = 'rfe-ladder__skip';
		skip.textContent = 'Show the solution';
		controls.append(next, skip);
		ladder.prepend(controls);

		const paint = () => {
			rungs.forEach((rung, i) => {
				const shown = i < revealed;
				if (shown && rung.hidden) {
					rung.hidden = false;
					rung.open = true;
				}
			});
			if (revealed < hints.length) {
				next.textContent = `Show hint ${revealed + 1} of ${hints.length}`;
				next.hidden = false;
			} else if (solution && revealed < rungs.length) {
				next.textContent = 'Show the solution';
				next.hidden = false;
			} else next.hidden = true;
			skip.hidden = !solution || revealed >= hints.length;
			controls.hidden = next.hidden && skip.hidden;
		};
		next.addEventListener('click', () => {
			revealed = Math.min(revealed + 1, rungs.length);
			paint();
			rungs[revealed - 1]?.querySelector('summary')?.focus();
		});
		skip.addEventListener('click', () => {
			revealed = rungs.length;
			paint();
			solution?.querySelector('summary')?.focus();
		});
		paint();
	}
}

// --- Video thumbnails --------------------------------------------------------

export function initVideos(): void {
	const fallback = (img: HTMLImageElement) => {
		const card = img.closest<HTMLElement>('.rfe-video');
		const placeholder = card?.querySelector<HTMLElement>('.rfe-video__fallback');
		if (!card || !placeholder) return;
		img.hidden = true;
		placeholder.hidden = false;
		card.classList.add('is-unavailable');
	};
	for (const img of document.querySelectorAll<HTMLImageElement>('.rfe-video__thumbnail')) {
		if (img.complete && img.naturalWidth === 0) fallback(img);
		img.addEventListener('error', () => fallback(img));
	}
}

// --- Task ticks --------------------------------------------------------------

export function initTasks(): void {
	const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-rfe-task] .rfe-task-done')];
	const paint = () => {
		const done = readTasks();
		for (const b of buttons) {
			const key = b.closest<HTMLElement>('[data-rfe-task]')?.dataset.rfeTask ?? '';
			const on = Boolean(done[key]);
			b.setAttribute('aria-pressed', String(on));
			b.classList.toggle('is-done', on);
			const label = b.querySelector('.rfe-task-done__label');
			if (label) label.textContent = on ? 'Done' : 'Mark done';
		}
	};
	for (const b of buttons) {
		b.hidden = false;
		b.addEventListener('click', () => {
			const key = b.closest<HTMLElement>('[data-rfe-task]')?.dataset.rfeTask;
			if (!key) return;
			const done = readTasks();
			if (done[key]) delete done[key];
			else done[key] = true;
			writeJson('tasks', done);
			notifyProgress();
		});
	}
	paint();
	window.addEventListener(PROGRESS_EVENT, paint);
}

// --- Quizzes -----------------------------------------------------------------

export function initQuizzes(): void {
	for (const quiz of document.querySelectorAll<HTMLElement>('[data-rfe-quiz]')) {
		const lesson = quiz.dataset.rfeQuiz ?? '';
		for (const q of quiz.querySelectorAll<HTMLElement>('.rfe-quiz__question')) {
			const index = q.dataset.index ?? '0';
			const answer = Number(q.dataset.answer);
			const options = [...q.querySelectorAll<HTMLButtonElement>('.rfe-quiz__option')];
			const feedback = q.querySelector<HTMLElement>('.rfe-quiz__feedback');
			const verdict = q.querySelector<HTMLElement>('.rfe-quiz__verdict');
			const reveal = q.querySelector<HTMLElement>('.rfe-quiz__reveal');
			if (reveal) reveal.hidden = true;
			let picked: number | undefined;

			const show = (choice: number) => {
				picked = choice;
				options.forEach((o, i) => {
					o.disabled = true;
					o.classList.toggle('is-correct', i === answer);
					o.classList.toggle('is-incorrect', i === choice && i !== answer);
					o.setAttribute('aria-pressed', String(i === choice));
				});
				if (feedback && verdict) {
					const right = choice === answer;
					feedback.classList.toggle('is-correct', right);
					feedback.classList.toggle('is-incorrect', !right);
					verdict.textContent = right ? 'Correct — ' : 'Not quite — ';
					feedback.hidden = false;
				}
			};
			const key = `${lesson}#${index}`;
			options.forEach((o, i) => {
				o.disabled = false;
				o.addEventListener('click', () => {
					if (picked !== undefined) return;
					const answers = readQuiz();
					answers[key] ??= i;
					writeJson('quiz', answers);
					show(i);
					notifyProgress();
				});
			});
			const saved = readQuiz()[key];
			if (typeof saved === 'number') show(saved);
		}
	}
}

// --- Progress (part pages, landing) ------------------------------------------

type LessonState = 'done' | 'started' | 'new';
const STATE_LABELS: Record<LessonState, string> = { done: 'Done', started: 'In progress', new: 'Not started' };

function lessonState(key: string, tasks: number, done: Record<string, boolean>, quiz: Record<string, number>): LessonState {
	let ticked = 0;
	for (let i = 0; i < tasks; i++) if (done[`${key}#${i}`]) ticked++;
	if (tasks > 0 && ticked === tasks) return 'done';
	const answered = Object.keys(quiz).some((k) => k.startsWith(`${key}#`));
	return ticked > 0 || answered ? 'started' : 'new';
}

export function initProgress(): void {
	const paint = () => {
		const done = readTasks();
		const quiz = readQuiz();
		for (const el of document.querySelectorAll<HTMLElement>('[data-rfe-lesson-state]')) {
			const state = lessonState(el.dataset.lesson ?? '', Number(el.dataset.tasks ?? 0), done, quiz);
			el.dataset.state = state;
			el.title = STATE_LABELS[state];
			const label = el.querySelector('.sr-only');
			if (label) label.textContent = STATE_LABELS[state];
		}
		for (const summary of document.querySelectorAll<HTMLElement>('[data-rfe-progress]')) {
			const lessons = (summary.dataset.lessons ?? '').split(' ').filter(Boolean);
			const finished = lessons.filter((entry) => {
				const [key, tasks] = entry.split('|');
				return lessonState(key ?? '', Number(tasks ?? 0), done, quiz) === 'done';
			}).length;
			const bar = summary.querySelector<HTMLElement>('.rfe-progress__bar > span');
			const text = summary.querySelector<HTMLElement>('.rfe-progress__text');
			if (bar) bar.style.width = `${lessons.length ? (finished / lessons.length) * 100 : 0}%`;
			if (text) text.textContent = `${finished} of ${lessons.length} lessons done`;
			summary.hidden = false;
		}
	};
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-rfe-reset]')) {
		button.hidden = false;
		button.addEventListener('click', () => {
			if (!window.confirm('Reset your course progress? This clears ticked tasks, quiz answers and your runner choice in this browser.')) return;
			clearAll();
			delete document.documentElement.dataset.rfeRunner;
			window.location.reload();
		});
	}
	paint();
	window.addEventListener(PROGRESS_EVENT, paint);
}

// --- Glossary filter -----------------------------------------------------------

export function initGlossary(): void {
	for (const glossary of document.querySelectorAll<HTMLElement>('[data-rfe-glossary]')) {
		const filters = [...glossary.querySelectorAll<HTMLButtonElement>('[data-filter]')];
		const entries = [...glossary.querySelectorAll<HTMLElement>('[data-kind]')];
		const count = glossary.querySelector<HTMLElement>('.rfe-glossary__count');
		const toolbar = glossary.querySelector<HTMLElement>('.rfe-glossary__filters');
		if (toolbar) toolbar.hidden = false;
		const apply = (kind: string) => {
			let shown = 0;
			for (const entry of entries) {
				const visible = kind === 'all' || entry.dataset.kind === kind;
				entry.hidden = !visible;
				if (visible) shown++;
			}
			for (const f of filters) f.setAttribute('aria-pressed', String(f.dataset.filter === kind));
			if (count) count.textContent = `${shown} term${shown === 1 ? '' : 's'}`;
		};
		for (const f of filters) f.addEventListener('click', () => apply(f.dataset.filter ?? 'all'));
		apply('all');
	}
}

// --- Lab one-liners: point them at the site this page is served from -----------------

export function initLabs(): void {
	for (const lab of document.querySelectorAll<HTMLElement>('[data-rfe-lab]')) {
		const from = lab.dataset.siteOrigin;
		const to = window.location.origin;
		if (!from || from === to) continue;
		const walker = document.createTreeWalker(lab, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to);
		}
		for (const el of lab.querySelectorAll<HTMLElement>('[data-code]')) {
			const code = el.dataset.code;
			if (code?.includes(from)) el.dataset.code = code.split(from).join(to);
		}
	}
}
