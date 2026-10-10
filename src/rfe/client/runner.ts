// "Run with" picker: uv (default), venv, poetry. The choice is one attribute on <html>
// (`data-rfe-runner`), which CSS uses to show the matching command variants, and it
// persists across pages. The inline head script applies it before first paint.
import { readRaw, writeRaw } from './storage';

export const RUNNERS = ['uv', 'venv', 'poetry'] as const;
export type Runner = (typeof RUNNERS)[number];
export const RUNNER_EVENT = 'rfe:runner';

const isRunner = (value: unknown): value is Runner => RUNNERS.includes(value as Runner);

export function currentRunner(): Runner {
	const value = document.documentElement.dataset.rfeRunner;
	return isRunner(value) ? value : 'uv';
}

function paintPickers(runner: Runner): void {
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-rfe-runner-picker] [data-runner]')) {
		const active = button.dataset.runner === runner;
		button.setAttribute('aria-checked', String(active));
		button.tabIndex = active ? 0 : -1;
	}
}

export function setRunner(runner: Runner): void {
	document.documentElement.dataset.rfeRunner = runner;
	writeRaw('runner', runner);
	paintPickers(runner);
	window.dispatchEvent(new CustomEvent(RUNNER_EVENT, { detail: runner }));
}

export function initRunner(): void {
	const stored = readRaw('runner');
	if (isRunner(stored)) document.documentElement.dataset.rfeRunner = stored;
	for (const picker of document.querySelectorAll<HTMLElement>('[data-rfe-runner-picker]')) {
		picker.hidden = false;
		const buttons = [...picker.querySelectorAll<HTMLButtonElement>('[data-runner]')];
		for (const button of buttons) {
			button.addEventListener('click', () => {
				if (isRunner(button.dataset.runner)) setRunner(button.dataset.runner);
			});
			// Radio-group keyboard behavior: arrows move and select.
			button.addEventListener('keydown', (event) => {
				const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
				if (!step) return;
				event.preventDefault();
				const next = buttons[(buttons.indexOf(button) + step + buttons.length) % buttons.length];
				if (next && isRunner(next.dataset.runner)) {
					setRunner(next.dataset.runner);
					next.focus();
				}
			});
		}
	}
	paintPickers(currentRunner());
}
