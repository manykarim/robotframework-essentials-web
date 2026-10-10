// Diagram viewer: step-through for `@`-step diagrams, and an expanded view with zoom and
// pan, offered only when a diagram overflows its column. Inline diagrams never capture the
// wheel, so scrolling over them scrolls the page.
// Port of the Fieldcraft framework's webview/src/diagram-view.ts (MIT, see ../vendor/NOTICE.md).
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const STEP_MS = 1100;
const OVERFLOW_TOLERANCE = 1.02;

function button(label: string, cls: string, title: string): HTMLButtonElement {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = `rfe-diagram__btn ${cls}`;
	b.textContent = label;
	b.title = title;
	b.setAttribute('aria-label', title);
	return b;
}

function enhance(fig: HTMLElement): void {
	const stage = fig.querySelector<HTMLElement>('.rfe-diagram__stage');
	const svg = stage?.querySelector<SVGSVGElement>('svg');
	if (!stage || !svg) return;
	const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
	const bar = document.createElement('div');
	bar.className = 'rfe-diagram__controls';

	// Step-through: button-driven, inline.
	const stepEls = [...svg.querySelectorAll<SVGElement>('.fc-step[data-step]')];
	let stopSteps: (() => void) | undefined;
	if (fig.dataset.steps === 'true' && stepEls.length) {
		const stepNums = [...new Set(stepEls.map((el) => Number(el.dataset.step)))].sort((a, b) => a - b);
		const total = stepNums.length;
		let cur = 0;
		let timer: number | undefined;
		const play = button('▶', 'rfe-diagram__play', 'Play the steps');
		const prev = button('‹', 'rfe-diagram__prev', 'Previous step');
		const next = button('›', 'rfe-diagram__next', 'Next step');
		const counter = document.createElement('span');
		counter.className = 'rfe-diagram__counter';
		counter.setAttribute('aria-live', 'polite');
		const paint = () => {
			for (const el of stepEls) {
				const n = Number(el.dataset.step);
				const at = stepNums[cur - 1] ?? 0;
				el.dataset.state = cur === 0 ? '' : n < at ? 'done' : n === at ? 'active' : 'pending';
			}
			counter.textContent = cur === 0 ? `${total} steps` : `Step ${cur} of ${total}`;
			prev.disabled = cur <= 1;
			next.disabled = cur >= total;
		};
		const stop = () => {
			if (timer !== undefined) window.clearTimeout(timer);
			timer = undefined;
			play.textContent = '▶';
			play.setAttribute('aria-label', 'Play the steps');
		};
		const go = (n: number) => {
			cur = Math.max(0, Math.min(total, n));
			paint();
		};
		const tick = () => {
			if (cur >= total) return stop();
			go(cur + 1);
			if (timer !== undefined) timer = window.setTimeout(tick, STEP_MS);
		};
		play.addEventListener('click', () => {
			if (timer !== undefined) return stop();
			if (cur >= total) go(0);
			play.textContent = '❙❙';
			play.setAttribute('aria-label', 'Pause the steps');
			go(cur + 1);
			if (cur < total) timer = window.setTimeout(tick, STEP_MS);
		});
		prev.addEventListener('click', () => {
			stop();
			go(cur - 1);
		});
		next.addEventListener('click', () => {
			stop();
			go(cur === 0 ? 1 : cur + 1);
		});
		const steps = document.createElement('div');
		steps.className = 'rfe-diagram__steps';
		if (!reduce) steps.append(play);
		steps.append(prev, next, counter);
		bar.append(steps);
		paint();
		stopSteps = stop;
	}

	// Zoom and pan, bound only while expanded.
	let scale = 1;
	let tx = 0;
	let ty = 0;
	svg.style.transformOrigin = '0 0';
	const apply = () => {
		svg.style.transform = scale === 1 && tx === 0 && ty === 0 ? '' : `translate(${tx}px, ${ty}px) scale(${scale})`;
	};
	const reset = () => {
		scale = 1;
		tx = 0;
		ty = 0;
		apply();
	};
	const zoomTo = (value: number, cx: number, cy: number) => {
		const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
		tx = cx - ((cx - tx) * s) / scale;
		ty = cy - ((cy - ty) * s) / scale;
		scale = s;
		apply();
	};
	const centre = (): [number, number] => {
		const r = stage.getBoundingClientRect();
		return [r.width / 2, r.height / 2];
	};
	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const r = stage.getBoundingClientRect();
		zoomTo(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
	};
	let dragging = false;
	let px = 0;
	let py = 0;
	const onDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		dragging = true;
		px = e.clientX;
		py = e.clientY;
		stage.setPointerCapture(e.pointerId);
		stage.classList.add('is-grabbing');
	};
	const onMove = (e: PointerEvent) => {
		if (!dragging) return;
		tx += e.clientX - px;
		ty += e.clientY - py;
		px = e.clientX;
		py = e.clientY;
		apply();
	};
	const onUp = () => {
		dragging = false;
		stage.classList.remove('is-grabbing');
	};
	const zoomIn = button('+', 'rfe-diagram__zoom-in', 'Zoom in');
	const zoomOut = button('−', 'rfe-diagram__zoom-out', 'Zoom out');
	const resetBtn = button('↺', 'rfe-diagram__reset', 'Reset view');
	zoomIn.addEventListener('click', () => zoomTo(scale * 1.2, ...centre()));
	zoomOut.addEventListener('click', () => zoomTo(scale / 1.2, ...centre()));
	resetBtn.addEventListener('click', reset);
	const zoomTools = document.createElement('span');
	zoomTools.className = 'rfe-diagram__zoomtools';
	zoomTools.append(zoomOut, zoomIn, resetBtn);
	zoomTools.hidden = true;

	const enterZoom = () => {
		reset();
		zoomTools.hidden = false;
		stage.addEventListener('wheel', onWheel, { passive: false });
		stage.addEventListener('pointerdown', onDown);
		stage.addEventListener('pointermove', onMove);
		stage.addEventListener('pointerup', onUp);
		stage.addEventListener('pointercancel', onUp);
	};
	const exitZoom = () => {
		zoomTools.hidden = true;
		stage.removeEventListener('wheel', onWheel);
		stage.removeEventListener('pointerdown', onDown);
		stage.removeEventListener('pointermove', onMove);
		stage.removeEventListener('pointerup', onUp);
		stage.removeEventListener('pointercancel', onUp);
		reset();
	};
	const expand = button('⛶', 'rfe-diagram__expand', 'Expand to zoom');
	expand.addEventListener('click', () => {
		if (document.fullscreenElement === fig) {
			void document.exitFullscreen?.();
			return;
		}
		if (fig.classList.contains('is-modal')) {
			fig.classList.remove('is-modal');
			exitZoom();
			return;
		}
		const modal = () => {
			fig.classList.add('is-modal');
			enterZoom();
		};
		if (fig.requestFullscreen) fig.requestFullscreen().catch(modal);
		else modal();
	});
	document.addEventListener('fullscreenchange', () => {
		const full = document.fullscreenElement === fig;
		fig.classList.toggle('is-fullscreen', full);
		if (full) enterZoom();
		else if (!fig.classList.contains('is-modal')) exitZoom();
		updateOverflow();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && fig.classList.contains('is-modal')) {
			fig.classList.remove('is-modal');
			exitZoom();
			updateOverflow();
		}
	});

	const vbWidth = svg.viewBox?.baseVal?.width || Number(svg.getAttribute('width')) || 0;
	const updateOverflow = () => {
		const avail = stage.clientWidth - 16;
		const overflows = vbWidth > 0 && avail > 0 && vbWidth > avail * OVERFLOW_TOLERANCE;
		expand.hidden = !overflows && document.fullscreenElement !== fig && !fig.classList.contains('is-modal');
		bar.hidden = expand.hidden && !stepEls.length;
	};
	bar.append(zoomTools, expand);
	fig.append(bar);
	updateOverflow();
	if ('ResizeObserver' in window) new ResizeObserver(updateOverflow).observe(stage);
	window.addEventListener('pagehide', () => stopSteps?.());
}

export function initDiagrams(): void {
	for (const fig of document.querySelectorAll<HTMLElement>('[data-rfe-diagram]')) enhance(fig);
}
