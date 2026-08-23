import { createCodexObservedAdapter } from './adapters/codex-observed-v1.mjs';
import { PathwatchError } from './errors.mjs';

const REPORT_SCHEMA = 'pathwatch.report/v0.1';
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_OBJECT_DEPTH = 64;
const MAX_OBJECT_NODES = 50_000;
const MAX_JSON_STRUCTURAL_TOKENS = 100_000;
const MAX_ISSUE_SHAPES = 256;

async function* boundedUtf8Lines(stream, onBytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let lineBuffer = Buffer.alloc(0);
  let bufferedBytes = 0;
  let droppingOversizedLine = false;
  let lineNumber = 0;

  function ensureCapacity(required) {
    if (lineBuffer.length >= required) return;
    let capacity = Math.max(4_096, lineBuffer.length || 0);
    while (capacity < required) {
      capacity = Math.min(MAX_LINE_BYTES, capacity * 2);
    }
    const grown = Buffer.allocUnsafe(capacity);
    if (bufferedBytes > 0) {
      lineBuffer.copy(grown, 0, 0, bufferedBytes);
    }
    lineBuffer = grown;
  }

  function finishLine(segment) {
    lineNumber += 1;
    if (droppingOversizedLine || bufferedBytes + segment.length > MAX_LINE_BYTES) {
      lineBuffer = Buffer.alloc(0);
      bufferedBytes = 0;
      droppingOversizedLine = false;
      return { lineNumber, oversized: true, invalidUtf8: false, text: null };
    }

    if (segment.length > 0) {
      ensureCapacity(bufferedBytes + segment.length);
      segment.copy(lineBuffer, bufferedBytes);
      bufferedBytes += segment.length;
    }
    let bytes = lineBuffer.subarray(0, bufferedBytes);
    lineBuffer = Buffer.alloc(0);
    bufferedBytes = 0;
    droppingOversizedLine = false;
    if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0d) {
      bytes = bytes.subarray(0, bytes.length - 1);
    }

    try {
      return {
        lineNumber,
        oversized: false,
        invalidUtf8: false,
        text: decoder.decode(bytes),
      };
    } catch {
      return { lineNumber, oversized: false, invalidUtf8: true, text: null };
    }
  }

  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    onBytes(chunk.length);
    let start = 0;

    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      yield finishLine(chunk.subarray(start, index));
      start = index + 1;
    }

    if (start >= chunk.length || droppingOversizedLine) {
      continue;
    }

    const remainder = chunk.subarray(start);
    if (bufferedBytes + remainder.length > MAX_LINE_BYTES) {
      lineBuffer = Buffer.alloc(0);
      bufferedBytes = 0;
      droppingOversizedLine = true;
    } else if (remainder.length > 0) {
      ensureCapacity(bufferedBytes + remainder.length);
      remainder.copy(lineBuffer, bufferedBytes);
      bufferedBytes += remainder.length;
    }
  }

  if (droppingOversizedLine) {
    lineNumber += 1;
    yield { lineNumber, oversized: true, invalidUtf8: false, text: null };
  } else if (bufferedBytes > 0) {
    yield finishLine(Buffer.alloc(0));
  }
}

function exceedsJsonStructuralBudget(text) {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let tokens = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (code === 0x5c) {
        escaped = true;
      } else if (code === 0x22) {
        inString = false;
      }
      continue;
    }

    if (code === 0x22) {
      inString = true;
      continue;
    }
    if (code === 0x7b || code === 0x5b) {
      depth += 1;
      tokens += 1;
      if (depth > MAX_OBJECT_DEPTH) return true;
    } else if (code === 0x7d || code === 0x5d) {
      depth -= 1;
      tokens += 1;
    } else if (code === 0x2c || code === 0x3a) {
      tokens += 1;
    }
    if (tokens > MAX_JSON_STRUCTURAL_TOKENS) return true;
  }

  return false;
}

function createIssueCollector() {
  const issues = new Map();
  let overflowCount = 0;

  function add(code, severity, line, detailSafe) {
    const safeLine = Number.isSafeInteger(line) && line > 0 ? line : null;
    const key = `${code}|${severity}|${safeLine ?? ''}|${detailSafe}`;
    if (issues.has(key)) {
      issues.get(key).count += 1;
      return;
    }
    if (issues.size >= MAX_ISSUE_SHAPES) {
      overflowCount += 1;
      return;
    }
    issues.set(key, {
      code,
      severity,
      line: safeLine,
      count: 1,
      detail_safe: detailSafe,
    });
  }

  function list() {
    const result = [...issues.values()];
    if (overflowCount > 0) {
      result.push({
        code: 'issue_list_truncated',
        severity: 'warning',
        line: null,
        count: overflowCount,
        detail_safe: 'Additional issue shapes were counted but not individually listed.',
      });
    }
    return result;
  }

  return { add, list };
}

function parseTimestamp(value, line, addIssue) {
  if (typeof value !== 'string') {
    addIssue(
      'missing_timestamp',
      'info',
      line,
      'A parsed record did not contain an ISO timestamp string.',
    );
    return null;
  }
  const zonedIso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
  const match = value.match(zonedIso);
  if (!match) {
    addIssue(
      'invalid_timestamp',
      'warning',
      line,
      'A timestamp was not an explicit ISO date-time with a timezone.',
    );
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8];
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let calendarValid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysByMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59;

  if (zone !== 'Z') {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    calendarValid = calendarValid && zoneHour <= 23 && zoneMinute <= 59;
  }

  if (!calendarValid) {
    addIssue(
      'invalid_timestamp',
      'warning',
      line,
      'A timestamp contained an invalid calendar or clock component.',
    );
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addIssue(
      'invalid_timestamp',
      'warning',
      line,
      'A timestamp string could not be parsed.',
    );
    return null;
  }
  return parsed;
}

function exceedsComplexityLimit(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;

  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_OBJECT_NODES || depth > MAX_OBJECT_DEPTH) {
      return true;
    }
    if (value === null || typeof value !== 'object') {
      continue;
    }
    if (Array.isArray(value)) {
      if (nodes + stack.length + value.length > MAX_OBJECT_NODES) return true;
      for (const child of value) {
        stack.push({ value: child, depth: depth + 1 });
      }
      continue;
    }
    const children = Object.values(value);
    if (nodes + stack.length + children.length > MAX_OBJECT_NODES) return true;
    for (const child of children) {
      stack.push({ value: child, depth: depth + 1 });
    }
  }

  return false;
}

function qualityStatus(report) {
  if (
    report.source.parseable_lines === 0 ||
    report.adapter.match_state !== 'matched'
  ) {
    return 'unusable';
  }

  const hasWarning = report.data_quality.issues.some((issue) =>
    ['warning', 'error'].includes(issue.severity),
  );
  const hasUnknown = Object.values(report.data_quality.unknown_counts).some((value) => value > 0);
  const hasInvalid = report.source.invalid_lines > 0 || report.source.oversized_lines > 0;
  return hasWarning || hasUnknown || hasInvalid ? 'partial' : 'complete';
}

function recomputeQuality(report) {
  report.data_quality.issue_count = report.data_quality.issues.reduce(
    (sum, issue) => sum + issue.count,
    0,
  );
  report.data_quality.status = qualityStatus(report);
  return report;
}

export async function analyzeReadable(
  stream,
  {
    adapterId = 'auto',
    contextWindowOverride = null,
    sourceKind = 'regular-file',
    sourceBytes = null,
  } = {},
) {
  if (!['auto', 'codex-observed-v1'].includes(adapterId)) {
    throw new PathwatchError(
      'PATHWATCH_E_ADAPTER_UNKNOWN',
      'The requested adapter is not built into this release.',
      3,
    );
  }

  const issueCollector = createIssueCollector();
  const adapter = createCodexObservedAdapter({
    addIssue: issueCollector.add,
    contextWindowOverride,
  });

  let lineNumber = 0;
  let blankLines = 0;
  let invalidLines = 0;
  let oversizedLines = 0;
  let parseableLines = 0;
  let decodedBytes = 0;

  const lines = boundedUtf8Lines(stream, (bytes) => {
    decodedBytes += bytes;
  });

  for await (const item of lines) {
    lineNumber = item.lineNumber;

    if (item.oversized) {
      oversizedLines += 1;
      issueCollector.add(
        'line_too_large',
        'warning',
        lineNumber,
        'A source line exceeded the bounded byte limit and was skipped.',
      );
      continue;
    }

    if (item.invalidUtf8) {
      invalidLines += 1;
      issueCollector.add(
        'invalid_utf8',
        'warning',
        lineNumber,
        'A source line was not valid UTF-8 and was skipped.',
      );
      continue;
    }

    let line = item.text;

    if (lineNumber === 1 && line.startsWith('\uFEFF')) {
      line = line.slice(1);
    }

    if (line.trim() === '') {
      blankLines += 1;
      continue;
    }

    if (exceedsJsonStructuralBudget(line)) {
      invalidLines += 1;
      issueCollector.add(
        'record_too_complex',
        'warning',
        lineNumber,
        'A source record exceeded the bounded structural token budget and was skipped.',
      );
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      invalidLines += 1;
      issueCollector.add(
        'invalid_json',
        'warning',
        lineNumber,
        'A source line was not valid JSON and was skipped.',
      );
      continue;
    }

    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      invalidLines += 1;
      issueCollector.add(
        'non_object_record',
        'warning',
        lineNumber,
        'A parsed JSON value was not an object and was skipped.',
      );
      continue;
    }

    if (exceedsComplexityLimit(record)) {
      invalidLines += 1;
      issueCollector.add(
        'record_too_complex',
        'warning',
        lineNumber,
        'A parsed record exceeded the bounded depth or node limit and was skipped.',
      );
      continue;
    }

    parseableLines += 1;
    const timestampMs = parseTimestamp(record.timestamp, lineNumber, issueCollector.add);
    adapter.consume(record, lineNumber, timestampMs);
    record = null;
    line = '';
  }

  const adapterResult = adapter.finish();
  if (
    adapterResult.unknown_counts.wrappers > 0 ||
    adapterResult.unknown_counts.subtypes > 0 ||
    adapterResult.unknown_counts.content_blocks > 0
  ) {
    issueCollector.add(
      'unknown_record_shape',
      'info',
      null,
      'Unknown wrappers, subtypes, or content blocks were counted and skipped.',
    );
  }

  const report = {
    schema: REPORT_SCHEMA,
    source: {
      label: 'source-1',
      kind: sourceKind,
      bytes: sourceBytes ?? decodedBytes,
      lines: lineNumber,
      blank_lines: blankLines,
      parseable_lines: parseableLines,
      invalid_lines: invalidLines,
      oversized_lines: oversizedLines,
      path_emitted: false,
      filename_emitted: false,
      content_emitted: false,
    },
    adapter: adapterResult.adapter,
    context_window: adapterResult.context_window,
    usage: adapterResult.usage,
    activity: adapterResult.activity,
    tools: adapterResult.tools,
    errors: adapterResult.errors,
    timeline: adapterResult.timeline,
    data_quality: {
      status: 'complete',
      issue_count: 0,
      issues: issueCollector.list(),
      unknown_counts: adapterResult.unknown_counts,
    },
    privacy: {
      explicit_input_only: true,
      network_access: false,
      telemetry: false,
      cache_written: false,
      raw_values_passthrough: false,
    },
  };

  return recomputeQuality(report);
}

export function appendQualityIssue(report, issue) {
  const normalized = {
    code: issue.code,
    severity: issue.severity,
    line: Number.isSafeInteger(issue.line) ? issue.line : null,
    count: Number.isSafeInteger(issue.count) && issue.count > 0 ? issue.count : 1,
    detail_safe: issue.detail_safe,
  };
  const matching = report.data_quality.issues.find(
    (existing) =>
      existing.code === normalized.code &&
      existing.severity === normalized.severity &&
      existing.line === normalized.line &&
      existing.detail_safe === normalized.detail_safe,
  );
  if (matching) {
    matching.count += normalized.count;
  } else if (report.data_quality.issues.length < MAX_ISSUE_SHAPES + 1) {
    report.data_quality.issues.push(normalized);
  } else {
    let overflow = report.data_quality.issues.find(
      (existing) => existing.code === 'issue_list_truncated',
    );
    if (!overflow) {
      overflow = {
        code: 'issue_list_truncated',
        severity: 'warning',
        line: null,
        count: 0,
        detail_safe: 'Additional issue shapes were counted but not individually listed.',
      };
      report.data_quality.issues[report.data_quality.issues.length - 1] = overflow;
    }
    overflow.count += normalized.count;
  }
  return recomputeQuality(report);
}
