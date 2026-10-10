// Editor of the browser lab: CodeMirror 6 with Robot Framework and Python highlighting in
// the course theme, and RobotCode's language features through @codemirror/lsp-client.
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { python } from '@codemirror/legacy-modes/mode/python';
import { lintKeymap } from '@codemirror/lint';
import { LSPClient, type Transport, Workspace, type WorkspaceFile, LSPPlugin, languageServerExtensions } from '@codemirror/lsp-client';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state';
import {
	EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import DOMPurify from 'dompurify';
import { robotStreamParser } from './robot-language.mjs';

const robotLanguage = StreamLanguage.define(robotStreamParser as any);
const pythonLanguage = StreamLanguage.define(python);

/** Token colours come from the course theme (play.css), so light and dark follow Starlight. */
const highlight = HighlightStyle.define([
	{ tag: t.heading, class: 'rfe-tok-heading' },
	{ tag: [t.definition(t.variableName), t.function(t.definition(t.variableName))], class: 'rfe-tok-definition' },
	{ tag: t.function(t.variableName), class: 'rfe-tok-call' },
	{ tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: 'rfe-tok-keyword' },
	{ tag: [t.special(t.variableName), t.self], class: 'rfe-tok-variable' },
	{ tag: t.meta, class: 'rfe-tok-meta' },
	{ tag: [t.string, t.special(t.string)], class: 'rfe-tok-string' },
	{ tag: [t.number, t.bool, t.null, t.atom], class: 'rfe-tok-number' },
	{ tag: t.comment, class: 'rfe-tok-comment' },
	{ tag: [t.operator, t.punctuation], class: 'rfe-tok-operator' },
	{ tag: [t.className, t.typeName], class: 'rfe-tok-type' },
	{ tag: t.propertyName, class: 'rfe-tok-property' },
]);

export const isRobotFile = (path: string) => /\.(robot|resource)$/i.test(path);
export const isTextFile = (path: string) => !/\.(png|jpe?g|gif|webp|ico|zip|db|sqlite3?|pdf|woff2?)$/i.test(path);

function languageFor(path: string): Extension {
	if (isRobotFile(path)) return robotLanguage;
	if (/\.py$/i.test(path)) return pythonLanguage;
	return [];
}

const theme = EditorView.theme({
	'&': { height: '100%', fontSize: '0.875rem', backgroundColor: 'var(--rfe-play-editor-bg)', color: 'var(--sl-color-white)' },
	'.cm-scroller': { fontFamily: 'var(--rfe-mono)', lineHeight: '1.55' },
	'.cm-content': { caretColor: 'var(--sl-color-white)' },
	'.cm-gutters': { backgroundColor: 'var(--rfe-play-editor-bg)', color: 'var(--sl-color-gray-3)', borderRight: '1px solid var(--sl-color-hairline)' },
	'.cm-activeLine': { backgroundColor: 'var(--rfe-play-active-line)' },
	'.cm-activeLineGutter': { backgroundColor: 'var(--rfe-play-active-line)', color: 'var(--sl-color-white)' },
	'&.cm-focused': { outline: '2px solid var(--sl-color-accent)', outlineOffset: '-2px' },
	'&.cm-focused .cm-cursor': { borderLeftColor: 'var(--sl-color-white)' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--rfe-play-selection) !important' },
	'.cm-tooltip': { backgroundColor: 'var(--sl-color-bg-nav)', color: 'var(--sl-color-white)', border: '1px solid var(--sl-color-gray-5)', borderRadius: '0.35rem', maxWidth: 'min(36rem, 90vw)' },
	'.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--sl-color-accent)', color: 'var(--sl-color-black)' },
	'.cm-lsp-documentation': { fontFamily: 'var(--sl-font)', fontSize: '0.85rem' },
	'.cm-lsp-documentation pre, .cm-lsp-documentation code': { fontFamily: 'var(--rfe-mono)' },
	'.cm-diagnostic-error': { borderLeftColor: 'var(--sl-color-red)' },
	'.cm-diagnostic-warning': { borderLeftColor: 'var(--sl-color-orange)' },
});

export interface EditorHooks {
	onChange: (text: string) => void;
	onRun: () => void;
}

/** Everything but the language: one set, reused for every file. */
function baseExtensions(path: string, hooks: EditorHooks, readOnly: boolean): Extension[] {
	return [
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightSpecialChars(),
		history(),
		drawSelection(),
		dropCursor(),
		indentOnInput(),
		bracketMatching(),
		closeBrackets(),
		autocompletion(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		EditorState.tabSize.of(4),
		indentUnit.of('    '),
		EditorView.lineWrapping,
		EditorState.readOnly.of(readOnly),
		EditorView.contentAttributes.of({ 'aria-label': `${readOnly ? 'Contents of' : 'Edit'} ${path}` }),
		keymap.of([
			{ key: 'Mod-Enter', run: () => (hooks.onRun(), true) },
			// Tab indents; Escape then Tab (or Shift+Tab) moves focus out of the editor.
			indentWithTab,
			...closeBracketsKeymap,
			...defaultKeymap,
			...searchKeymap,
			...historyKeymap,
			...completionKeymap,
			...lintKeymap,
		]),
		theme,
		syntaxHighlighting(highlight),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) hooks.onChange(update.state.doc.toString());
		}),
	];
}

/** Workspace for the LSP client that can show other files (go to definition). */
class LabWorkspace extends Workspace {
	files: WorkspaceFile[] = [];
	private versions: Record<string, number> = Object.create(null);

	constructor(client: LSPClient, private display: (uri: string) => Promise<EditorView | null>) {
		super(client);
	}

	private nextVersion(uri: string) {
		this.versions[uri] = (this.versions[uri] ?? -1) + 1;
		return this.versions[uri];
	}

	syncFiles() {
		const result = [];
		for (const file of this.files) {
			const view = file.getView();
			const plugin = view && LSPPlugin.get(view);
			if (!plugin || !view) continue;
			const changes = plugin.unsyncedChanges;
			if (!changes.empty) {
				result.push({ changes, file, prevDoc: file.doc });
				(file as { doc: Text }).doc = view.state.doc;
				(file as { version: number }).version = this.nextVersion(file.uri);
				plugin.clear();
			}
		}
		return result;
	}

	openFile(uri: string, languageId: string, view: EditorView) {
		if (this.getFile(uri)) this.closeFile(uri);
		const file: WorkspaceFile = { uri, languageId, version: this.nextVersion(uri), doc: view.state.doc, getView: () => view };
		this.files.push(file);
		this.client.didOpen(file);
	}

	closeFile(uri: string) {
		const file = this.getFile(uri);
		if (!file) return;
		this.files = this.files.filter((f) => f !== file);
		this.client.didClose(uri);
	}

	displayFile(uri: string) {
		return this.display(uri);
	}
}

export interface LanguageConnection {
	transport: Transport;
	rootUri: string;
	display: (uri: string) => Promise<EditorView | null>;
}

/**
 * One editor view for the whole workspace: switching files swaps its state, and each file
 * keeps its own undo history while the page is open.
 */
export class LabEditor {
	view: EditorView;
	path = '';
	private states = new Map<string, EditorState>();
	private lsp = new Compartment();
	private client: LSPClient | null = null;
	private rootUri = '';

	constructor(parent: HTMLElement, private hooks: EditorHooks) {
		this.view = new EditorView({ parent, state: EditorState.create({ doc: '' }) });
	}

	/** Connect RobotCode; open Robot Framework files get language features from now on. */
	connect({ transport, rootUri, display }: LanguageConnection) {
		this.rootUri = rootUri;
		this.client = new LSPClient({
			rootUri,
			timeout: 20000,
			sanitizeHTML: (html) => DOMPurify.sanitize(html),
			extensions: languageServerExtensions(),
			workspace: (client) => new LabWorkspace(client, display),
		}).connect(transport);
		if (isRobotFile(this.path)) this.view.dispatch({ effects: this.lsp.reconfigure(this.lspFor(this.path)) });
	}

	disconnect() {
		this.client?.disconnect();
		this.client = null;
		this.view.dispatch({ effects: this.lsp.reconfigure([]) });
	}

	private lspFor(path: string): Extension {
		return this.client && isRobotFile(path) ? this.client.plugin(`${this.rootUri}/${path}`, 'robotframework') : [];
	}

	/** Show a file; `text` is used the first time it is opened (or when `replace` is set). */
	open(path: string, text: string, { readOnly = false, replace = false } = {}) {
		if (this.path) {
			// Close the file for the language server before putting its state aside.
			this.view.dispatch({ effects: this.lsp.reconfigure([]) });
			this.states.set(this.path, this.view.state);
		}
		let state = replace ? undefined : this.states.get(path);
		if (!state) {
			state = EditorState.create({
				doc: text,
				extensions: [baseExtensions(path, this.hooks, readOnly), languageFor(path), this.lsp.of([])],
			});
		}
		this.path = path;
		this.view.setState(state);
		this.view.dispatch({ effects: this.lsp.reconfigure(this.lspFor(path)) });
	}

	/** Replace an open or remembered file's text (a command changed it on disk). */
	setText(path: string, text: string) {
		if (path === this.path) {
			if (this.view.state.doc.toString() !== text) this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
		} else this.states.delete(path);
	}

	/** Drop a file's (or folder's) remembered editor state, including the open one's. */
	forget(path: string) {
		this.states.delete(path);
		for (const key of [...this.states.keys()]) if (key.startsWith(`${path}/`)) this.states.delete(key);
		if (this.path === path || this.path.startsWith(`${path}/`)) this.path = '';
	}

	text() {
		return this.view.state.doc.toString();
	}

	focus() {
		this.view.focus();
	}
}
