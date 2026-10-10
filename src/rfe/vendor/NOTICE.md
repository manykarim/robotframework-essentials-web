# Third-party code in this folder

These files are vendored (copied in) rather than installed from a package registry.
Re-vendor them by hand from the sources below, and update the versions here.

| File | Source | Version | License |
| --- | --- | --- | --- |
| `robotframework.tmLanguage.json` | RobotCode VS Code extension (`d-biehl.robotcode`), `syntaxes/robotframework.tmLanguage.json` - https://github.com/robotcodedev/robotcode | 2.7.0 | Apache-2.0, see `LICENSE.robotcode.txt` |
| `diagram-renderer.mjs` | Fieldcraft framework, `webview/src/diagram-renderer.ts` - https://github.com/manykarim/fieldcraft (transpiled to JavaScript, unmodified otherwise) | commit `c2b53ba` | MIT, see `LICENSE.fieldcraft.txt` |

Parts of `src/rfe/lib/` and `src/rfe/client/` are ports of Fieldcraft modules
(`runner.ts`, `markdown.ts`, `terminal-demo.ts`, `diagram-view.ts`, `HintLadder.tsx`,
`Quiz.tsx`) and carry a header saying so. They are MIT-licensed, see `LICENSE.fieldcraft.txt`.
