import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineMarkdown } from './inline.mjs';

test('escapes HTML and renders code and strong spans', () => {
	assert.equal(inlineMarkdown('`Test Template    <Keyword>` in **Settings** & more'), '<code>Test Template    &lt;Keyword&gt;</code> in <strong>Settings</strong> &amp; more');
	assert.equal(inlineMarkdown('`**not bold**`'), '<code>**not bold**</code>');
});
