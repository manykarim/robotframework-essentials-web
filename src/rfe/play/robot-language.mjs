// Robot Framework highlighting for the browser lab's editor: a CodeMirror stream parser.
// (@codemirror/lsp-client doesn't use semantic tokens, so highlighting is done here.)
// It reads cells separated by two or more spaces, a tab, or ` | `, and classifies sections,
// test and keyword names, keyword calls, control words, settings, variables, arguments,
// comments and continuation lines.
import { tags as t } from '@lezer/highlight';

const SECTION = /^\*+\s*(settings?|variables?|test cases?|tasks?|keywords?|comments?)\b.*$/i;
const CONTROL = /^(FOR|END|IF|ELSE IF|ELSE|WHILE|TRY|EXCEPT|FINALLY|RETURN|BREAK|CONTINUE|VAR|GROUP|IN|IN RANGE|IN ENUMERATE|IN ZIP|AND)$/;
/** Control words after which the next cell is a keyword call again. */
const CONTROL_THEN_KEYWORD = /^(END|ELSE|TRY|FINALLY|BREAK|CONTINUE)$/;
/** Settings whose value is a keyword call. */
const KEYWORD_SETTING = /^(Suite Setup|Suite Teardown|Test Setup|Test Teardown|Task Setup|Task Teardown|Test Template|Task Template|Setup|Teardown|Template)$/i;
const ASSIGN = /^[$@&]\{[^}]*\}(\[[^\]]*\])*\s?=?$/;
const SEPARATOR = /^( {2,}|\t+| \| |\s+$)/;
const SECTION_NAMES = { setting: 'setting', variable: 'variable', 'test case': 'test', task: 'test', keyword: 'keyword', comment: 'comment' };

/**
 * @typedef {{ section: string, cell: number, role: string | null, keyword: boolean, indented: boolean, setting: string, continued: string | null, lineRole: string | null }} RobotState
 */

function sectionOf(line) {
	const m = SECTION.exec(line.trim());
	if (!m) return null;
	return SECTION_NAMES[m[1].toLowerCase().replace(/s$/, '')] ?? 'comment';
}

/** Role of the cell that starts at the stream position. */
function cellRole(s, text) {
	const first = s.cell === 0;
	if (text.startsWith('#')) return 'comment';
	if (text === '...' && (first || s.cell === 1)) return 'continuation';
	if (s.section === 'setting') {
		if (first) {
			s.setting = text;
			return 'setting';
		}
		return KEYWORD_SETTING.test(s.setting) && !s.keyword ? ((s.keyword = true), 'kw') : 'arg';
	}
	if (s.section === 'variable') return first && !s.indented ? 'vardef' : 'arg';
	if (s.section === 'test' || s.section === 'keyword') {
		if (first && !s.indented) return 'def';
		if (/^\[[^\]]+\]$/.test(text)) {
			s.keyword = !KEYWORD_SETTING.test(text.slice(1, -1));
			return 'meta';
		}
		if (!s.keyword && CONTROL.test(text)) {
			if (!CONTROL_THEN_KEYWORD.test(text)) s.keyword = true;
			return 'control';
		}
		if (s.keyword && CONTROL.test(text) && /^(IN|IN RANGE|IN ENUMERATE|IN ZIP|AND)$/.test(text)) return 'control';
		if (!s.keyword && ASSIGN.test(text)) return 'assign';
		if (!s.keyword) {
			s.keyword = true;
			return 'kw';
		}
		return 'arg';
	}
	return 'arg';
}

const STYLE = {
	def: 'definition',
	kw: 'function',
	control: 'keyword',
	meta: 'meta',
	setting: 'keyword',
	arg: 'string',
	assign: 'variableName.special',
	vardef: 'variableName.definition',
	continuation: 'operator',
	comment: 'comment',
};

/** The stream parser for `StreamLanguage.define`. */
export const robotStreamParser = {
	name: 'robotframework',
	/** @returns {RobotState} */
	startState: () => ({ section: '', cell: -1, role: null, keyword: false, indented: false, setting: '', continued: null, lineRole: null }),
	copyState: (s) => ({ ...s }),
	/**
	 * @param {import('@codemirror/language').StringStream} stream
	 * @param {RobotState} s
	 */
	token(stream, s) {
		if (stream.sol()) {
			const section = sectionOf(stream.string);
			if (section) {
				s.section = section;
				stream.skipToEnd();
				return 'heading';
			}
			// A continuation line keeps the previous line's keyword state.
			const continues = /^\s*\.\.\.(\s|$)/.test(stream.string);
			if (!continues) {
				s.keyword = false;
				s.setting = '';
			}
			s.cell = -1;
			s.role = null;
			s.indented = /^\s/.test(stream.string);
		}
		if (s.section === 'comment' || s.section === '') {
			stream.skipToEnd();
			return 'comment';
		}
		if (stream.match(SEPARATOR)) {
			s.role = null;
			return null;
		}
		if (stream.sol() && s.indented) {
			stream.eatSpace();
			s.role = null;
			return null;
		}
		if (s.role === null) {
			s.cell++;
			const rest = stream.string.slice(stream.pos);
			const text = rest.split(/ {2,}|\t| \| /)[0].trimEnd();
			s.role = cellRole(s, text);
			if (s.role === 'comment') {
				stream.skipToEnd();
				return 'comment';
			}
			if (s.role === 'continuation') {
				stream.pos += 3;
				s.role = null;
				if (s.section === 'test' || s.section === 'keyword') s.cell = Math.max(s.cell, 1);
				return 'operator';
			}
		}
		if (stream.match(/^[$@&%]\{/)) {
			let depth = 1;
			while (depth && !stream.eol()) {
				const ch = stream.next();
				if (ch === '{') depth++;
				else if (ch === '}') depth--;
			}
			stream.match(/^(\[[^\]]*\])*/);
			if (s.role === 'assign' || s.role === 'vardef') stream.match(/^\s?=/);
			return s.role === 'vardef' ? 'variableName.definition' : 'variableName.special';
		}
		while (!stream.eol()) {
			if (stream.match(SEPARATOR, false) || stream.match(/^[$@&%]\{/, false)) break;
			if (!stream.match(/^\\./)) stream.next();
		}
		return STYLE[s.role] ?? null;
	},
	tokenTable: {
		function: t.function(t.variableName),
		definition: t.definition(t.variableName),
		'variableName.special': t.special(t.variableName),
		'variableName.definition': t.definition(t.variableName),
	},
	languageData: { commentTokens: { line: '#' } },
};
