// Run controls on lesson code blocks (marked at build time by the Markdown pipeline, see
// src/rfe/play/blocks.mjs): "Run in browser" runs a self-contained block in place, "Open in
// browser lab" takes a lab step to the lesson's browser lab. Nothing of the runtime loads
// until a Run button is pressed; the inline runner is a separate chunk.
import { handoverUrl } from '../play/handover.mjs';

const base = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** The block's code as written in the lesson (Expressive Code renders one `.ec-line` per line). */
export function blockCode(block: HTMLElement) {
	const lines = [...block.querySelectorAll('.ec-line')].map((line) => line.textContent ?? '');
	return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function initRunControls() {
	const blocks = document.querySelectorAll<HTMLElement>('[data-rfe-run]');
	for (const block of blocks) {
		const { rfeRun: kind, lab = '', file = '' } = block.dataset;
		const run = document.createElement('div');
		run.className = 'rfe-run not-content';
		run.dataset.pagefindIgnore = '';
		const bar = document.createElement('div');
		bar.className = 'rfe-run__bar';
		run.append(bar);
		if (kind === 'lab') {
			const link = document.createElement('a');
			link.className = 'rfe-run__button';
			link.href = handoverUrl(base, lab, [{ path: file, text: blockCode(block) }]);
			link.target = '_blank';
			link.rel = 'noopener';
			link.textContent = '▶\uFE0E Open in browser lab';
			link.title = `Opens the browser lab with this suite as ${file}`;
			bar.append(link);
		} else {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'rfe-run__button';
			button.textContent = '▶\uFE0E Run in browser';
			button.addEventListener('click', async () => {
				button.disabled = true;
				try {
					const { runInline } = await import('../play/inline');
					await runInline({ block, run, base, lab, file, code: blockCode(block) });
				} finally {
					button.disabled = false;
				}
			});
			bar.append(button);
		}
		block.after(run);
	}
}
