"""Test and keyword timeouts without signals or threads.

Pyodide has neither, so Robot Framework reports timeouts as unsupported. This runner
installs a trace function that raises the timeout error once the deadline has passed.
It checks between Python lines, which covers Sleep (it sleeps in 10 ms parts) and Python
loops; blocking C code is not interrupted.
"""

import sys
import time

from robot.running.timeouts.runner import Runner


class TraceRunner(Runner):
    def _run(self, runnable):
        deadline = time.monotonic() + self.timeout
        previous = sys.gettrace()

        def tracer(frame, event, arg):
            if not self.exceeded and time.monotonic() >= deadline:
                self.exceeded = True
            if self.exceeded and not self.paused:
                sys.settrace(previous)
                raise self.timeout_error
            if previous is not None:
                previous(frame, event, arg)
            return tracer

        sys.settrace(tracer)
        try:
            return runnable()
        finally:
            sys.settrace(previous)


def install():
    Runner.runner_implementation = TraceRunner
