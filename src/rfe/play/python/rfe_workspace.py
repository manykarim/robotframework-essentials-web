"""Workspace of the browser lab: the lab's files under /work/<lab folder>/.

The page owns the workspace and writes the files; this module lists them, tells which
files a command changed, and finds the run results.
"""

import importlib
import json
import os
import re
import shutil
import sys

WORK = '/work'
SKIP_DIRS = {'__pycache__', '.venv', '.robocop_cache', '.pytest_cache'}
GENERATED_DIR = 'results'
# Robot Framework output files a run or rebot writes (`--log`, `--report`, `--output` names included).
RESULT_FILE = re.compile(r'(^|/)([^/]*log\.html|[^/]*report\.html|[^/]*output[^/]*\.xml)$')

root = WORK


def reset(folder):
    """Start an empty workspace at /work/<folder>/ and make it the current directory."""
    global root
    os.chdir('/')
    shutil.rmtree(WORK, ignore_errors=True)
    root = os.path.join(WORK, folder)
    os.makedirs(root)
    os.chdir(root)
    importlib.invalidate_caches()
    return root


def _walk():
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(files):
            yield os.path.relpath(os.path.join(directory, name), root).replace(os.sep, '/')


def is_generated(rel):
    """Whether a file is a run output (results/, or a result file at the top level)."""
    return rel.split('/', 1)[0] == GENERATED_DIR or ('/' not in rel and bool(RESULT_FILE.search(rel)))


def list_files():
    return json.dumps(list(_walk()))


def snapshot():
    """Content fingerprints of every workspace file."""
    state = {}
    for rel in _walk():
        with open(os.path.join(root, rel), 'rb') as f:
            state[rel] = hash(f.read())
    return state


def changes(before):
    """What a command did, compared with an earlier snapshot(): the learner's files it created,
    changed or deleted, and the result files it wrote."""
    after = snapshot()
    new = sorted(rel for rel, h in after.items() if before.get(rel) != h)
    return json.dumps({
        'changed': [rel for rel in new if not is_generated(rel)],
        'deleted': sorted(rel for rel in before if rel not in after and not is_generated(rel)),
        'results': [rel for rel in new if RESULT_FILE.search(rel)],
    })


def result_files():
    return json.dumps([rel for rel in _walk() if RESULT_FILE.search(rel)])


def remove(rel):
    path = os.path.join(root, rel)
    if os.path.isdir(path):
        shutil.rmtree(path)
    elif os.path.exists(path):
        os.remove(path)


def purge_modules():
    """Forget modules imported from the workspace, so edited libraries load again."""
    prefix = WORK + '/'
    for name, module in list(sys.modules.items()):
        if str(getattr(module, '__file__', '') or '').startswith(prefix):
            del sys.modules[name]
    importlib.invalidate_caches()
