# Privacy

Agent Pathwatch is designed for content-silent local diagnostics.

## Never emitted

The canonical report, Markdown renderer, JSON renderer, stdout, and expected
error paths must not include:

- message, prompt, response, reasoning, or summary text;
- encrypted reasoning bytes;
- tool names, arguments, results, commands, or raw errors;
- session, thread, turn, item, call, window, or parent IDs;
- source filenames, absolute paths, working directories, workspace roots, or
  repository metadata;
- world-state and internal passthrough objects;
- account, plan, credit, rate-limit, or provider identifiers.

Unknown keys and unknown content blocks are counted, not copied.

## Data flow

Agent Pathwatch reads one explicit regular file or stdin, one line at a time.
Each raw line and parsed object temporarily exists in process memory. The tool
does not create a cache, source copy, index, or diagnostic upload. When the user
explicitly names an output file, the already-redacted report is first fsynced to
a mode-`0600` same-directory temporary file and then published without replacing
an existing destination; the temporary link is removed immediately afterward.

Output is deterministic for the same input, options, and Agent Pathwatch
version. It does not contain a generated-at timestamp.

## Not protected against

Agent Pathwatch does not defend against a compromised host, malicious same-user
processes, swap inspection, core dumps, terminal scrollback, or content the user
explicitly places in an output filename or shell command line.

For public bug reports, reproduce problems with synthetic data.
