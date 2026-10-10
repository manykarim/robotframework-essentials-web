"""Process substitute: `python` commands run inside this interpreter.

The browser can't start processes. subprocess.Popen is replaced by a class that runs
`python`, `python3` and `py` commands (a script path, `-c` code or `--version`) in-process
and returns an already finished process. Everything else exits 127. That covers the
Process library's Run Process and Start Process as the course uses them.
"""

import contextlib
import io
import itertools
import os
import runpy
import shlex
import subprocess
import sys
import traceback

PYTHON_COMMANDS = {'python', 'python3', 'py', 'python.exe', 'python3.exe', 'py.exe'}


def _is_python(command):
    return command == sys.executable or os.path.basename(command) in PYTHON_COMMANDS


def _run_python(args, out, err):
    if args[:1] in (['--version'], ['-V']):
        out.write(f'Python {sys.version.split()[0]}\n')
        return 0
    if not args:
        err.write('python: interactive Python is not available in the browser lab\n')
        return 1
    try:
        if args[0] == '-c':
            sys.argv = ['-c', *args[2:]]
            exec(compile(args[1] if len(args) > 1 else '', '<string>', 'exec'), {'__name__': '__main__'})
        elif args[0] == '-m':
            sys.argv = [args[1], *args[2:]]
            runpy.run_module(args[1], run_name='__main__', alter_sys=True)
        else:
            sys.argv = list(args)
            runpy.run_path(args[0], run_name='__main__')
        return 0
    except SystemExit as e:
        if e.code is None or isinstance(e.code, int):
            return e.code or 0
        err.write(f'{e.code}\n')
        return 1
    except BaseException:
        traceback.print_exc()
        return 1


class InProcessPopen:
    """A finished process: the command ran to completion when the object was created."""

    _pids = itertools.count(1000)

    def __init__(self, args, bufsize=-1, executable=None, stdin=None, stdout=None, stderr=None,
                 preexec_fn=None, close_fds=True, shell=False, cwd=None, env=None, universal_newlines=None,
                 startupinfo=None, creationflags=0, restore_signals=True, start_new_session=False,
                 pass_fds=(), *, text=None, encoding=None, errors=None, **kwargs):
        argv = shlex.split(args) if isinstance(args, str) else [os.fspath(a) for a in args]
        self.args = args
        self.pid = next(self._pids)
        out, err = io.StringIO(), io.StringIO()
        self.returncode = self._execute(argv, cwd, env, out, err)
        self._text = bool(text or universal_newlines or encoding or errors)
        out_bytes, err_bytes = out.getvalue().encode(), err.getvalue().encode()
        if stderr is subprocess.STDOUT:
            out_bytes, err_bytes = out_bytes + err_bytes, b''
            self.stderr = None
        else:
            self.stderr = self._deliver(stderr, err_bytes)
        self.stdout = self._deliver(stdout, out_bytes)
        self.stdin = io.BytesIO() if stdin is subprocess.PIPE else None

    def _deliver(self, target, data):
        """Hand output to its destination; returns the readable pipe for PIPE."""
        if target is subprocess.PIPE:
            return io.StringIO(data.decode(errors='replace')) if self._text else io.BytesIO(data)
        if target in (None, subprocess.DEVNULL):
            return None
        if isinstance(target, int):
            if target >= 0:
                os.write(target, data)
            return None
        if hasattr(target, 'write'):
            binary = 'b' in getattr(target, 'mode', 'b')
            target.write(data if binary else data.decode(errors='replace'))
            target.flush()
        return None

    @staticmethod
    def _execute(argv, cwd, env, out, err):
        if not argv or not _is_python(argv[0]):
            name = argv[0] if argv else ''
            err.write(f'{name}: only Python commands (python, python3, py) can run in the browser lab. '
                      'Download the lab to run other programs.\n')
            return 127
        saved = os.getcwd(), sys.argv, dict(os.environ), sys.path[:]
        try:
            if cwd:
                os.chdir(cwd)
            if env is not None:
                os.environ.clear()
                os.environ.update(env)
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                return _run_python(argv[1:], out, err)
        finally:
            os.chdir(saved[0])
            sys.argv = saved[1]
            os.environ.clear()
            os.environ.update(saved[2])
            sys.path[:] = saved[3]

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode

    def communicate(self, input=None, timeout=None):
        result = []
        for stream in (self.stdout, self.stderr):
            result.append(stream.read() if stream else None)
            if stream:
                stream.close()  # a real Popen closes its pipes after communicate()
        return tuple(result)

    def send_signal(self, sig):
        pass

    def terminate(self):
        pass

    def kill(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        for stream in (self.stdout, self.stderr, self.stdin):
            if stream:
                stream.close()


def install():
    subprocess.Popen = InProcessPopen
