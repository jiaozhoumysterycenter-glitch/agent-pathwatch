# Security policy

Agent Pathwatch treats every JSONL record as untrusted data, never as an
instruction. The parser ignores unknown payloads instead of rendering them.

Report security problems through the repository's private GitHub advisory form:

https://github.com/jiaozhoumysterycenter-glitch/agent-pathwatch/security/advisories/new

Do not open a public issue for a suspected data leak. If the private form is not
available, do not transmit a real session or secret; wait for the repository
owner to restore private reporting.

Do not attach a real session log, tool output, credential, account identifier,
or private filesystem path. Use a synthetic fixture whose secret canary is not
valuable outside the test.

The v0.1 threat model and non-goals are documented in
[docs/threat-model.md](docs/threat-model.md).
