// Terminal of the browser lab: xterm.js with a small line editor (history, cursor keys,
// Ctrl+C, Ctrl+L) in front of the runner's shell. Tab is left to the browser, so the
// keyboard can move on from the terminal.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHooks {
	onCommand: (line: string) => void;
	onInterrupt: () => void;
	/** A `file://` link in the output (Robot Framework's Output/Log/Report lines). */
	onLink: (uri: string) => void;
}

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function courseTheme(): ITheme {
	const dark = document.documentElement.dataset.theme !== 'light';
	return {
		background: css('--rfe-play-terminal-bg', dark ? '#17181c' : '#f6f7f9'),
		foreground: css('--sl-color-white', dark ? '#ffffff' : '#17181c'),
		cursor: css('--sl-color-white', dark ? '#ffffff' : '#17181c'),
		selectionBackground: css('--rfe-play-selection', '#7aa2f766'),
		red: css('--sl-color-red', '#d14'),
		green: css('--sl-color-green', '#2e8540'),
		yellow: css('--sl-color-orange', '#b26a00'),
		blue: css('--sl-color-blue', '#2f6fdb'),
		cyan: css('--sl-color-text-accent', '#0b7a75'),
		brightBlack: css('--sl-color-gray-3', '#8a8f98'),
	};
}

export class LabTerminal {
	private term: Terminal;
	private fit = new FitAddon();
	private line = '';
	private cursor = 0;
	private history: string[] = [];
	private historyAt = 0;
	/** Whether a prompt is on screen (output then keeps it below itself). */
	private prompting = false;
	busy = false;

	constructor(parent: HTMLElement, private prompt: () => string, private hooks: TerminalHooks) {
		this.term = new Terminal({
			convertEol: true,
			cursorBlink: true,
			fontFamily: css('--rfe-mono', 'ui-monospace, monospace'),
			fontSize: 13,
			scrollback: 5000,
			theme: courseTheme(),
			linkHandler: {
				allowNonHttpProtocols: true,
				activate: (_event, uri) => (uri.startsWith('file://') ? hooks.onLink(uri) : window.open(uri, '_blank', 'noopener')),
			},
		});
		this.term.loadAddon(this.fit);
		this.term.open(parent);
		this.term.textarea?.setAttribute('aria-label', 'Terminal: type a command, Enter runs it');
		this.term.attachCustomKeyEventHandler((event) => event.key !== 'Tab');
		this.term.onData((data) => this.input(data));
		new ResizeObserver(() => this.resize()).observe(parent);
		new MutationObserver(() => (this.term.options.theme = courseTheme())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		this.resize();
	}

	get cols() {
		return this.term.cols;
	}

	resize() {
		try {
			this.fit.fit();
		} catch {
			// not visible yet
		}
	}

	write(text: string) {
		this.term.write(text);
	}

	/** Output with the prompt (and what is typed on it) kept below it. */
	notice(text: string) {
		const typing = this.prompting && !this.busy;
		if (typing) this.term.write('\r\x1b[2K');
		this.term.write(text.endsWith('\n') ? text : `${text}\r\n`);
		if (typing) this.redraw();
	}

	showPrompt() {
		this.line = '';
		this.cursor = 0;
		this.prompting = true;
		this.term.write(this.prompt());
	}

	/** Type and run a command as if the learner had entered it. */
	run(line: string) {
		this.prompting = false;
		this.term.write(`\r\x1b[2K${this.prompt()}${line}\r\n`);
		this.line = '';
		this.cursor = 0;
		this.remember(line);
		this.hooks.onCommand(line);
	}

	clear() {
		this.term.clear();
	}

	focus() {
		this.term.focus();
	}

	/** Visible and scrolled-back text, for checks. */
	text() {
		const buffer = this.term.buffer.active;
		const lines = [];
		for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
		return lines.join('\n').trimEnd();
	}

	private remember(line: string) {
		if (line.trim() && this.history.at(-1) !== line) this.history.push(line);
		this.historyAt = this.history.length;
	}

	private redraw() {
		this.term.write(`\r\x1b[2K${this.prompt()}${this.line}`);
		const back = this.line.length - this.cursor;
		if (back > 0) this.term.write(`\x1b[${back}D`);
	}

	private input(data: string) {
		if (data === '\x03') {
			if (this.busy) this.hooks.onInterrupt();
			else {
				this.term.write('^C\r\n');
				this.showPrompt();
			}
			return;
		}
		if (data === '\x0c') {
			this.term.clear();
			if (!this.busy) this.redraw();
			return;
		}
		if (this.busy || !this.prompting) return;
		if (data === '\r') {
			this.prompting = false;
			const line = this.line;
			this.term.write('\r\n');
			this.line = '';
			this.cursor = 0;
			if (line.trim()) {
				this.remember(line);
				this.hooks.onCommand(line);
			} else this.showPrompt();
			return;
		}
		if (data === '\x7f' || data === '\b') {
			if (this.cursor > 0) {
				this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
				this.cursor--;
				this.redraw();
			}
			return;
		}
		if (data === '\x1b[A' || data === '\x1b[B') {
			if (!this.history.length) return;
			this.historyAt = Math.max(0, Math.min(this.history.length, this.historyAt + (data === '\x1b[A' ? -1 : 1)));
			this.line = this.history[this.historyAt] ?? '';
			this.cursor = this.line.length;
			this.redraw();
			return;
		}
		if (data === '\x1b[D' || data === '\x1b[C') {
			this.cursor = Math.max(0, Math.min(this.line.length, this.cursor + (data === '\x1b[D' ? -1 : 1)));
			this.redraw();
			return;
		}
		if (data === '\x1b[H' || data === '\x01') {
			this.cursor = 0;
			this.redraw();
			return;
		}
		if (data === '\x1b[F' || data === '\x05') {
			this.cursor = this.line.length;
			this.redraw();
			return;
		}
		if (data.startsWith('\x1b')) return;
		// Typed or pasted text: printable characters of the first line.
		const text = data.split(/\r?\n|\r/)[0].replace(/[\x00-\x1f\x7f]/g, '');
		if (!text) return;
		this.line = this.line.slice(0, this.cursor) + text + this.line.slice(this.cursor);
		this.cursor += text.length;
		this.redraw();
	}
}
