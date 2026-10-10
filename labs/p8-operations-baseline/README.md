# rf-essentials — Running Robot Framework for Real

Suites live in `checks/`. Bundled tools: Robocop (`robocop check` / `robocop
format`) and Pabot (`pabot`).

- Dry run:     `uv run robot --dryrun checks`
- Reprocess:   `uv run rebot --outputdir results results/output.xml`
- Lint/format: `uv run robocop check checks` · `uv run robocop format checks`
- Parallel:    `uv run pabot --outputdir results checks`
