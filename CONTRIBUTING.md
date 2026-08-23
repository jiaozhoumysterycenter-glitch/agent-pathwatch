# Contributing

Agent Pathwatch accepts small, reviewable changes that preserve its privacy
boundary.

Before opening a change:

1. Use only synthetic fixtures. Never commit or attach a real session log.
2. Add a unique `PATHWATCH_NEVER_EMIT_*` canary to every newly supported opaque
   content field and prove it is absent from JSON, Markdown, stdout, and stderr.
3. Treat new fields as optional and new enums as open.
4. Do not add automatic session discovery, telemetry, update checks, arbitrary
   plugins, content export, or a network dependency.
5. Document whether a counter is an observed snapshot, cumulative counter,
   delta, or unknown. Never infer billing semantics.

Run:

```bash
npm run check
npm test
npm pack --dry-run
```

Parser support should be described as an observed adapter rule, not an official
schema guarantee.
