// RobotCode behind the bridge, under Node with the pinned packages: the gate for RobotCode
// upgrades. Covers open, full-text edits (as CodeMirror sends them), completion, hover,
// diagnostics after edits, and workspace files written while a suite is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLanguage } from './testing.mjs';

const ls = await startLanguage();
const ready = await ls.init('ch03-keywords-imports');
const root = ready.root;
const uri = `file://${root}/checks/imports.robot`;
const { labFiles } = await import('./testing.mjs');
const original = new TextDecoder().decode(labFiles('ch03-keywords-imports').find((f) => f.path === 'checks/imports.robot').data);
let version = 0;
const change = (text) => ls.send({ method: 'textDocument/didChange', params: { textDocument: { uri, version: ++version }, contentChanges: [{ text }] } });
const end = (text) => {
	const lines = text.split('\n');
	return { line: lines.length - 1, character: lines.at(-1).length };
};

test('initialize and open a suite', async () => {
	assert.equal(ready.available, true);
	const init = await ls.request('initialize', {
		processId: null,
		rootUri: `file://${root}`,
		workspaceFolders: [{ uri: `file://${root}`, name: 'lab' }],
		capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } }, hover: { contentFormat: ['markdown', 'plaintext'] } } },
	});
	assert.ok(init.capabilities.completionProvider && init.capabilities.hoverProvider);
	await ls.send({ method: 'initialized', params: {} });
	await ls.send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'robotframework', version, text: original } } });
	const diagnostics = await ls.diagnostics(uri);
	assert.deepEqual(diagnostics, [], 'the lab suite is clean');
});

test('a full-text change is applied: completion offers the lab’s own keyword', async () => {
	const text = `${original.trimEnd()}\n    Gre`;
	await change(text);
	const result = await ls.request('textDocument/completion', { textDocument: { uri }, position: end(text), context: { triggerKind: 1 } });
	const labels = (result.items ?? result).map((i) => i.label);
	assert.ok(labels.includes('Greet'), labels.slice(0, 20).join(', '));
});

test('hover on a keyword call shows its documentation', async () => {
	const text = `${original.trimEnd()}\n    Gre`;
	const lines = text.split('\n');
	const line = lines.findIndex((l) => /^\s+Greet\s/.test(l));
	const hover = await ls.request('textDocument/hover', { textDocument: { uri }, position: { line, character: lines[line].indexOf('Greet') + 2 } });
	const value = typeof hover.contents === 'string' ? hover.contents : (hover.contents.value ?? JSON.stringify(hover.contents));
	assert.match(value, /Greet/);
	assert.match(value, /common\.resource|Keyword|name/i, value);
});

test('an unknown keyword is the one diagnostic after the next edit', async () => {
	const from = ls.lsp.length;
	await change(`${original.trimEnd()}\n    No Such Keyword Here\n`);
	const diagnostics = await ls.diagnostics(uri, (d) => d.length > 0, from);
	assert.deepEqual(diagnostics.map((d) => [d.code, d.message]), [['KeywordNotFound', "No keyword with name 'No Such Keyword Here' found."]]);
	const fixed = ls.lsp.length;
	await change(original);
	assert.deepEqual(await ls.diagnostics(uri, () => true, fixed), [], 'the fixed error disappears');
});

test('a library the learner creates later is picked up', async () => {
	const suite = '*** Settings ***\nLibrary    ../libraries/CartMath.py\n\n*** Test Cases ***\nCart\n    Add Item    3\n';
	const cart = `file://${root}/checks/cart.robot`;
	const from = ls.lsp.length;
	await ls.server.onMessage({ type: 'write', path: 'checks/cart.robot', data: suite });
	await ls.send({ method: 'textDocument/didOpen', params: { textDocument: { uri: cart, languageId: 'robotframework', version: 0, text: suite } } });
	const missing = await ls.diagnostics(cart, (d) => d.length > 0, from);
	assert.ok(missing.some((d) => /CartMath\.py/.test(d.message)), JSON.stringify(missing));

	const created = ls.lsp.length;
	await ls.server.onMessage({ type: 'write', path: 'libraries/CartMath.py', data: 'class CartMath:\n    def add_item(self, price):\n        pass\n' });
	assert.deepEqual(await ls.diagnostics(cart, (d) => d.length === 0, created), []);

	const edited = ls.lsp.length;
	await ls.server.onMessage({ type: 'write', path: 'libraries/CartMath.py', data: 'class CartMath:\n    def add_price(self, price):\n        pass\n' });
	const stale = await ls.diagnostics(cart, (d) => d.length > 0, edited);
	assert.deepEqual(stale.map((d) => d.code), ['KeywordNotFound'], 'the edited library is read again');
});

test('a ch04 import conflict is flagged when the suite opens', async () => {
	const conflicts = await startLanguage();
	const r = await conflicts.init('ch04-variables-keywords--import-hierarchies-and-conflicts');
	await conflicts.request('initialize', { processId: null, rootUri: `file://${r.root}`, capabilities: {} });
	await conflicts.send({ method: 'initialized', params: {} });
	const { labFiles: files } = await import('./testing.mjs');
	const suites = files('ch04-variables-keywords--import-hierarchies-and-conflicts').filter((f) => f.path.startsWith('checks/') && f.path.endsWith('.robot'));
	for (const f of suites) {
		const u = `file://${r.root}/${f.path}`;
		await conflicts.send({ method: 'textDocument/didOpen', params: { textDocument: { uri: u, languageId: 'robotframework', version: 0, text: new TextDecoder().decode(f.data) } } });
	}
	const conflict = (d) => d.code === 'MultipleKeywords' && /Greet/.test(d.message);
	const published = () => conflicts.lsp.filter((m) => m.method === 'textDocument/publishDiagnostics').flatMap((m) => m.params.diagnostics);
	const t0 = Date.now();
	while (!published().some(conflict) && Date.now() - t0 < 15000) await new Promise((res) => setTimeout(res, 50));
	assert.ok(published().some(conflict), JSON.stringify(published().map((d) => [d.code, d.message])));
});

test('a RobotCode that fails to start reports that language features are unavailable', async () => {
	const { pythonSources } = await import('./testing.mjs');
	const broken = await startLanguage({ sources: { ...pythonSources(), 'rfe_bridge.py': 'raise ImportError("robotcode is broken")\n' } });
	const r = await broken.init('ch03-keywords-imports');
	assert.equal(r.available, false);
	assert.deepEqual(broken.messages.filter((m) => m.type === 'unavailable').map((m) => m.message), ['Language features are unavailable: ImportError: robotcode is broken']);
});
