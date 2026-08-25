# Changelog

All notable changes to Agent Pathwatch will be documented here.

## Unreleased

- Recognize observed `patch_apply_end` events as opaque tool-end signals while
  continuing to discard patch changes, stdout, stderr, IDs, and status text.
- Count distinct unknown event/response subtype groups without emitting subtype
  names or retaining them in the report.
- Add `--no-timeline` for an explicit canonical-report projection that records
  how many safe timeline events were omitted.

## 0.1.0 - 2026-08-23

- Add an explicit-file/stdin-only offline CLI.
- Add the content-silent `codex-observed-v1` adapter.
- Report observed context windows, token snapshots, message/reasoning activity,
  opaque tool relationships, error activity, a relative safe timeline, and
  explicit data-quality issues.
- Add deterministic Markdown and JSON renderers.
- Refuse symlink/non-regular input and existing output files.
- Add synthetic privacy-canary, malformed-input, deterministic-output, file
  permission, no-match, strict-mode, and network-surface tests.
- Add a generated synthetic example report and content-free GitHub issue forms.
- Verify the test and package workflow on Linux Node 20/22/24, macOS Node 20,
  and Windows Node 20.
