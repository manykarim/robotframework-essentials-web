import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiagram } from './diagram-renderer.mjs';

test('a tree diagram renders to token-themed SVG', () => {
	const { svg, error } = renderDiagram(
		'tree "How .robot files and folders form suites"\n' +
			'node tests/ #folder -- directory suite {\n' +
			'  node login.robot #file -- file suite\n' +
			'}',
	);
	assert.equal(error, undefined);
	assert.match(svg, /^<svg/);
	assert.match(svg, /var\(--fc-/);
});

test('invalid source reports the offending line', () => {
	const { svg, error } = renderDiagram('tree "x"\nnode a {\n');
	assert.ok(!svg);
	assert.match(error, /line \d+/);
});
