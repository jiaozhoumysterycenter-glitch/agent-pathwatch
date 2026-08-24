# Agent Pathwatch

[![test](https://github.com/jiaozhoumysterycenter-glitch/agent-pathwatch/actions/workflows/test.yml/badge.svg)](https://github.com/jiaozhoumysterycenter-glitch/agent-pathwatch/actions/workflows/test.yml)

Agent Pathwatch is a small, offline CLI for inspecting the *shape* of an agent
session JSONL file without emitting its conversation content.

It answers questions such as:

- What context-window values were actually recorded?
- What were the latest observed input, cached-input, output, and reasoning-token
  counters?
- How many message, reasoning, tool-start, and tool-output records occurred?
- Did the file contain malformed lines, counter resets, unknown records, or
  unmatched tool events?

It does **not** decide why a network failed, estimate cost, reconstruct prompts,
or claim that an observed file format is an official schema.

## Privacy boundary

- Explicit input only: one file supplied by the user, or stdin.
- Message text, reasoning, encrypted reasoning, tool names, tool arguments,
  tool results, raw errors, paths, IDs, world state, and internal metadata are
  never included in a report.
- No network access, telemetry, update check, cache, index, or automatic scan of
  `~/.codex`.
- The source path is represented as `source-1`; absolute paths and filenames are
  not emitted.
- JSON and Markdown are rendered from the same content-silent canonical object.

The raw line and parsed JSON necessarily exist in this process's memory while
that line is being inspected. Agent Pathwatch promises not to persist or emit
that content; it cannot protect against a compromised operating system, another
process with the same privileges, swap, or a core dump. See [PRIVACY.md](PRIVACY.md).

## Quick start

Requires Node.js 20 or later and has no package dependencies.

Try the complete public fixture in about a minute:

```bash
git clone https://github.com/jiaozhoumysterycenter-glitch/agent-pathwatch.git
cd agent-pathwatch
npm ci --ignore-scripts
npm test
node src/cli.mjs inspect test/fixtures/minimal-lifecycle.jsonl
```

The expected content-silent output is committed at
[examples/minimal-report.md](examples/minimal-report.md).

Inspect your own explicit file only when you choose to:

```bash
node src/cli.mjs inspect /path/to/session.jsonl
node src/cli.mjs inspect /path/to/session.jsonl --format json
cat /path/to/session.jsonl | node src/cli.mjs inspect -
```

To install the current checkout as a command during development:

```bash
npm link
agent-pathwatch inspect /path/to/session.jsonl
```

Reports go to stdout by default. A new private output file can be created with:

```bash
agent-pathwatch inspect session.jsonl --format json --output report.json
```

Agent Pathwatch refuses to overwrite an existing output. Files it creates use
mode `0600` where the platform supports POSIX permissions.

## Commands

```text
agent-pathwatch inspect <FILE|-> [--format markdown|json]
  [--output <PATH|->] [--adapter auto|codex-observed-v1]
  [--context-window <TOKENS>] [--strict]

agent-pathwatch adapters [--format markdown|json]
agent-pathwatch version
agent-pathwatch help
```

`--context-window` is an explicit override with recorded provenance. Agent
Pathwatch never guesses a context window from a model name.

`--strict` returns exit code 4 when any data-quality issue is present. Without
it, a usable partial report still returns 0 and lists its issues.

Exit codes:

- `0`: a usable report or informational command completed;
- `2`: invalid arguments, unsafe input/output shape, or I/O refusal;
- `3`: no built-in adapter matched the input;
- `4`: a `--strict` report contained one or more quality issues;
- `5`: an internal error reached the content-silent error membrane.

## Supported input

The built-in `codex-observed-v1` adapter recognizes an observed Codex session
JSONL envelope. It is deliberately named "observed": it is based on formats
seen in user-owned local records and synthetic fixtures, not on an OpenAI schema
contract. Unknown records are counted and skipped without passing arbitrary
payload fields into the report.

The v0.1 adapter records only:

- wrapper and safe lifecycle counts;
- normalized role and phase buckets;
- context-window integers;
- validated token-counter snapshots;
- opaque tool start/output/status relationships using in-memory ordinals;
- boolean/count error activity for recognized error-shaped events;
- parsing and schema-drift quality issues.

See [docs/report-schema.md](docs/report-schema.md) and
[docs/adapter-contract.md](docs/adapter-contract.md).

## Development

```bash
npm test
npm run check
npm run demo
```

All committed fixtures are synthetic. Do not open an issue containing a real
session file. Use the repository's issue forms; they are designed to accept
content-free diagnostics and synthetic reproductions. This project is not
affiliated with or endorsed by OpenAI.

## Status

`0.1.0` is an early, intentionally narrow implementation. It accepts a single
JSONL input and provides one built-in adapter. Directory discovery, content
export, arbitrary plugins, pricing, and causal diagnosis are out of scope.

The code is maintained as a standalone public repository, but `0.1.0` has not
yet been tagged or published to npm. The remaining release checks are recorded
in [docs/release-checklist.md](docs/release-checklist.md).
