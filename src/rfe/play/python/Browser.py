"""Stand-in for the Browser library, which needs a real browser engine."""

raise ImportError(
    'The Browser library needs a real browser engine and cannot run in the browser lab. '
    'Download the lab from the lesson’s lab card and run it in VS Code.'
)
