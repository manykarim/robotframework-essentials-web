# Architecture and setup

Robot Framework sits in the middle of a simple stack. Your **test cases** call
**keywords**; keywords come from **libraries** (Python code) or **resource
files** (shared Robot Framework code); libraries drive the **system under
test** — a browser, an API, the file system. This layering is the generic test
automation architecture (gTAA): the framework defines and runs, libraries adapt
it to each interface.

```diagram
stack "The gTAA layering: data drives the framework, which drives libraries, which drive the system under test"
layer "Test cases & keywords" -- .robot suites · resources
arrow drives
layer "Robot Framework core" :accent -- parse · run · report
arrow drives
layer Libraries -- Browser · Requests · your keywords
arrow drives
layer "System under test" :outline -- browser · API · file system
```

```youtube
id: QpQwS3ErRC4
title: Robot Framework tutorial Episode 2 — Architecture and test case example
duration: 1:56
summary: See how test data, Robot Framework, libraries, and the system under test form one automation stack.
```

To run anything you need a Python project with Robot Framework installed. This
course can run commands three ways — pick yours with **"Run with"** at the top
of this panel:

- **uv** (recommended) — one tool for the environment and dependencies.
- **venv** — a plain Python virtual environment (`.venv`).
- **poetry** — the poetry package manager.

Every command example below and throughout the course adapts to your choice, and
the **Run** button runs the right thing. You can change it any time (it
re-initializes the workspace to match).

> **Tip:** In VS Code, install the **RobotCode** extension for syntax
> highlighting, running, and debugging.

## Task 1 — Create a project and add Robot Framework

Work in your open workspace folder.

<!-- runner:uv -->
1. Create the project:

   ```bash
   uv init --no-workspace --name rf-essentials
   ```

2. Add Robot Framework:

   ```bash
   uv add robotframework
   ```
<!-- /runner -->
<!-- runner:venv -->
1. Create a virtual environment (use `python3` if `python` isn't found):

   ```bash
   python -m venv .venv
   ```

2. Install Robot Framework into it:

   ```bash
   uv add robotframework
   ```

> **Warning:** In venv mode, select the `.venv` interpreter in VS Code so new
> terminals activate it and editor tooling resolves Robot Framework. The
> extension does this for you when the Python extension is installed; otherwise
> run **Python: Select Interpreter** and choose `.venv`.
<!-- /runner -->
<!-- runner:poetry -->
1. Create the project:

   ```bash
   uv init --no-workspace --name rf-essentials
   ```

2. Add Robot Framework:

   ```bash
   uv add robotframework
   ```
<!-- /runner -->

**Check:** Robot Framework is installed in the project's environment.

## Task 2 — Verify Robot Framework runs

Confirm the install by asking Robot Framework for its version:

```bash
uv run robot --version
```

It prints a line like `Robot Framework 7.x (Python 3.x on ...)` and exits.

**Check:** the last command ran `robot` and printed its version banner.
