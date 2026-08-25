# Report schema v0.1

Every report has schema identifier `pathwatch.report/v0.1` and the following
top-level sections:

- `source`: content-free line, byte, and parse-health counts.
- `adapter`: adapter identity and observed-format caveat.
- `context_window`: observed or explicitly overridden token capacity.
- `usage`: latest validated last-turn and cumulative snapshots plus reset and
  duplicate-snapshot counts. Snapshots are not summed into prices or invented
  billable totals.
- `activity`: safe wrapper/message/reasoning counts.
- `tools`: opaque call/output relationship counts and normalized statuses.
- `errors`: boolean/count error activity without raw text.
- `timeline`: record-order events with relative, rounded time offsets.
- `data_quality`: explicit issue codes, coverage, and unknown-record counts.
  Unknown subtype names remain private; separate event/response distinct-group
  counts show whether many unknown records share one shape or several.

Missing numeric values are `null`, never zero. Original timestamps are not
exported. Timeline offsets are relative to the first exported safe timeline
event with a valid timestamp and rounded to whole seconds; source record order
is preserved even when timestamps move backwards.

The machine-readable shape is in
[`schemas/pathwatch-report-v0.1.schema.json`](../schemas/pathwatch-report-v0.1.schema.json).
