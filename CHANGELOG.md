# Changelog

All notable changes to Agent Pathwatch will be documented here.

## 0.1.0 - Unreleased

- Add an explicit-file/stdin-only offline CLI.
- Add the content-silent `codex-observed-v1` adapter.
- Report observed context windows, token snapshots, message/reasoning activity,
  opaque tool relationships, error activity, a relative safe timeline, and
  explicit data-quality issues.
- Add deterministic Markdown and JSON renderers.
- Refuse symlink/non-regular input and existing output files.
- Add synthetic privacy-canary, malformed-input, deterministic-output, file
  permission, no-match, strict-mode, and network-surface tests.
