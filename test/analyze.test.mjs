import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import test from 'node:test';

import { analyzeReadable, appendQualityIssue } from '../src/analyze.mjs';
import { renderJson, renderMarkdown } from '../src/render.mjs';

const NEVER_EMIT = 'PATHWATCH_NEVER_EMIT';

function fixture(name) {
  return new URL(`./fixtures/${name}`, import.meta.url);
}

async function analyzeFixture(name, options = {}) {
  const path = fixture(name);
  const bytes = (await readFile(path)).byteLength;
  return analyzeReadable(createReadStream(path), {
    sourceKind: 'regular-file',
    sourceBytes: bytes,
    ...options,
  });
}

test('minimal lifecycle produces a complete content-silent report', async () => {
  const report = await analyzeFixture('minimal-lifecycle.jsonl');

  assert.equal(report.schema, 'pathwatch.report/v0.1');
  assert.equal(report.adapter.match_state, 'matched');
  assert.equal(report.context_window.state, 'observed');
  assert.equal(report.context_window.configured_tokens, 100000);
  assert.equal(report.context_window.evidence.count, 2);
  assert.deepEqual(report.context_window.evidence.rules, [
    'event_msg.task_started',
    'event_msg.token_count',
  ]);
  assert.equal(report.usage.last_snapshot.values.input_tokens, 120);
  assert.equal(report.usage.last_snapshot.values.cached_input_tokens, 80);
  assert.equal(report.usage.cumulative_snapshot.values.total_tokens, 160);
  assert.equal(report.activity.messages.response_messages, 1);
  assert.equal(report.activity.messages.event_messages, 1);
  assert.equal(report.activity.reasoning_records, 1);
  assert.equal(report.data_quality.status, 'complete');
  assert.equal(report.source.path_emitted, false);
  assert.equal(report.source.content_emitted, false);

  const json = renderJson(report);
  const markdown = renderMarkdown(report);
  assert.equal(json.includes(NEVER_EMIT), false);
  assert.equal(markdown.includes(NEVER_EMIT), false);
  assert.equal(json.includes('synthetic-session-id'), false);
  assert.equal(markdown.includes('minimal-lifecycle.jsonl'), false);
});

test('tool payloads remain opaque while relationships are counted', async () => {
  const report = await analyzeFixture('tool-opaque.jsonl');

  assert.equal(report.tools.started, 2);
  assert.equal(report.tools.paired_calls, 2);
  assert.equal(report.tools.orphaned_calls, 0);
  assert.equal(report.tools.orphaned_outputs, 1);
  assert.equal(report.tools.end_signals_observed, 1);
  assert.equal(report.activity.record_counts.compacted, 1);
  assert.equal(report.activity.messages.event_messages, 1);
  assert.equal(report.errors.activity, true);
  assert.equal(report.errors.count, 1);
  assert.equal(report.data_quality.status, 'partial');

  const rendered = `${renderJson(report)}\n${renderMarkdown(report)}`;
  assert.equal(rendered.includes(NEVER_EMIT), false);
  assert.equal(rendered.includes('synthetic_tool'), false);
  assert.equal(rendered.includes('synthetic-call'), false);
});

test('patch completion is an opaque tool-end signal, not format drift', async () => {
  const input = [
    '{"timestamp":"2026-02-02T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-02-02T00:00:01.000Z","type":"response_item","payload":{"type":"function_call","call_id":"patch-call","name":"PATHWATCH_NEVER_EMIT_PATCH_NAME","arguments":"PATHWATCH_NEVER_EMIT_PATCH_ARGUMENTS"}}',
    '{"timestamp":"2026-02-02T00:00:02.000Z","type":"event_msg","payload":{"type":"patch_apply_end","call_id":"patch-call","success":true,"status":"completed","changes":["PATHWATCH_NEVER_EMIT_PATCH_CHANGE"],"stdout":"PATHWATCH_NEVER_EMIT_PATCH_STDOUT","stderr":"PATHWATCH_NEVER_EMIT_PATCH_STDERR"}}',
    '{"timestamp":"2026-02-02T00:00:03.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"patch-call","output":"PATHWATCH_NEVER_EMIT_PATCH_OUTPUT"}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.tools.started, 1);
  assert.equal(report.tools.paired_calls, 1);
  assert.equal(report.tools.end_signals_observed, 1);
  assert.equal(report.data_quality.unknown_counts.subtypes, 0);
  assert.equal(report.data_quality.status, 'complete');
  const endSignal = report.timeline.find((event) => event.kind === 'tool_end_signal');
  assert.equal(endSignal.status, 'end_signal_observed');
  assert.equal(endSignal.tool_ordinal, 1);

  const rendered = `${renderJson(report)}\n${renderMarkdown(report)}`;
  assert.equal(rendered.includes(NEVER_EMIT), false);
  assert.equal(rendered.includes('patch-call'), false);
});

test('future and malformed records stay explicit without stopping the scan', async () => {
  const report = await analyzeFixture('forward-error-tolerance.jsonl');

  assert.equal(report.source.invalid_lines, 1);
  assert.equal(report.context_window.state, 'conflict');
  assert.deepEqual(report.context_window.observed_values, [120000, 130000]);
  assert.equal(report.usage.cumulative_reset_count, 1);
  assert.equal(report.usage.duplicate_cumulative_snapshot_count, 1);
  assert.equal(report.errors.count, 1);
  assert.equal(report.data_quality.status, 'partial');
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'invalid_json'));
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'invalid_usage_counter'));
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'conflicting_context_window'));

  const rendered = renderJson(report);
  assert.equal(rendered.includes(NEVER_EMIT), false);
});

test('unknown subtype groups are counted without emitting their names', async () => {
  const input = [
    '{"timestamp":"2026-04-02T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-04-02T00:00:01.000Z","type":"event_msg","payload":{"type":"PATHWATCH_NEVER_EMIT_EVENT_ALPHA","secret":"PATHWATCH_NEVER_EMIT"}}',
    '{"timestamp":"2026-04-02T00:00:02.000Z","type":"event_msg","payload":{"type":"PATHWATCH_NEVER_EMIT_EVENT_ALPHA","secret":"PATHWATCH_NEVER_EMIT"}}',
    '{"timestamp":"2026-04-02T00:00:03.000Z","type":"event_msg","payload":{"type":"PATHWATCH_NEVER_EMIT_EVENT_BETA","secret":"PATHWATCH_NEVER_EMIT"}}',
    '{"timestamp":"2026-04-02T00:00:04.000Z","type":"response_item","payload":{"type":"PATHWATCH_NEVER_EMIT_RESPONSE_ALPHA","secret":"PATHWATCH_NEVER_EMIT"}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.data_quality.unknown_counts.subtypes, 4);
  assert.equal(report.data_quality.unknown_counts.event_subtype_groups, 2);
  assert.equal(report.data_quality.unknown_counts.response_subtype_groups, 1);
  assert.equal(report.data_quality.status, 'partial');

  const rendered = `${renderJson(report)}\n${renderMarkdown(report)}`;
  assert.equal(rendered.includes(NEVER_EMIT), false);
  assert.equal(rendered.includes('EVENT_ALPHA'), false);
  assert.equal(rendered.includes('RESPONSE_ALPHA'), false);
});

test('an explicit context override is recorded and never inferred from a model name', async () => {
  const report = await analyzeFixture('minimal-lifecycle.jsonl', {
    contextWindowOverride: 200000,
  });

  assert.equal(report.context_window.state, 'override');
  assert.equal(report.context_window.configured_tokens, 200000);
  assert.equal(report.context_window.override_supplied, true);
  assert.deepEqual(report.context_window.observed_values, [100000]);
});

test('BOM and CRLF input remain readable without entering the report', async () => {
  const input = [
    '\uFEFF{"timestamp":"2026-04-01T00:00:00.000Z","type":"session_meta","payload":{"message":"PATHWATCH_NEVER_EMIT_BOM"}}',
    '{"timestamp":"2026-04-01T00:00:01.000Z","type":"event_msg","payload":{"type":"task_started","model_context_window":64000}}',
  ].join('\r\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.source.lines, 2);
  assert.equal(report.source.bytes, Buffer.byteLength(input, 'utf8'));
  assert.equal(report.source.parseable_lines, 2);
  assert.equal(report.context_window.configured_tokens, 64000);
  assert.equal(renderJson(report).includes(NEVER_EMIT), false);
});

test('a legitimate replacement character is valid UTF-8, not a decoder error', async () => {
  const input = [
    '{"timestamp":"2026-04-01T00:00:00.000Z","type":"session_meta","payload":{"message":"legitimate � PATHWATCH_NEVER_EMIT_REPLACEMENT"}}',
    '{"timestamp":"2026-04-01T00:00:01.000Z","type":"event_msg","payload":{"type":"task_started","model_context_window":64000}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.source.invalid_lines, 0);
  assert.equal(report.source.parseable_lines, 2);
  assert.equal(renderJson(report).includes(NEVER_EMIT), false);
});

test('record order is preserved while backwards timestamps produce a quality issue', async () => {
  const input = [
    '{"timestamp":"2026-04-01T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-04-01T00:00:03.000Z","type":"event_msg","payload":{"type":"task_started","model_context_window":64000}}',
    '{"timestamp":"2026-04-01T00:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"PATHWATCH_NEVER_EMIT_TIME","phase":"final"}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.deepEqual(
    report.timeline.map((event) => event.kind),
    ['task_started', 'event_message'],
  );
  assert.equal(report.timeline[1].offset_seconds, -1);
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'timestamp_out_of_order'));
  assert.equal(renderJson(report).includes(NEVER_EMIT), false);
});

test('deep records are skipped without traversing them into output', async () => {
  let nested = { secret: 'PATHWATCH_NEVER_EMIT_DEEP' };
  for (let index = 0; index < 70; index += 1) {
    nested = { nested };
  }
  const line = JSON.stringify({
    timestamp: '2026-04-01T00:00:00.000Z',
    type: 'session_meta',
    payload: nested,
  });
  const report = await analyzeReadable(Readable.from([line]), { sourceKind: 'stdin' });

  assert.equal(report.source.invalid_lines, 1);
  assert.equal(report.data_quality.status, 'unusable');
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'record_too_complex'));
  assert.equal(renderJson(report).includes(NEVER_EMIT), false);
});

test('sparse cumulative snapshots still detect a later counter reset', async () => {
  const input = [
    '{"timestamp":"2026-05-01T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-05-01T00:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100}}}}',
    '{"timestamp":"2026-05-01T00:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"output_tokens":20}}}}',
    '{"timestamp":"2026-05-01T00:00:03.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":90}}}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.usage.cumulative_reset_count, 1);
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'usage_counter_reset'));
});

test('duplicate tool correlation IDs retain an explicit unmatched call', async () => {
  const input = [
    '{"timestamp":"2026-05-01T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-05-01T00:00:01.000Z","type":"response_item","payload":{"type":"function_call","call_id":"same","arguments":"PATHWATCH_NEVER_EMIT_DUPLICATE_A"}}',
    '{"timestamp":"2026-05-01T00:00:02.000Z","type":"response_item","payload":{"type":"function_call","call_id":"same","arguments":"PATHWATCH_NEVER_EMIT_DUPLICATE_B"}}',
    '{"timestamp":"2026-05-01T00:00:03.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"same","output":"PATHWATCH_NEVER_EMIT_DUPLICATE_OUTPUT"}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.tools.started, 2);
  assert.equal(report.tools.paired_calls, 1);
  assert.equal(report.tools.orphaned_calls, 1);
  assert.equal(report.tools.duplicate_correlation_ids, 1);
  assert.equal(renderJson(report).includes(NEVER_EMIT), false);
});

test('a completed correlation ID cannot silently begin a second lifecycle', async () => {
  const input = [
    '{"timestamp":"2026-05-01T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-05-01T00:00:01.000Z","type":"response_item","payload":{"type":"function_call","call_id":"reused","arguments":"PATHWATCH_NEVER_EMIT_REUSE_A"}}',
    '{"timestamp":"2026-05-01T00:00:02.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"reused","output":"PATHWATCH_NEVER_EMIT_REUSE_OUTPUT_A"}}',
    '{"timestamp":"2026-05-01T00:00:03.000Z","type":"response_item","payload":{"type":"function_call","call_id":"reused","arguments":"PATHWATCH_NEVER_EMIT_REUSE_B"}}',
    '{"timestamp":"2026-05-01T00:00:04.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"reused","output":"PATHWATCH_NEVER_EMIT_REUSE_OUTPUT_B"}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.tools.started, 2);
  assert.equal(report.tools.paired_calls, 1);
  assert.equal(report.tools.orphaned_calls, 1);
  assert.equal(report.tools.orphaned_outputs, 1);
  assert.equal(report.tools.duplicate_correlation_ids, 1);
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'duplicate_tool_id'));
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'duplicate_tool_output'));
  assert.equal(renderJson(report).includes(NEVER_EMIT), false);
});

test('a second output for one completed tool remains a duplicate output', async () => {
  const input = [
    '{"timestamp":"2026-05-01T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-05-01T00:00:01.000Z","type":"response_item","payload":{"type":"function_call","call_id":"once","arguments":"PATHWATCH_NEVER_EMIT_OUTPUT_ONCE"}}',
    '{"timestamp":"2026-05-01T00:00:02.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"once","output":"PATHWATCH_NEVER_EMIT_OUTPUT_FIRST"}}',
    '{"timestamp":"2026-05-01T00:00:03.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"once","output":"PATHWATCH_NEVER_EMIT_OUTPUT_SECOND"}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.equal(report.tools.paired_calls, 1);
  assert.equal(report.tools.orphaned_outputs, 1);
  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'duplicate_tool_output'));
  assert.equal(renderJson(report).includes(NEVER_EMIT), false);
});

test('empty supported usage objects create an explicit quality issue', async () => {
  const input = [
    '{"timestamp":"2026-05-01T00:00:00.000Z","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-05-01T00:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{}}}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.ok(
    report.data_quality.issues.some(
      (issue) => issue.code === 'empty_or_unknown_usage_snapshot',
    ),
  );
  assert.equal(report.data_quality.status, 'partial');
});

test('timezone-less timestamps are rejected deterministically', async () => {
  const input = [
    '{"timestamp":"2026-05-01 00:00:00","type":"session_meta","payload":{}}',
    '{"timestamp":"2026-05-01T00:00:01.000Z","type":"event_msg","payload":{"type":"task_started","model_context_window":64000}}',
  ].join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });

  assert.ok(report.data_quality.issues.some((issue) => issue.code === 'invalid_timestamp'));
});

test('invalid calendar dates are not normalized into valid timestamps', async () => {
  for (const timestamp of ['2026-02-30T00:00:00Z', '2026-04-31T12:00:00+00:00']) {
    const input = [
      `{"timestamp":"${timestamp}","type":"session_meta","payload":{}}`,
      '{"timestamp":"2026-05-01T00:00:01.000Z","type":"event_msg","payload":{"type":"task_started","model_context_window":64000}}',
    ].join('\n');
    const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });
    assert.ok(report.data_quality.issues.some((issue) => issue.code === 'invalid_timestamp'));
  }
});

test('post-read issues remain inside the bounded schema issue list', async () => {
  const lines = [];
  for (let index = 0; index < 300; index += 1) {
    lines.push('{"type":"session_meta","payload":{}}');
  }
  const report = await analyzeReadable(Readable.from([lines.join('\n')]), {
    sourceKind: 'stdin',
  });
  assert.equal(report.data_quality.issues.length, 257);
  const before = report.data_quality.issues.find(
    (issue) => issue.code === 'issue_list_truncated',
  ).count;

  appendQualityIssue(report, {
    code: 'input_changed_during_read',
    severity: 'warning',
    line: null,
    detail_safe: 'The explicit input changed while it was being read.',
  });

  assert.equal(report.data_quality.issues.length, 257);
  const after = report.data_quality.issues.find(
    (issue) => issue.code === 'issue_list_truncated',
  ).count;
  assert.equal(after, before + 1);
});
