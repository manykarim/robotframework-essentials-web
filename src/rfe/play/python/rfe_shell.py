"""Shell of the browser lab's terminal.

Accepts the commands the lessons show, for every runner: `uv run …`, `poetry run …`,
`python -m …`, `.venv/bin/…` and plain forms of robot, rebot, libdoc and robocop, plus
`python <script>` and a few file commands. Setup commands succeed with a note, and tools
that need a real machine say so.
"""

import io
import os
import re
import runpy
import shlex
import socketserver
import sys
import traceback

import rfe_workspace as ws

_emit = None
_load_group = None
_packages = ''
_robocop_ready = False

PYTHON = {'python', 'python3', 'py'}
# `python -m <module>` forms and the command they stand for.
MODULE_COMMANDS = {
    'robot': 'robot', 'robot.run': 'robot', 'robot.rebot': 'rebot', 'robot.libdoc': 'libdoc',
    'robocop': 'robocop', 'pabot': 'pabot', 'pip': 'pip', 'venv': 'venv', 'http.server': 'server',
}
VENV_PREFIXES = ('./.venv/bin/', '.venv/bin/', '.venv\\Scripts\\', '.\\.venv\\Scripts\\', '.venv/Scripts/')
SETUP = {
    'uv': {'sync', 'add', 'init', 'lock', 'venv', 'pip', 'remove'},
    'poetry': {'install', 'add', 'lock', 'init', 'remove'},
    'pip': {'install', 'uninstall'},
    'venv': None,
    'source': None,
    'activate': None,
    'Activate': None,
    'deactivate': None,
}
REAL_MACHINE = {
    'pabot': 'pabot runs suites in parallel processes, which the browser lab cannot start.',
    'rfbrowser': 'the Browser library needs a real browser engine.',
    'robotcode': 'the RobotCode command line needs a real machine (the editor here uses RobotCode already).',
    'code': 'VS Code runs on your machine.',
    'server': 'starting servers needs a real machine.',
}
PLAIN_UNAVAILABLE = {'git', 'curl', 'wget', 'node', 'npm', 'npx', 'docker', 'bash', 'sh', 'zsh', 'pwsh',
                     'powershell', 'make', 'gh', 'ssh', 'sudo', 'apt', 'brew', 'winget', 'choco'}
DOWNLOAD = 'Download the lab from the lesson’s lab card and run it in VS Code.'
SERVER_MESSAGE = ('Starting servers needs a real machine. ' + DOWNLOAD)
DEMO_SHOP_MESSAGE = ('The demo shop already answers inside the browser lab: requests to localhost:7272 (web shop) '
                     'and localhost:7273 (JSON API) reach demo_app/ without a server. Nothing to start.')

HELP = """\
Commands in this browser terminal (uv run, poetry run, python -m and .venv/bin/ forms work too):
  robot [options] <paths>        run suites, e.g. robot --outputdir results checks
  rebot [options] <output.xml>   combine or post-process results
  libdoc <library> <output>      library documentation
  robocop check|format [paths]   lint and format Robot Framework files
  python <script.py> [args]      run a Python script (also -c and --version)
  ls [dir]  cat <file>  cd <dir>  pwd  tree  clear  help
  Ctrl+C stops a running command; Up and Down recall earlier commands.

Already installed here: {packages}. Setup commands such as
uv sync, pip install and poetry install have nothing to do.

Needs a real machine: the Browser library (rfbrowser), pabot, starting servers, programs
other than Python (git, code, curl, ...) and installing packages. Download the lab from the
lesson's lab card for those.
Python {python} runs in your browser; the downloaded labs use your own Python.
"""


class _Stream(io.TextIOBase):
    encoding = 'utf-8'

    def __init__(self, err):
        self.err = err

    def writable(self):
        return True

    def write(self, text):
        if text:
            _emit(text, self.err)
        return len(text)

    def isatty(self):
        return True


def configure(emit, load_group, packages=''):
    """emit(text, is_error) shows output; await load_group(name) adds a group of packages."""
    global _emit, _load_group, _packages
    _emit, _load_group, _packages = emit, load_group, packages
    socketserver.TCPServer.server_bind = _refuse_server
    os.environ.setdefault('TERM', 'xterm-256color')


def _refuse_server(self):
    raise OSError(SERVER_MESSAGE)


def normalize(argv):
    """Strip runner prefixes: `uv run`, `poetry run`, `.venv/bin/`, `python -m robot`, …"""
    while True:
        if argv[:2] in (['uv', 'run'], ['poetry', 'run']):
            argv = argv[2:]
            while argv and argv[0].startswith('-'):  # `uv run --frozen robot …`
                argv = argv[1:]
            continue
        if argv and argv[0].startswith(VENV_PREFIXES):
            argv = [argv[0].replace('\\', '/').rsplit('/', 1)[-1], *argv[1:]]
            continue
        break
    if argv:
        name = argv[0]
        for suffix in ('.exe', '.ps1'):
            if name.lower().endswith(suffix):
                name = name[: -len(suffix)]
        argv = [name, *argv[1:]]
    if len(argv) >= 3 and argv[0] in PYTHON and argv[1] == '-m' and argv[2] in MODULE_COMMANDS:
        argv = [MODULE_COMMANDS[argv[2]], *argv[3:]]
    return argv


def output_dir(args):
    """The current directory as the default output directory. (Robot Framework reads its
    default when it is imported; here that happens once, not in every new process.)"""
    names = {a.split('=', 1)[0] for a in args if a.startswith('-')}
    return list(args) if names & {'--outputdir', '-d'} else ['--outputdir', '.', *args]


def console_options(args, cols):
    """Colours and width for the terminal, unless the learner sets them."""
    names = {a.split('=', 1)[0] for a in args if a.startswith('-')}
    extra = []
    if not names & {'--consolecolors', '-C'}:
        extra += ['--consolecolors', 'ansi']
    if not names & {'--consolewidth', '-W'}:
        extra += ['--consolewidth', str(max(40, min(int(cols) - 2, 120)))]
    return extra + list(args)


async def _ensure_robocop():
    global _robocop_ready
    if not _robocop_ready:
        _emit('\x1b[2m(loading Robocop …)\x1b[0m\r\n', False)
        await _load_group('robocop')
        _robocop_ready = True


def _setup_command(cmd, args):
    if cmd not in SETUP:
        return False
    subcommands = SETUP[cmd]
    return subcommands is None or (args[:1] and args[0] in subcommands)


def _run_python(args):
    if not args:
        print('python: interactive Python is not available in the browser terminal. Run a script: python <file.py>')
        return 1
    if args[0] in ('--version', '-V'):
        print(f'Python {sys.version.split()[0]}')
        return 0
    if os.path.normpath(args[0]).replace(os.sep, '/').endswith('demo_app/serve.py') and os.path.exists(args[0]):
        print(DEMO_SHOP_MESSAGE)
        return 0
    saved = sys.argv, sys.path[:]
    try:
        if args[0] == '-c':
            sys.argv = ['-c', *args[2:]]
            exec(compile(args[1] if len(args) > 1 else '', '<string>', 'exec'), {'__name__': '__main__'})
        elif args[0] == '-m':
            sys.argv = [args[1], *args[2:]]
            runpy.run_module(args[1], run_name='__main__', alter_sys=True)
        else:
            sys.argv = list(args)
            sys.path.insert(0, os.path.dirname(os.path.abspath(args[0])))
            runpy.run_path(args[0], run_name='__main__')
        return 0
    except SystemExit as e:
        if e.code is None or isinstance(e.code, int):
            return e.code or 0
        print(e.code, file=sys.stderr)
        return 1
    finally:
        sys.argv, sys.path[:] = saved[0], saved[1]


def _tree(target):
    base = os.path.relpath(os.path.abspath(target), ws.root) if os.path.abspath(target) != ws.root else ''
    for rel in sorted(__import__('json').loads(ws.list_files())):
        if not base or rel.startswith(base + '/'):
            print(rel[len(base) + 1:] if base else rel)


async def _dispatch(cmd, args, cols):
    if cmd == 'robot':
        from robot import run_cli
        return run_cli(output_dir(console_options(args, cols)), exit=False)
    if cmd == 'rebot':
        from robot import rebot_cli
        return rebot_cli(output_dir(args), exit=False)
    if cmd == 'libdoc':
        from robot.libdoc import libdoc_cli
        return libdoc_cli(args, exit=False)
    if cmd == 'robocop':
        await _ensure_robocop()
        os.environ['COLUMNS'] = str(cols)
        from robocop.run import app
        try:
            app([*args, '--no-cache'] if args[:1] in (['check'], ['format']) else args, standalone_mode=False)
        except SystemExit as e:
            return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        return 0
    if cmd in PYTHON:
        return _run_python(args)
    if cmd == 'ls':
        paths = [a for a in args if not a.startswith('-')] or ['.']
        for target in paths:
            if len(paths) > 1:
                print(f'{target}:')
            if os.path.isdir(target):
                for name in sorted(os.listdir(target)):
                    if name not in ws.SKIP_DIRS:
                        print(name + ('/' if os.path.isdir(os.path.join(target, name)) else ''))
            else:
                print(target if os.path.exists(target) else f'ls: {target}: no such file or directory')
        return 0
    if cmd == 'tree':
        _tree(args[0] if args else '.')
        return 0
    if cmd == 'cat':
        rc = 0
        for name in args:
            try:
                with open(name, encoding='utf-8', errors='replace') as f:
                    text = f.read()
                print(text, end='' if text.endswith('\n') or not text else '\n')
            except OSError as e:
                print(f'cat: {name}: {e.strerror}', file=sys.stderr)
                rc = 1
        return rc
    if cmd == 'cd':
        target = args[0] if args else ws.root
        path = os.path.abspath(target)
        if not (path == ws.root or path.startswith(ws.root + '/')):
            print('cd: the browser lab only has the lab folder', file=sys.stderr)
            return 1
        if not os.path.isdir(path):
            print(f'cd: {target}: no such directory', file=sys.stderr)
            return 1
        os.chdir(path)
        return 0
    if cmd == 'pwd':
        print(os.getcwd())
        return 0
    if cmd == 'clear':
        _emit('\x1b[2J\x1b[3J\x1b[H', False)
        return 0
    if cmd == 'help':
        print(HELP.format(packages=_packages, python=sys.version.split()[0]), end='')
        return 0
    if _setup_command(cmd, args):
        print(f'The lab’s packages are already installed in the browser lab ({_packages}). Nothing to do here; '
              'on your machine, this command sets up the downloaded lab.')
        return 0
    if cmd in REAL_MACHINE:
        print(f'{cmd}: {REAL_MACHINE[cmd]} {DOWNLOAD}')
        return 127
    if cmd in PLAIN_UNAVAILABLE or cmd in SETUP:
        print(f'{cmd}: needs a real machine. {DOWNLOAD}')
        return 127
    print(f"{cmd}: command not found. Type 'help' for the commands of this terminal.")
    return 127


async def sh(line, cols=100):
    """Run one command line; returns its exit code."""
    # Windows venv paths: backslashes are separators there, not escapes.
    line = re.sub(r'(^|\s)(?:\.\\)?\.venv\\Scripts\\', r'\1.venv/Scripts/', line, flags=re.IGNORECASE)
    try:
        argv = normalize(shlex.split(line, posix=True))
    except ValueError as e:
        _emit(f'parse error: {e}\r\n', True)
        return 2
    if not argv:
        return 0
    cmd, args = argv[0], argv[1:]
    ws.purge_modules()
    out, err = _Stream(False), _Stream(True)
    saved = sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__
    sys.stdout = sys.__stdout__ = out
    sys.stderr = sys.__stderr__ = err
    try:
        rc = await _dispatch(cmd, args, cols)
        return 0 if rc is None else int(rc)
    except BaseException:
        traceback.print_exc()
        return 1
    finally:
        sys.stdout, sys.stderr, sys.__stdout__, sys.__stderr__ = saved
