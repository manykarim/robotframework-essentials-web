# rf-essentials — Custom Libraries with Python

Your custom Python libraries go in `libraries/`; suites that import them live in
`checks/`.

- Run the checks:  `uv run robot --outputdir results checks`
- Generate keyword docs:  `uv run libdoc libraries/<file>.py results/<file>.html`

`robotframework-pythonlibcore` is bundled for the larger-library lessons.
