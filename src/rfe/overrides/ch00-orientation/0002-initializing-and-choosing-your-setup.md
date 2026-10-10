# Labs & choosing how you run

Two setup ideas run through the whole course: from chapter 2 on, each chapter starts
from a **lab** — a prepared project — and you choose **how commands run**. Both take
a minute, and this lesson explains them before you need them.

## Labs

When a chapter works against files, its lessons show a **Lab** card. A lab is a
small, complete project: the files the chapter starts from, plus the pinned
dependencies in `uv.lock` and `requirements.txt`, so everyone runs the exact same
versions. The card offers:

- a **Download** button for the lab's `.zip`;
- a one-line command that downloads and unpacks it into your current folder, for
  bash/zsh and for PowerShell;
- the setup command for your runner, and how to open the folder in VS Code.

Each lab unpacks into its own folder, such as `rfe-ch05-specification-styles/`, so
labs never overwrite each other or your own work. A few lessons start from a fresh
lab in the middle of a chapter; their card says so. The
[course overview]({{base}}/) also offers a starter kit with
every lab at once.

> **Tip:** Open the lab folder itself in VS Code (**File → Open Folder…**, or
> `code rfe-<lab>` in a terminal). Each lab recommends the **RobotCode** and
> **Python** extensions; accept the prompt to install them.

> **Note:** Reading chapters like this one need no project, so there is no Lab card
> here.

## Choosing how you run — the "Run with" picker

Lessons with commands show a **Run with** picker, offering three ways to run Python
commands. Every command example in the course adapts to your choice, and the choice
sticks across pages:

- **uv** *(recommended)* — one fast tool that manages both the virtual environment
  and the dependencies, and installs the right Python version when it is missing.
  Commands run through `uv run`.
- **venv** — a plain Python virtual environment in a `.venv` folder. Activate it in
  each terminal; commands then run its executables directly.
- **poetry** — the Poetry package manager handles the environment and
  dependencies; commands run through `poetry run`.

Switch the picker and watch this command change:

```bash
uv run robot --outputdir results checks
```

All three end up with Robot Framework installed and runnable — they differ only in
the tool that builds the environment and installs packages. Pick the one your team
already uses; **uv** is the smoothest if you have no preference.

> **Warning:** In **venv** mode, select the `.venv` interpreter in VS Code
> (**Python: Select Interpreter**) so new terminals activate it and the editor
> resolves Robot Framework.

## Where the real setup happens

You don't set anything up here. The next chapter's setup lesson, **Architecture and
setup**, walks you through creating a project and adding Robot Framework in
whichever mode you picked — with the exact commands for your choice. From chapter 2
on, the labs arrive ready-made.

> **Note:** Part 2 (Web) needs Node.js and downloads a browser engine (~150 MB) the
> first time — `uv run rfbrowser init chromium`. It's a one-time step, and the Web
> chapter reminds you when you get there.

Answer the check below — and on to Robot Framework itself.
