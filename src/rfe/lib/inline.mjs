// Inline Markdown for short manifest strings (quiz text, key-term notes): HTML-escaped,
// with `code` and **strong** spans. Nothing else is interpreted.

/** @param {string} text */
export function inlineMarkdown(text) {
	const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	return escaped
		.split(/(`[^`]+`)/g)
		.map((part) => (/^`[^`]+`$/.test(part) ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')))
		.join('');
}
