// Animated terminal demos: type each input line, then reveal its output.
// Port of the Fieldcraft framework's webview/src/terminal-demo.ts (MIT, see
// ../vendor/NOTICE.md), adapted to runner variants: the visible variant is typed.
// The full transcript is in the HTML, so without JS or under reduced motion it stands as is.
const TYPE_MS = 26;
const LINE_MS = 320;
const OUT_MS = 110;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The element holding the command text currently shown (a visible runner variant, or the span). */
function typedTarget(cmd: HTMLElement): HTMLElement {
	const variants = [...cmd.querySelectorAll<HTMLElement>('.rfe-variant')];
	return variants.find((v) => v.offsetParent !== null || getComputedStyle(v).display !== 'none') ?? cmd;
}

export function initTerminals(): void {
	const timers = new WeakMap<HTMLElement, number[]>();
	const cancel = (demo: HTMLElement) => {
		for (const id of timers.get(demo) ?? []) window.clearTimeout(id);
		timers.set(demo, []);
		demo.classList.remove('is-playing');
		for (const t of demo.querySelectorAll<HTMLElement>('[data-full]')) t.textContent = t.dataset.full ?? '';
	};
	const later = (demo: HTMLElement, fn: () => void, ms: number) => timers.get(demo)?.push(window.setTimeout(fn, ms));

	const play = (demo: HTMLElement) => {
		if (reduceMotion()) return;
		cancel(demo);
		const lines = [...demo.querySelectorAll<HTMLElement>('.rfe-terminal__line')];
		demo.classList.add('is-playing');
		for (const line of lines) line.classList.remove('is-shown');
		const step = (index: number) => {
			const line = lines[index];
			if (!line) {
				demo.classList.remove('is-playing');
				return;
			}
			line.classList.add('is-shown');
			const cmd = line.querySelector<HTMLElement>('.rfe-terminal__cmd');
			if (!cmd) {
				later(demo, () => step(index + 1), OUT_MS);
				return;
			}
			const target = typedTarget(cmd);
			const full = (target.dataset.full ??= target.textContent ?? '');
			const type = (n: number) => {
				target.textContent = full.slice(0, n);
				if (n < full.length) later(demo, () => type(n + 1), TYPE_MS);
				else later(demo, () => step(index + 1), LINE_MS);
			};
			type(0);
		};
		step(0);
	};

	const demos = [...document.querySelectorAll<HTMLElement>('[data-rfe-terminal]')];
	if (!demos.length || reduceMotion()) return;
	for (const demo of demos) {
		timers.set(demo, []);
		const replay = demo.querySelector<HTMLButtonElement>('.rfe-terminal__replay');
		if (replay) {
			replay.hidden = false;
			replay.setAttribute('aria-label', 'Replay terminal demo');
			replay.addEventListener('click', () => play(demo));
		}
	}
	if (!('IntersectionObserver' in window)) return;
	const observer = new IntersectionObserver(
		(entries, obs) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					play(entry.target as HTMLElement);
					obs.unobserve(entry.target);
				}
			}
		},
		{ threshold: 0.4 },
	);
	for (const demo of demos) observer.observe(demo);
}
