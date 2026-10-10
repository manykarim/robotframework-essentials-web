// Browser storage of the learner's lab workspaces: IndexedDB, one record per lab with every
// file and the SHA-256 of the archive it started from. Every access is guarded, as in
// client/storage.ts: without IndexedDB (blocked storage, private windows) the store keeps the
// files in memory for the page view and says so.

const DB = 'rfe-labs';
const STORE = 'workspaces';

/**
 * @typedef {{ lab: string, archive: string, files: [string, string | Uint8Array][], saved: number }} SavedWorkspace
 */

function open(indexedDB) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'lab' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error('blocked'));
	});
}

function call(db, mode, run) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, mode);
		const request = run(tx.objectStore(STORE));
		tx.oncomplete = () => resolve(request?.result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/** The browser's IndexedDB; reading it throws where storage is blocked. */
function browserIndexedDB() {
	try {
		return globalThis.indexedDB;
	} catch {
		return undefined;
	}
}

export class WorkspaceStore {
	/** @param {IDBFactory | undefined} [indexedDB] */
	constructor(indexedDB = browserIndexedDB()) {
		/** @type {Map<string, SavedWorkspace>} */
		this.memory = new Map();
		/** @type {Promise<IDBDatabase | null>} */
		this.db = (async () => {
			try {
				if (!indexedDB) return null;
				return await open(indexedDB);
			} catch {
				return null;
			}
		})();
	}

	/** Whether edits survive a reload. */
	async persistent() {
		return (await this.db) !== null;
	}

	/** @returns {Promise<SavedWorkspace | null>} */
	async load(lab) {
		const db = await this.db;
		if (db) {
			try {
				return (await call(db, 'readonly', (s) => s.get(lab))) ?? null;
			} catch {
				// fall through to memory
			}
		}
		return this.memory.get(lab) ?? null;
	}

	/** @param {string} lab @param {string} archive @param {Map<string, string | Uint8Array>} files */
	async save(lab, archive, files) {
		const record = { lab, archive, files: [...files], saved: Date.now() };
		this.memory.set(lab, record);
		const db = await this.db;
		if (!db) return false;
		try {
			await call(db, 'readwrite', (s) => s.put(record));
			return true;
		} catch {
			return false;
		}
	}

	async remove(lab) {
		this.memory.delete(lab);
		const db = await this.db;
		if (!db) return;
		try {
			await call(db, 'readwrite', (s) => s.delete(lab));
		} catch {
			// nothing stored
		}
	}
}
