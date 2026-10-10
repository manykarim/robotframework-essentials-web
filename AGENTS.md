# AGENTS.md - robotframework-essentials-web

Guide for humans and AI agents maintaining this repository: the web edition of the
Robot Framework Essentials course, a static Astro Starlight site on GitHub Pages.

## At a glance

| What | Where |
| --- | --- |
| Published site | https://manykarim.github.io/robotframework-essentials-web/ |
| Repository | https://github.com/manykarim/robotframework-essentials-web (branch `main`) |
| Generator | [Astro Starlight](https://starlight.astro.build/) - Markdown, static output in `dist/` |
| Site URL and base path | `site.config.mjs` (`SITE`, `BASE`), used by Astro and the importer |
| Course source | `rf-training-platform` (`courses/rf-tutorial`), a separate repository checked out next to this one |
| Deployment | `.github/workflows/deploy.yml`: checks on every pull request and push, deploy on `main` |

## This repository is public

Everything in it - files, commit messages, branch names, the repository description - is
public. Don't add internal or employer-specific details such as hostnames, registries,
project, team or pipeline names. The maintainer's machine runs a pre-push check for this.
npm packages come from the public registry; `.npmrc` pins `https://registry.npmjs.org/`.

## Paths

| Path | What | Edit? |
| --- | --- | --- |
| `src/content/docs/` | Every page: landing (`index.md`), part pages, lessons, glossary | **Generated** - never by hand |
| `src/rfe/generated/course.json` | Course order, sidebar, labs, glossary, provenance | **Generated** |
| `labs/` | Lab sources (byte-identical seed stages of the course source) | **Generated** |
| `src/rfe/overrides/<chapter>/<lesson>.md` / `.json` | Web-edition lesson body / title, tasks, quiz, key terms | Yes |
| `src/rfe/rewrites.json` | Checked text replacements `{ scope, find, replace }` | Yes |
| `src/rfe/templates/` | Landing, part and glossary page text | Yes |
| `src/rfe/markdown/`, `src/rfe/components/`, `src/rfe/client/`, `src/rfe/styles/` | Rendering, components, browser scripts, styles | Yes |
| `src/rfe/vendor/` | Third-party code, see `NOTICE.md` there | Re-vendor only |
| `src/pages/labs/[lab].zip.ts` | Builds the lab `.zip` downloads | Yes |
| `src/pages/labs/[lab]/index.astro`, `src/pages/labs/rfe-results-sw.js.ts` | Browser lab pages and the results service worker | Yes |
| `src/rfe/play/` | Browser lab: workers, Python modules (`python/`), editor, terminal, inline runs, tests | Yes |
| `src/rfe/play/runtime.lock.json` | Pinned browser runtime files (versions, URLs, SHA-256) | Via `scripts/rfe-runtime.mjs --refresh` |
| `src/rfe/play/expected-failures.json` | Lesson blocks that fail by design | Yes |
| `astro.config.mjs` | Starlight setup; the sidebar is built from `course.json` | Yes |

The importer replaces everything in the generated paths. A page added by hand under
`src/content/docs/` is deleted by the next import.

## Validating locally

```sh
npm ci                 # Node 22 or newer
npm run dev            # http://localhost:4321/robotframework-essentials-web/
                       # (agents: `npx astro dev --background`; manage with
                       #  `npx astro dev status|logs|stop`)
npm run test:ci        # astro check + production build + link validation + test:rfe
npm run preview        # production build at http://localhost:4321/robotframework-essentials-web/
sh scripts/smoke.sh http://localhost:4321/robotframework-essentials-web   # must all be "ok"
```

`npm run test:ci` is what the workflow runs. `test:rfe` is Node's built-in test runner over
`src/rfe/**/*.test.mjs` and `scripts/**/*.test.mjs`. Broken internal links fail the build
(`starlight-links-validator`); links are absolute and include the base path.

`dev`, `build` and `test:ci` first run `node scripts/rfe-runtime.mjs` (also `npm run runtime`),
which stages the browser lab's runtime; the first run downloads about 18 MB. The browser lab
tests start Pyodide under Node from the staged files, so they need it: run `npm run runtime`
before `npm run test:rfe` on its own. They add about a minute to `test:ci`.

## Re-import a new course version

```sh
git -C ../rf-training-platform pull            # or check out the version to import
node scripts/rfe-import.mjs ../rf-training-platform
npm run test:ci
```

The importer prints counts, the hits of every rewrite rule, and how many files changed. It
fails - and changes nothing - when:

- the course is missing, or a lesson file is missing;
- an override targets a removed lesson;
- a rewrite rule no longer matches (the source was reworded: review it and update
  `src/rfe/rewrites.json`);
- a lesson contains an unknown `<!-- marker -->`, or an invalid `diagram` or `youtube` block;
- an override uses an unknown placeholder.

Running it twice without source changes produces no diff. Commit the generated files with the
change. The workflow never needs the course source: it builds from the committed files.

Web-only wording belongs in overrides (whole lesson) or rewrite rules (a phrase), never in the
generated pages. Templates and override bodies write internal links as `{{base}}/...`; the
importer replaces `{{base}}` with `BASE` from `site.config.mjs` (a `${{expression}}` in Robot
Framework code is left alone). After changing `BASE`, re-import.

## Lesson Markdown dialect

Every page understands these plain-Markdown constructs; the course is written in them.

### Terminal demos

A ` ```terminal ` fence shows a command running. Lines starting with `$ ` are typed input,
every other line is output. The demo plays once when it scrolls into view and has a
**Replay** button; with reduced motion it shows the whole transcript at once.

````md
```terminal
$ robot --version
Robot Framework 7.4.2 (Python 3.13 on linux)
```
````

For a command readers should run themselves, use a ` ```bash ` fence: it gets a **Copy** button.

### Diagrams

A ` ```diagram ` fence is rendered to an inline SVG at build time and follows the light/dark
theme.

- The first line names the type - `tree`, `stack`, `sequence`, `pipeline` or `hub` - with an
  optional title.
- Each further line is one element. A `-- sublabel` adds a second line, and `{ … }` nests
  elements.
- Modifiers such as `:accent`, `:muted`, `:dashed`, and glyphs such as `#folder` and `#file`,
  style the elements.

````md
```diagram
pipeline "From a suite to its report"
step "write" -- tests.robot
step "run" :accent -- robot
step "report" :pass -- log.html
```
````

In a `sequence` diagram, steps marked with `@` get **Play**, **Previous** and **Next**
controls. A diagram wider than the column offers an expanded view with zoom and pan. Invalid
source fails the import, naming the line.

### Video cards

A ` ```youtube ` fence shows a card that opens the video on YouTube in a new tab; nothing is
embedded. All four fields are required, each once.

````md
```youtube
id: r5hN3oFvbfY
title: Robot Framework tutorial Episode 1 — Introduction
duration: 1:21
summary: Why Robot Framework is generic, extensible, open source, and useful beyond test automation.
```
````

### Callouts and checks

A blockquote whose first word is `**Note:**`, `**Tip:**` or `**Warning:**` becomes a callout,
like Starlight's `:::note`, `:::tip` and `:::caution` asides:

```md
> **Tip:** Run the suite again after every change.
```

A paragraph starting with `**Check:**` becomes a **Done when** box, for the result a reader
verifies after a task. `## Task N — Title` headings get the lesson's task bars.

### Worked examples and hint ladders

Wrap an example in `<!-- example -->` … `<!-- /example -->` to label it as something to
adapt, not copy. Consecutive `<!-- hint -->` blocks and a final `<!-- solution -->` block form
a hint ladder: readers reveal one hint at a time, and the solution last. Without JavaScript,
each hint is a collapsed section. Solutions are left out of the site search.

```md
<!-- hint -->
Start from the template keyword's arguments.
<!-- /hint -->
<!-- solution -->
The full answer.
<!-- /solution -->
```

### Commands for uv, venv and poetry

` ```bash ` blocks containing `uv run …`, `uv add …` or `uv sync` get a **Run with** picker:
readers choose uv, venv or poetry, and every such command shows (and copies) in their
runner's form. Sections that differ more are wrapped in `<!-- runner:uv -->`,
`<!-- runner:venv -->` or `<!-- runner:poetry -->` … `<!-- /runner -->`; only the selected
runner's section is shown.

## Browser lab

Labs without the Browser library also open in the browser, at `/labs/<lab-id>/`, linked from
the lab card ("Open in browser", after the download). Lesson code blocks get Run controls:
"Run in browser" for self-contained Robot Framework blocks, "Open in browser lab" for lab steps
that import a file the learner creates. Everything is served from the site; nothing runs until
a learner opens a browser lab or presses Run.

How it fits together:

- **Two Pyodide workers.** `runner.worker.ts` (`runner-core.mjs`) runs Robot Framework, the
  terminal's shell and the in-browser substitutes; `language.worker.ts` (`language-core.mjs`)
  runs RobotCode. Stop terminates only the runner and restarts it with the page's files.
- **Python modules** in `src/rfe/play/python/`: the shell (`rfe_shell.py`: lesson commands for
  uv, poetry, venv and `python -m`, setup commands, messages for what needs a real machine),
  the demo shop answered in-process (`rfe_demo_shop.py`; other hosts are refused), the Process
  substitute (`rfe_process.py`: `python` commands only), cooperative timeouts
  (`rfe_timeouts.py`), workspace helpers and the RobotCode bridge (`rfe_bridge.py`).
- **The RobotCode bridge is pinned to RobotCode 2.7.0.** It patches RobotCode internals (no
  threads or subprocesses in Pyodide) and turns CodeMirror's full-text changes into range
  edits. `bridge.test.mjs` is the gate for RobotCode upgrades.
- **Run controls are decided at build time** by `src/rfe/play/blocks.mjs`, from the lesson
  source: no control for Browser-library blocks and blocks without tests; "lab" for blocks
  importing a file the lab doesn't ship (named by the lesson text, such as "Create
  `checks/cart.robot`"); "inline" otherwise. The Markdown pipeline marks the fences, and
  `client/run-controls.ts` adds the buttons; the inline runner loads on the first click.
- **Results** (`log.html`, `report.html`, `output.xml`) are stored in Cache Storage and served by
  `/labs/rfe-results-sw.js` under `/labs/_results/` with a `Content-Security-Policy: sandbox`
  header, so result pages can't touch the course's storage. Rollback: deploy a version that
  calls `self.registration.unregister()`.

### Runtime files and upgrades

`src/rfe/play/runtime.lock.json` pins every runtime file with its URL and SHA-256: the Pyodide
core files (from the exact `pyodide` npm version), Pyodide's builds of some packages
(`cdn.jsdelivr.net/pyodide/v<version>/full/`), and wheels from `files.pythonhosted.org`.
`scripts/rfe-runtime.mjs` fetches missing files into `.rfe-runtime-cache/`, verifies every hash
(a mismatch fails the build and names the file) and stages them in
`public/rfe-runtime/<pyodide-version>/`. CI caches the download folder by the lock's hash.

- **Upgrade a Python package:** change its `version` in the lock, run
  `node scripts/rfe-runtime.mjs --refresh` (re-resolves file names, URLs, hashes and sizes),
  then `npm run test:ci`. Robot Framework, RequestsLibrary, pythonlibcore and Robocop must
  equal the labs' `requirements.txt` pins; `scripts/rfe-runtime.test.mjs` fails and names both
  versions otherwise.
- **Upgrade Pyodide:** `npm install --save-exact pyodide@<version>`, then `--refresh` (Pyodide
  packages take the versions that release ships), then `npm run test:ci`. The staged folder name
  follows the version, so browsers don't mix versions.
- **Upgrade RobotCode:** change the RobotCode versions in the lock and `ROBOTCODE_VERSION` in
  `rfe_bridge.py`, refresh, and fix the bridge until `bridge.test.mjs` passes.
- **Add a package:** add `{ "name", "version", "source": "pypi" | "pyodide", "license", "groups" }`
  (groups: `core` for both workers, `language`, or `robocop`, which loads on first use), refresh,
  and list it in `NOTICE` (`notice.test.mjs` checks).

### Lesson blocks and expected failures

`lesson-blocks.test.mjs` runs every block with a Run control in the browser runtime: inline
blocks in a fresh copy of their lab, lab steps with their lesson's solution files. Each must
pass, except the blocks in `src/rfe/play/expected-failures.json` (`lesson`, 1-based `block`
number among the lesson's Robot Framework blocks, and a part of the expected failure
message), whose lessons show a failure. After a re-import, a failing block is named with its
lesson; fix it with an override, a rewrite rule or an update to that list.

## Deployment

```text
push to main
  -> .github/workflows/deploy.yml: npm ci --ignore-scripts, npm run test:ci, upload dist/
  -> deploy job (environment github-pages) -> live in a few minutes
```

- Pull requests run the same checks without deploying.
- Re-run a deployment from the Actions tab or with `gh workflow run deploy.yml`.
- GitHub Pages caches files for up to 10 minutes, so a new lab `.zip` can take that long to
  appear.
- After a deployment, run `sh scripts/smoke.sh https://manykarim.github.io/robotframework-essentials-web`.

## Vendored code

`src/rfe/vendor/NOTICE.md` lists the sources: the RobotCode Robot Framework grammar
(Apache-2.0) and the Fieldcraft diagram renderer (MIT, transpiled to `.mjs` with
`npx esbuild <diagram-renderer.ts> --format=esm`). Parts of `src/rfe/lib/` and
`src/rfe/client/` are MIT-licensed ports of Fieldcraft modules and say so in their headers.
Re-vendor by copying the new upstream file and updating the version in `NOTICE.md`.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `test:ci` fails with "invalid link" | Link target missing, or written without the `/robotframework-essentials-web` prefix (use `{{base}}` in templates and overrides) |
| `node scripts/rfe-import.mjs` fails with "matched nothing" | The course source reworded a lesson; update or remove that rule in `src/rfe/rewrites.json` |
| Dev server shows a lesson without its body after a re-import | Stale content cache: `npx astro dev stop`, delete `.astro/data-store.json`, start again |
| `npm ci` asks for credentials or uses another registry | A user-level npm setting overrides the registry; the project `.npmrc` pins npmjs, check `npm config get registry` |
| Site still shows the old version after a deploy | Wait for the workflow's deploy job, then up to 10 minutes of Pages caching |
| `[rfe-runtime] <file>: SHA-256 mismatch in .rfe-runtime-cache/` | A cached download is damaged: delete that file and run again. A mismatch in a fresh download means the source changed; don't update the hash without checking why |
| Browser lab tests fail with "runtime not staged" | Run `npm run runtime` first (`test:ci` does it) |
| `lesson-blocks.test.mjs` names a block | The block no longer behaves as its lesson describes in the browser runtime; see "Lesson blocks and expected failures" |
| Browser lab shows an old version after a deploy | The results service worker only serves `/labs/_results/`; a hard reload picks up new pages and workers |
