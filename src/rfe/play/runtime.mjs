// Start-up of the browser runtime (Pyodide plus the pinned packages), shared by the runner
// and language workers and by the Node tests, which start it from the same staged files.

/** Folder of the staged runtime, relative to the site's base path. */
export const runtimeFolder = (lock) => `rfe-runtime/${lock.pyodide.version}/`;

/** Where wheels are unpacked: `/lib/python3.14/site-packages`. */
export const sitePackages = (lock) => `/lib/python${lock.pyodide.python.split('.').slice(0, 2).join('.')}/site-packages`;

/** Python files of the runtime's own modules, put on `sys.path` from `/rfe/`. */
export const MODULE_DIR = '/rfe';

/** Names and versions of the packages a group of the lock provides, for messages. */
export function describeGroup(lock, group, names) {
	return lock.files
		.filter((f) => f.groups.includes(group) && (!names || names.includes(f.name)))
		.map((f) => `${f.name} ${f.version}`)
		.join(', ');
}

/**
 * Load Pyodide and the lock groups it needs.
 * @param {{
 *   loadPyodide: (options: object) => Promise<any>,
 *   indexURL: string,
 *   lock: any,
 *   groups: string[],
 *   readBytes: (file: string) => Promise<Uint8Array>,
 *   status?: (step: 'python' | 'packages') => void,
 *   stdout?: (text: string) => void,
 * }} options
 */
export async function startPython({ loadPyodide, indexURL, lock, groups, readBytes, status = () => {}, stdout = () => {} }) {
	status('python');
	const py = await loadPyodide({ indexURL, fullStdLib: false, stdout, stderr: stdout, env: { HOME: '/home/pyodide' } });
	status('packages');
	const loaded = new Set();
	await addGroups(py, { lock, groups, readBytes, loaded });
	return { py, loaded };
}

/** Add the packages of more lock groups (files already loaded are skipped). */
export async function addGroups(py, { lock, groups, readBytes, loaded }) {
	const entries = lock.files.filter((f) => f.groups.some((g) => groups.includes(g)) && !loaded.has(f.file));
	const packages = entries.filter((f) => f.source === 'pyodide').map((f) => f.name);
	const wheels = entries.filter((f) => f.source === 'pypi');
	const errors = [];
	const [, bytes] = await Promise.all([
		packages.length ? py.loadPackage(packages, { messageCallback: () => {}, errorCallback: (e) => errors.push(e) }) : null,
		Promise.all(wheels.map((w) => readBytes(w.file))),
	]);
	if (errors.length) throw new Error(`loading ${packages.join(', ')} failed: ${errors.join('; ')}`);
	for (const data of bytes) py.unpackArchive(data, 'wheel', { extractDir: sitePackages(lock) });
	for (const f of entries) loaded.add(f.file);
	py.runPython('import importlib; importlib.invalidate_caches()');
}

/**
 * Write the runtime's Python modules to `/rfe/` and put it on `sys.path`.
 * @param {Record<string, string>} sources  file name -> source text
 */
export function installModules(py, sources) {
	py.FS.mkdirTree(MODULE_DIR);
	for (const [name, text] of Object.entries(sources)) py.FS.writeFile(`${MODULE_DIR}/${name}`, text);
	py.runPython(`import sys, importlib\nif '${MODULE_DIR}' not in sys.path: sys.path.insert(0, '${MODULE_DIR}')\nimportlib.invalidate_caches()`);
}

/**
 * A workspace-relative path with `/` separators, or an error for paths that leave it.
 * @param {string} rel
 */
export function workspacePath(rel) {
	const parts = [];
	for (const part of String(rel).replace(/\\/g, '/').split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') throw new Error(`path leaves the workspace: ${rel}`);
		parts.push(part);
	}
	if (!parts.length || /^[a-zA-Z]:$/.test(parts[0])) throw new Error(`invalid workspace path: ${rel}`);
	return parts.join('/');
}
