// Console output to HTML, for inline runs on lesson pages (the playground uses xterm.js):
// SGR colours, bold and dim become classes; a carriage return rewrites its line, as Robot
// Framework does when it replaces a test's progress marker with its status; OSC 8 links
// keep their text; other escapes are dropped.

const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

/** @param {string} text */
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A line after its carriage returns: the last segment written, or the one before a trailing `\r`. */
function rewriteLine(line) {
	const segments = line.split('\r');
	for (let i = segments.length - 1; i >= 0; i--) if (segments[i] !== '') return segments[i];
	return '';
}

/**
 * @param {string} text  console output with ANSI escapes
 * @returns {string} HTML for a `<pre>`
 */
export function ansiToHtml(text) {
	const lines = text
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map(rewriteLine)
		.join('\n');
	let html = '';
	let open = false;
	/** @type {{ fg: string | null, bold: boolean, dim: boolean }} */
	const style = { fg: null, bold: false, dim: false };
	const span = () => {
		const classes = [style.fg && `rfe-ansi-${style.fg}`, style.bold && 'rfe-ansi-bold', style.dim && 'rfe-ansi-dim'].filter(Boolean);
		html += (open ? '</span>' : '') + (classes.length ? `<span class="${classes.join(' ')}">` : '');
		open = classes.length > 0;
	};
	let last = 0;
	for (const m of lines.matchAll(/\x1b\[([0-9;]*)([A-Za-z])|\x1b[^[]/g)) {
		html += escapeHtml(lines.slice(last, m.index));
		last = m.index + m[0].length;
		if (m[2] !== 'm') continue;
		const codes = (m[1] || '0').split(';').map(Number);
		for (let i = 0; i < codes.length; i++) {
			const c = codes[i];
			if (c === 0) Object.assign(style, { fg: null, bold: false, dim: false });
			else if (c === 1) style.bold = true;
			else if (c === 2) style.dim = true;
			else if (c === 22) style.bold = style.dim = false;
			else if (c >= 30 && c <= 37) style.fg = COLORS[c - 30];
			else if (c >= 90 && c <= 97) style.fg = COLORS[c - 90];
			else if (c === 39) style.fg = null;
			else if (c === 38 || c === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
		}
		span();
	}
	html += escapeHtml(lines.slice(last));
	return html + (open ? '</span>' : '');
}
