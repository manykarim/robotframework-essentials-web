// Line-style glyphs on a 24x24 grid, stroked in currentColor.
// Ported from the Fieldcraft framework's webview/src/icons.ts (MIT, see ../vendor/NOTICE.md).

/** @type {Record<string, string>} */
const ICON_PATHS = {
  // ── Callouts ──────────────────────────────────────────────────────
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h0"/>',
  lightbulb:
    '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10c.7.7 1 1.4 1 2h6c0-.6.3-1.3 1-2a6 6 0 0 0-4-10z"/>',
  warning: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v5"/><path d="M12 18h0"/>',

  // ── Task kinds (edit | run | read | quiz) + default check ─────────
  edit: '<path d="M4 20h4L18 10l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
  run: '<path d="M8 5l11 7-11 7V5z"/>',
  read: '<path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2V5z"/><path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2V5z"/>',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><path d="M12 17h0"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',

  // ── Chapter waypoints ─────────────────────────────────────────────
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  braces:
    '<path d="M8 4a2 2 0 0 0-2 2v3l-2 3 2 3v3a2 2 0 0 0 2 2"/><path d="M16 4a2 2 0 0 1 2 2v3l2 3-2 3v3a2 2 0 0 1-2 2"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  settings:
    '<path d="M4 6h8"/><path d="M18 6h2"/><circle cx="15" cy="6" r="2.4"/><path d="M4 12h4"/><path d="M14 12h6"/><circle cx="11" cy="12" r="2.4"/><path d="M4 18h8"/><path d="M18 18h2"/><circle cx="15" cy="18" r="2.4"/>',
  branch: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6"/><path d="M18 10.2a6 6 0 0 1-6 6H6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18"/><path d="M12 3c-3 3-3 15 0 18"/>',
  plug: '<path d="M9 3v5"/><path d="M15 3v5"/><path d="M7 8h10v3a5 5 0 0 1-10 0V8z"/><path d="M12 16v5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  text: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6 6-2z"/>',
  summit: '<path d="M3 20h18L14 7l-3 5-2-3-6 11z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12h0"/>',
  package: '<path d="M12 3l8 4v10l-8 4-8-4V7l8-4z"/><path d="M4 7l8 4 8-4"/><path d="M12 11v10"/>',
};

/** @param {string | undefined | null} name */
export function hasIcon(name) {
	return typeof name === 'string' && name in ICON_PATHS;
}

/**
 * Inline `<svg>` markup for a glyph, or '' when the name is unknown.
 * @param {string} name
 * @param {string} [className]
 */
export function iconSvg(name, className = 'rfe-icon') {
	const inner = ICON_PATHS[name];
	if (!inner) return '';
	return (
		`<svg class="${className}" viewBox="0 0 24 24" width="1em" height="1em"` +
		' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
		` stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
	);
}
