# Agent Pathwatch report

> Content-silent local report. Message text, reasoning, tool data, paths, and IDs were not emitted.

## Source

| Field | Value |
| --- | ---: |
| Label | source-1 |
| Kind | regular-file |
| Bytes | 1920 |
| Lines | 8 |
| Parseable lines | 8 |
| Invalid lines | 0 |
| Oversized lines | 0 |

## Adapter

- ID: `codex-observed-v1`
- Version: `0.1.0`
- Match: `matched`
- Recognized records: 8
- Boundary: observed format support; not an official schema contract.

## Context window

- State: `observed`
- Configured tokens: 100000
- Observed values: 100000
- Explicit override: no

## Latest last-token snapshot

Semantics: `observed_last_snapshot`; evidence line: 7.

| Counter | Value |
| --- | ---: |
| input_tokens | 120 |
| cached_input_tokens | 80 |
| cache_write_input_tokens | 0 |
| output_tokens | 30 |
| reasoning_output_tokens | 10 |
| total_tokens | 160 |

## Latest cumulative snapshot

Semantics: `observed_cumulative_snapshot`; evidence line: 7.

| Counter | Value |
| --- | ---: |
| input_tokens | 120 |
| cached_input_tokens | 80 |
| cache_write_input_tokens | 0 |
| output_tokens | 30 |
| reasoning_output_tokens | 10 |
| total_tokens | 160 |

Observed cumulative snapshots: 1; duplicate snapshots: 0; resets: 0.

No price or billable-token total was inferred.

## Activity

| Wrapper | Count |
| --- | ---: |
| session_meta | 1 |
| turn_context | 1 |
| world_state | 0 |
| inter_agent_communication_metadata | 0 |
| event_msg | 4 |
| response_item | 2 |
| compacted | 0 |

Messages: event=1, response=1, cross-agent=0.

Reasoning records: 1; content blocks counted: 2; unknown content blocks: 0.

### Roles

| Role | Count |
| --- | ---: |
| assistant | 1 |
| user | 1 |

### Phases

| Phase | Count |
| --- | ---: |
| final | 1 |
| none | 1 |

## Tool activity

Started: 0; outputs observed: 0; paired calls: 0; orphaned calls: 0; orphaned outputs: 0.

Tool names, arguments, and results were not emitted.

| Status | Count |
| --- | ---: |
| none | 0 |

## Error activity

Observed: no; count: 0; raw text emitted: no.

## Safe timeline

| Sequence | Source line | Offset (s) | Kind | Safe detail |
| ---: | ---: | ---: | --- | --- |
| 1 | 3 | 0 | task_started | context=100000 |
| 2 | 4 | 1 | response_message | role=user, phase=none |
| 3 | 5 | 2 | reasoning | — |
| 4 | 6 | 3 | event_message | phase=final |
| 5 | 7 | 4 | token_snapshot | last_total=160, cumulative_total=160 |
| 6 | 8 | 5 | task_complete | — |

## Data quality

Status: `complete`; issues: 0.
Unknown subtypes: 0 records across 0 event groups and 0 response groups; names were not emitted.
Safe timeline events emitted: 6; not emitted: 0.

| Severity | Code | Line | Count | Safe detail |
| --- | --- | ---: | ---: | --- |
| info | none | — | 0 | No quality issues observed. |

## Privacy posture

- Explicit input only: yes
- Network access: no
- Telemetry: no
- Cache written: no
- Raw-value passthrough: no
