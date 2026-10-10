// Lab downloads: one .zip per chapter lab and lesson lab, plus the whole-course starter
// kit, built from the imported sources in labs/.
import type { APIRoute, GetStaticPaths } from 'astro';
import { course } from '../../rfe/course';
import { STARTER_KIT, labArchive } from '../../rfe/lib/labs.mjs';

export const getStaticPaths = (() =>
	[...Object.keys(course.labs), STARTER_KIT].map((lab) => ({ params: { lab } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params, site }) => {
	const zip = labArchive(course, String(params.lab), { site, root: process.cwd() });
	return new Response(new Uint8Array(zip), {
		headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${params.lab}.zip"` },
	});
};
