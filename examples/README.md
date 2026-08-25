# Examples

Every example in this directory is derived from a committed synthetic fixture.
No real session, account, filesystem path, tool payload, or message content is
used.

In a full source checkout, regenerate the minimal Markdown report from the
repository root:

```bash
node src/cli.mjs inspect test/fixtures/minimal-lifecycle.jsonl
```

The published npm package intentionally does not include `test/` or its fixture;
the committed [`minimal-report.md`](minimal-report.md) remains available there
for reviewing the public report surface without asking anyone to expose a real
agent conversation. Clone the source repository to regenerate that exact
example, or inspect your own explicitly selected JSONL/stdin input.
