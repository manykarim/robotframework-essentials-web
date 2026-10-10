// Browser-local course state. Every access is guarded: with storage blocked, values live in
// memory for the current page view, so pages keep working and simply remember nothing.
const PREFIX = 'rfe:v1:';
const memory = new Map<string, string>();

function getItem(key: string): string | null {
	try {
		return localStorage.getItem(PREFIX + key);
	} catch {
		return memory.get(key) ?? null;
	}
}

function setItem(key: string, value: string): void {
	try {
		localStorage.setItem(PREFIX + key, value);
	} catch {
		memory.set(key, value);
	}
}

export function readJson<T>(key: string, fallback: T): T {
	const raw = getItem(key);
	if (raw === null) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function writeJson(key: string, value: unknown): void {
	setItem(key, JSON.stringify(value));
}

/** Raw string values (the runner, which the inline head script reads before paint). */
export const readRaw = getItem;
export const writeRaw = setItem;

/** Remove every stored course value (quiz answers, task ticks, runner). */
export function clearAll(): void {
	memory.clear();
	try {
		for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
	} catch {
		// Storage blocked: only the in-memory values existed.
	}
}

/** Map of `<chapterId>/<lessonId>#<taskIndex>` -> true for ticked tasks. */
export const readTasks = () => readJson<Record<string, boolean>>('tasks', {});
/** Map of `<chapterId>/<lessonId>#<questionIndex>` -> first picked option. */
export const readQuiz = () => readJson<Record<string, number>>('quiz', {});

export const PROGRESS_EVENT = 'rfe:progress';
export const notifyProgress = () => window.dispatchEvent(new CustomEvent(PROGRESS_EVENT));
