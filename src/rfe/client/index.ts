// Client behavior for the lesson dialect and the Robot Framework Essentials pages.
// Loaded once per page by the MarkdownContent override; every part is a no-op when
// its markup is absent.
import { initDiagrams } from './diagram';
import { initGlossary, initLabs, initLadders, initProgress, initQuizzes, initTasks, initVideos } from './learning';
import { initRunControls } from './run-controls';
import { initRunner } from './runner';
import { initTerminals } from './terminal';

for (const init of [initRunner, initLabs, initLadders, initVideos, initDiagrams, initTerminals, initTasks, initQuizzes, initProgress, initGlossary, initRunControls]) {
	try {
		init();
	} catch (error) {
		console.error('[rfe]', error);
	}
}
