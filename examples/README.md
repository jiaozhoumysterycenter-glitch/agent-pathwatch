# Examples

Every example in this directory is derived from a committed synthetic fixture.
No real session, account, filesystem path, tool payload, or message content is
used.

Regenerate the minimal Markdown report from the repository root:

```bash
node src/cli.mjs inspect test/fixtures/minimal-lifecycle.jsonl
```

The committed output is [`minimal-report.md`](minimal-report.md). It is useful
for reviewing the public report surface without asking anyone to expose a real
agent conversation.
