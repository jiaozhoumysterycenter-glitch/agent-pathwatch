function display(value) {
  return value === null || value === undefined ? 'unknown' : String(value);
}

function markdownCell(value) {
  return display(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

function boolWord(value) {
  return value ? 'yes' : 'no';
}

function usageRows(snapshot) {
  return Object.entries(snapshot.values).map(
    ([field, value]) => `| ${field} | ${markdownCell(value)} |`,
  );
}

function histogramRows(histogram) {
  const entries = Object.entries(histogram);
  if (entries.length === 0) {
    return ['| none | 0 |'];
  }
  return entries.map(([name, count]) => `| ${markdownCell(name)} | ${count} |`);
}

function timelineDetail(event) {
  const parts = [];
  if ('role' in event) parts.push(`role=${event.role}`);
  if ('phase' in event) parts.push(`phase=${event.phase}`);
  if ('status' in event) parts.push(`status=${event.status}`);
  if ('tool_ordinal' in event) parts.push(`tool=${display(event.tool_ordinal)}`);
  if ('context_window' in event) parts.push(`context=${display(event.context_window)}`);
  if ('last_total_tokens' in event) parts.push(`last_total=${display(event.last_total_tokens)}`);
  if ('cumulative_total_tokens' in event) {
    parts.push(`cumulative_total=${display(event.cumulative_total_tokens)}`);
  }
  return parts.join(', ') || '—';
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

export function renderMarkdown(report) {
  const lines = [
    '# Agent Pathwatch report',
    '',
    '> Content-silent local report. Message text, reasoning, tool data, paths, and IDs were not emitted.',
    '',
    '## Source',
    '',
    '| Field | Value |',
    '| --- | ---: |',
    `| Label | ${report.source.label} |`,
    `| Kind | ${report.source.kind} |`,
    `| Bytes | ${report.source.bytes} |`,
    `| Lines | ${report.source.lines} |`,
    `| Parseable lines | ${report.source.parseable_lines} |`,
    `| Invalid lines | ${report.source.invalid_lines} |`,
    `| Oversized lines | ${report.source.oversized_lines} |`,
    '',
    '## Adapter',
    '',
    `- ID: \`${report.adapter.id}\``,
    `- Version: \`${report.adapter.version}\``,
    `- Match: \`${report.adapter.match_state}\``,
    `- Recognized records: ${report.adapter.recognized_record_count}`,
    '- Boundary: observed format support; not an official schema contract.',
    '',
    '## Context window',
    '',
    `- State: \`${report.context_window.state}\``,
    `- Configured tokens: ${display(report.context_window.configured_tokens)}`,
    `- Observed values: ${
      report.context_window.observed_values.length > 0
        ? report.context_window.observed_values.join(', ')
        : 'none'
    }`,
    `- Explicit override: ${boolWord(report.context_window.override_supplied)}`,
    '',
    '## Latest last-token snapshot',
    '',
    `Semantics: \`${report.usage.last_snapshot.semantics}\`; evidence line: ${display(
      report.usage.last_snapshot.evidence_line,
    )}.`,
    '',
    '| Counter | Value |',
    '| --- | ---: |',
    ...usageRows(report.usage.last_snapshot),
    '',
    '## Latest cumulative snapshot',
    '',
    `Semantics: \`${report.usage.cumulative_snapshot.semantics}\`; evidence line: ${display(
      report.usage.cumulative_snapshot.evidence_line,
    )}.`,
    '',
    '| Counter | Value |',
    '| --- | ---: |',
    ...usageRows(report.usage.cumulative_snapshot),
    '',
    `Observed cumulative snapshots: ${report.usage.cumulative_snapshot_count}; duplicate snapshots: ${report.usage.duplicate_cumulative_snapshot_count}; resets: ${report.usage.cumulative_reset_count}.`,
    '',
    'No price or billable-token total was inferred.',
    '',
    '## Activity',
    '',
    '| Wrapper | Count |',
    '| --- | ---: |',
    ...histogramRows(report.activity.record_counts),
    '',
    `Messages: event=${report.activity.messages.event_messages}, response=${report.activity.messages.response_messages}, cross-agent=${report.activity.messages.cross_agent_messages}.`,
    '',
    `Reasoning records: ${report.activity.reasoning_records}; content blocks counted: ${report.activity.content_blocks}; unknown content blocks: ${report.activity.unknown_content_blocks}.`,
    '',
    '### Roles',
    '',
    '| Role | Count |',
    '| --- | ---: |',
    ...histogramRows(report.activity.messages.by_role),
    '',
    '### Phases',
    '',
    '| Phase | Count |',
    '| --- | ---: |',
    ...histogramRows(report.activity.messages.by_phase),
    '',
    '## Tool activity',
    '',
    `Started: ${report.tools.started}; outputs observed: ${report.tools.outputs_observed}; paired calls: ${report.tools.paired_calls}; orphaned calls: ${report.tools.orphaned_calls}; orphaned outputs: ${report.tools.orphaned_outputs}.`,
    '',
    'Tool names, arguments, and results were not emitted.',
    '',
    '| Status | Count |',
    '| --- | ---: |',
    ...histogramRows(report.tools.status_histogram),
    '',
    '## Error activity',
    '',
    `Observed: ${boolWord(report.errors.activity)}; count: ${report.errors.count}; raw text emitted: ${boolWord(
      report.errors.raw_text_emitted,
    )}.`,
    '',
    '## Safe timeline',
    '',
    '| Sequence | Source line | Offset (s) | Kind | Safe detail |',
    '| ---: | ---: | ---: | --- | --- |',
  ];

  if (report.timeline.length === 0) {
    lines.push('| — | — | — | none | — |');
  } else {
    for (const event of report.timeline) {
      lines.push(
        `| ${event.sequence} | ${event.line} | ${display(event.offset_seconds)} | ${markdownCell(
          event.kind,
        )} | ${markdownCell(timelineDetail(event))} |`,
      );
    }
  }

  lines.push(
    '',
    '## Data quality',
    '',
    `Status: \`${report.data_quality.status}\`; issues: ${report.data_quality.issue_count}.`,
    '',
    '| Severity | Code | Line | Count | Safe detail |',
    '| --- | --- | ---: | ---: | --- |',
  );

  if (report.data_quality.issues.length === 0) {
    lines.push('| info | none | — | 0 | No quality issues observed. |');
  } else {
    for (const issue of report.data_quality.issues) {
      lines.push(
        `| ${markdownCell(issue.severity)} | ${markdownCell(issue.code)} | ${display(
          issue.line,
        )} | ${issue.count} | ${markdownCell(issue.detail_safe)} |`,
      );
    }
  }

  lines.push(
    '',
    '## Privacy posture',
    '',
    `- Explicit input only: ${boolWord(report.privacy.explicit_input_only)}`,
    `- Network access: ${boolWord(report.privacy.network_access)}`,
    `- Telemetry: ${boolWord(report.privacy.telemetry)}`,
    `- Cache written: ${boolWord(report.privacy.cache_written)}`,
    `- Raw-value passthrough: ${boolWord(report.privacy.raw_values_passthrough)}`,
  );

  return lines.join('\n');
}

export function renderAdapters(descriptors, format) {
  if (format === 'json') {
    return JSON.stringify({ adapters: descriptors }, null, 2);
  }

  const lines = [
    '# Agent Pathwatch adapters',
    '',
    '| ID | Version | Official schema contract | Description |',
    '| --- | --- | --- | --- |',
  ];
  for (const descriptor of descriptors) {
    lines.push(
      `| ${descriptor.id} | ${descriptor.version} | ${boolWord(
        descriptor.official_schema_contract,
      )} | ${markdownCell(descriptor.description)} |`,
    );
  }
  return lines.join('\n');
}
