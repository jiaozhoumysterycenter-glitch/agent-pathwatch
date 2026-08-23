# Adapter contract

An adapter translates an observed input envelope into a small canonical event
set. It is not allowed to pass arbitrary source values through to a report.

The built-in v0.1 adapter follows these rules:

1. Inspect the top-level wrapper `type` first.
2. Inspect `payload.type` only for wrapper kinds that define a subtype.
3. Treat every field as optional and every enum as open.
4. Validate numeric counters as finite, non-negative safe integers.
5. Treat message/content/summary/tool/error/world/internal objects as opaque.
6. Convert bounded raw correlation IDs immediately to fixed-length in-memory
   digests, retain bounded outstanding/completed windows, and expose only
   run-local integer ordinals when a relationship must be represented.
7. Count and skip unknown records; never infer an unsupported schema.

`codex-observed-v1` describes compatibility with a format observed in
user-owned records. It is not an official OpenAI schema name or guarantee.
