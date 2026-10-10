"""RobotCode as the browser lab's language server, inside the language worker.

RobotCode expects threads, subprocesses and a client that sends incremental changes. The
bridge makes it work in Pyodide:
  - four patches: run_as_task runs its function at once (and never starts the workspace
    diagnostics loop); library imports run in-process instead of in a subprocess;
    threading.Timer becomes a timer on the event loop; the modules that imported
    run_as_task by name get the synchronous version too;
  - a full-text didChange becomes a whole-document range edit (RobotCode ignores
    full-text changes);
  - requests from the server to the client (workspace/configuration and others) are
    answered here;
  - diagnostics are pushed about 350 ms after an open or change, and after each run;
  - files written by the page are reported as watched-file changes.
The patches depend on RobotCode's internals and are tested against the pinned version.
"""

import asyncio
import json
import sys
import threading
import traceback

ROBOTCODE_VERSION = '2.7.0'
DEBOUNCE = 0.35
WORK = '/work/'


class _LoopTimer:
    """threading.Timer on the event loop."""

    def __init__(self, interval, function, args=None, kwargs=None):
        self.interval, self.function = interval, function
        self.args, self.kwargs = args or [], kwargs or {}
        self.daemon = True
        self._handle = None

    def start(self):
        self._handle = asyncio.get_event_loop().call_later(self.interval, lambda: self.function(*self.args, **self.kwargs))

    def cancel(self):
        if self._handle:
            self._handle.cancel()

    def is_alive(self):
        return self._handle is not None and not self._handle.cancelled()

    def join(self, timeout=None):
        pass


def _purge_workspace_modules():
    for name, module in list(sys.modules.items()):
        if str(getattr(module, '__file__', '') or '').startswith(WORK):
            del sys.modules[name]


def _patch(name, module, attribute, value):
    if not hasattr(module, attribute):
        raise RuntimeError(f'RobotCode {ROBOTCODE_VERSION} bridge: {name}.{attribute} is missing')
    setattr(module, attribute, value)


def patch_robotcode():
    import robotcode.core.concurrent as concurrent
    import robotcode.jsonrpc2.protocol as protocol
    import robotcode.language_server.common.parts.diagnostics as diagnostics
    import robotcode.language_server.robotframework.parts.code_lens as code_lens
    import robotcode.robot.diagnostics.imports_manager as imports_manager

    def run_now(callable, *args, **kwargs):
        future = concurrent.Task()
        if getattr(callable, '__name__', '') == 'run_workspace_diagnostics':
            return future
        try:
            future.set_result(callable(*args, **kwargs))
        except BaseException as e:
            future.set_exception(e)
        return future

    def run_in_process(self, func, func_args, timeout_msg):
        _purge_workspace_modules()
        return func(*func_args)

    threading.Timer = _LoopTimer
    for name, module in [('concurrent', concurrent), ('imports_manager', imports_manager), ('protocol', protocol),
                         ('diagnostics', diagnostics), ('code_lens', code_lens)]:
        _patch(name, module, 'run_as_task', run_now)
    _patch('ImportsManager', imports_manager.ImportsManager, '_run_in_subprocess', run_in_process)


class _Transport(asyncio.Transport):
    """Receives the server's framed output: forwards notifications and responses, answers requests."""

    def __init__(self, bridge):
        super().__init__()
        self.bridge = bridge
        self.buffer = b''

    def write(self, data):
        self.buffer += data
        while True:
            head, sep, rest = self.buffer.partition(b'\r\n\r\n')
            if not sep:
                return
            length = next(int(line.split(b':', 1)[1]) for line in head.split(b'\r\n')
                          if line.lower().startswith(b'content-length'))
            if len(rest) < length:
                return
            body, self.buffer = rest[:length], rest[length:]
            message = json.loads(body)
            if 'method' in message and 'id' in message:
                self.bridge.answer(message)
            else:
                self.bridge.send(body.decode('utf-8'))

    def is_closing(self):
        return False

    def get_extra_info(self, name, default=None):
        return default


class Bridge:
    def __init__(self, send):
        """send(text) delivers one JSON-RPC message to the editor."""
        patch_robotcode()
        from robotcode.language_server.robotframework.server import RobotLanguageServer
        self.send = send
        self.server = RobotLanguageServer()
        self.protocol = self.server.create_protocol()
        self.protocol.connection_made(_Transport(self))
        self.timers = {}

    def _feed(self, message):
        body = json.dumps(message).encode('utf-8')
        self.protocol.data_received(b'Content-Length: %d\r\n\r\n' % len(body) + body)

    def answer(self, request):
        method = request['method']
        if method == 'workspace/configuration':
            result = [{} for _ in request.get('params', {}).get('items', [])]
        else:  # client/registerCapability, window/workDoneProgress/create, …
            result = None
        self._feed({'jsonrpc': '2.0', 'id': request['id'], 'result': result})

    def _whole_document(self, uri):
        document = self.protocol.documents.get(uri)
        lines = (document.text() if document is not None else '').split('\n')
        return {'start': {'line': 0, 'character': 0}, 'end': {'line': len(lines) - 1, 'character': len(lines[-1])}}

    def receive(self, text):
        """One JSON-RPC message from the editor."""
        message = json.loads(text)
        method = message.get('method')
        if method == 'textDocument/didChange':
            uri = message['params']['textDocument']['uri']
            changes = message['params']['contentChanges']
            message['params']['contentChanges'] = [
                c if 'range' in c else {'range': self._whole_document(uri), 'text': c['text']} for c in changes]
        self._feed(message)
        if method in ('textDocument/didOpen', 'textDocument/didChange'):
            self.schedule_diagnostics(message['params']['textDocument']['uri'])

    def schedule_diagnostics(self, uri, delay=DEBOUNCE):
        handle = self.timers.pop(uri, None)
        if handle:
            handle.cancel()
        self.timers[uri] = asyncio.get_event_loop().call_later(delay, self._diagnose, uri)

    def _diagnose(self, uri):
        self.timers.pop(uri, None)
        document = self.protocol.documents.get(uri)
        if document is None:
            return
        try:
            self.protocol.diagnostics.create_document_diagnostics_task(document, debounce=False, send_diagnostics=True)
        except Exception:
            traceback.print_exc()

    def _open_documents(self):
        return [d for d in list(self.protocol.documents.documents) if d.opened_in_editor]

    def _forget_failed_imports(self):
        """Drop cached imports that failed, so a library or resource created later is found.
        (RobotCode only watches files of imports that succeeded.)"""
        managers = {id(m): m for m in (self.protocol.documents_cache.get_imports_manager(d) for d in self._open_documents())}
        for manager in managers.values():
            for entries in (manager._libaries, manager._resources, manager._variables):
                for entry in list(entries.values()):
                    if entry.is_valid() and getattr(entry.get_libdoc(), 'errors', None):
                        entry.invalidate()

    def file_changed(self, uri, kind):
        """A file the editor doesn't have open was created (1), changed (2) or deleted (3)."""
        self._feed({'jsonrpc': '2.0', 'method': 'workspace/didChangeWatchedFiles',
                    'params': {'changes': [{'uri': uri, 'type': kind}]}})
        self._forget_failed_imports()
        self.refresh(force=True)

    def refresh(self, force=True):
        """Diagnose every open document again (after a run or a file change)."""
        for document in self._open_documents():
            if force:
                document.invalidate_cache()
                self.protocol.diagnostics.force_refresh_document(document, refresh=False)
            self.schedule_diagnostics(str(document.document_uri))
