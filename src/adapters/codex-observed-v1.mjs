import { createHash } from 'node:crypto';

const ADAPTER_ID = 'codex-observed-v1';
const ADAPTER_VERSION = '0.1.0';
const MAX_TIMELINE_EVENTS = 2_000;
const MAX_CONTEXT_VALUES = 32;
const MAX_TOOL_CORRELATIONS = 20_000;
const MAX_COMPLETED_TOOL_CORRELATIONS = 20_000;
const MAX_TOOL_CORRELATION_BYTES = 512;

const KNOWN_WRAPPERS = [
  'session_meta',
  'turn_context',
  'world_state',
  'inter_agent_communication_metadata',
  'event_msg',
  'response_item',
  'compacted',
];

const USAGE_FIELDS = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'total_tokens',
];

const SAFE_ROLES = new Set(['user', 'assistant', 'system', 'developer', 'tool']);
const SAFE_PHASES = new Set(['analysis', 'commentary', 'final', 'summary']);
const SAFE_TOOL_STATUSES = new Set([
  'started',
  'in_progress',
  'completed',
  'success',
  'failed',
  'error',
  'cancelled',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function blankUsage() {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, null]));
}

function safePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeRole(value) {
  return typeof value === 'string' && SAFE_ROLES.has(value) ? value : 'other';
}

function normalizePhase(value) {
  if (value === undefined || value === null || value === '') {
    return 'none';
  }
  if (value === 'final_answer') {
    return 'final';
  }
  return typeof value === 'string' && SAFE_PHASES.has(value) ? value : 'other';
}

function normalizeToolStatus(value) {
  if (typeof value !== 'string' || !SAFE_TOOL_STATUSES.has(value)) {
    return 'unknown';
  }
  if (value === 'success') {
    return 'completed';
  }
  if (value === 'error') {
    return 'failed';
  }
  return value;
}

function looksErrorShaped(payload, subtype) {
  if (typeof subtype === 'string' && /(error|exception|fail)/i.test(subtype)) {
    return true;
  }
  if (!isObject(payload)) {
    return false;
  }
  return Object.keys(payload).some((key) => /(error|exception|failure|stack|cause)/i.test(key));
}

function sortedHistogram(histogram) {
  return Object.fromEntries(
    Object.entries(histogram)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function correlationDigest(rawId) {
  return createHash('sha256').update(rawId, 'utf8').digest('hex');
}

export function createCodexObservedAdapter({ addIssue, contextWindowOverride = null } = {}) {
  const wrapperCounts = Object.fromEntries(KNOWN_WRAPPERS.map((wrapper) => [wrapper, 0]));
  const roleCounts = Object.fromEntries([...SAFE_ROLES, 'other'].map((role) => [role, 0]));
  const phaseCounts = Object.fromEntries(
    [...SAFE_PHASES, 'none', 'other'].map((phase) => [phase, 0]),
  );

  let recognizedRecordCount = 0;
  let unknownWrapperCount = 0;
  let unknownSubtypeCount = 0;
  let unknownContentBlockCount = 0;
  const unknownEventSubtypeDigests = new Set();
  const unknownResponseSubtypeDigests = new Set();
  let contentBlockCount = 0;
  let eventMessageCount = 0;
  let responseMessageCount = 0;
  let crossAgentMessageCount = 0;
  let reasoningRecordCount = 0;
  let worldStateRecordCount = 0;
  let interAgentRecordCount = 0;
  let taskStartedCount = 0;
  let taskCompletedCount = 0;
  let turnAbortedCount = 0;
  let contextCompactedCount = 0;
  let threadRolledBackCount = 0;
  let threadSettingsAppliedCount = 0;
  let errorActivityCount = 0;

  let contextEvidenceCount = 0;
  let contextEvidenceFirstLine = null;
  let contextEvidenceLastLine = null;
  const contextEvidenceRules = new Set();
  const contextValues = new Set();
  let contextValueLimitReported = false;

  let latestLastUsage = blankUsage();
  let latestLastUsageLine = null;
  let latestTotalUsage = blankUsage();
  let latestTotalUsageLine = null;
  let cumulativeLastSeen = blankUsage();
  let cumulativeSnapshotSeen = false;
  let totalSnapshotCount = 0;
  let lastSnapshotCount = 0;
  let duplicateTotalSnapshotCount = 0;
  let totalCounterResetCount = 0;

  const outstandingToolCallsByDigest = new Map();
  const completedToolCallsByDigest = new Map();
  let nextToolOrdinal = 1;
  let toolsStarted = 0;
  let toolOutputs = 0;
  let pairedToolCalls = 0;
  let unidentifiedToolCalls = 0;
  let orphanedToolOutputs = 0;
  let duplicateToolIds = 0;
  let duplicateUnpairableToolCalls = 0;
  let toolEndSignalCount = 0;
  let toolCorrelationLimitReported = false;
  let toolCorrelationLengthReported = false;
  let completedToolWindowEvictionReported = false;
  const toolStatusHistogram = {};

  const timeline = [];
  let timelineDropped = 0;

  function addTimeline(kind, line, timestampMs, detail = {}) {
    if (timeline.length >= MAX_TIMELINE_EVENTS) {
      timelineDropped += 1;
      return;
    }
    timeline.push({
      sequence: timeline.length + 1,
      line,
      kind,
      timestampMs,
      ...detail,
    });
  }

  function observeUnknownSubtype(wrapper, subtype) {
    unknownSubtypeCount += 1;
    const raw = typeof subtype === 'string' ? subtype : '<missing>';
    const digest = createHash('sha256').update(`${wrapper}\u0000${raw}`, 'utf8').digest('hex');
    if (wrapper === 'event_msg') {
      unknownEventSubtypeDigests.add(digest);
    } else if (wrapper === 'response_item') {
      unknownResponseSubtypeDigests.add(digest);
    }
  }

  function addContextValue(value, line, rule) {
    const safe = safePositiveInteger(value);
    if (safe === null) {
      if (value !== undefined && value !== null) {
        addIssue(
          'invalid_context_window',
          'warning',
          line,
          'A context-window value was present but was not a positive safe integer.',
        );
      }
      return;
    }

    contextEvidenceCount += 1;
    contextEvidenceFirstLine ??= line;
    contextEvidenceLastLine = line;
    contextEvidenceRules.add(rule);

    if (!contextValues.has(safe) && contextValues.size >= MAX_CONTEXT_VALUES) {
      if (!contextValueLimitReported) {
        contextValueLimitReported = true;
        addIssue(
          'context_value_limit',
          'warning',
          null,
          'The bounded set of distinct context-window values reached its limit.',
        );
      }
      return;
    }
    contextValues.add(safe);
  }

  function sanitizeUsage(value, line, kind) {
    if (!isObject(value)) {
      return null;
    }

    const snapshot = blankUsage();
    let observed = 0;
    for (const field of USAGE_FIELDS) {
      if (!(field in value)) {
        continue;
      }
      const candidate = value[field];
      if (!Number.isSafeInteger(candidate) || candidate < 0) {
        addIssue(
          'invalid_usage_counter',
          'warning',
          line,
          `A ${kind} token counter was present but was not a non-negative safe integer.`,
        );
        continue;
      }
      snapshot[field] = candidate;
      observed += 1;
    }

    if (observed === 0) {
      addIssue(
        'empty_or_unknown_usage_snapshot',
        'warning',
        line,
        `A ${kind} token snapshot contained no supported counters.`,
      );
      return null;
    }

    return snapshot;
  }

  function observeTotalUsage(snapshot, line) {
    totalSnapshotCount += 1;
    const providedFields = USAGE_FIELDS.filter((field) => snapshot[field] !== null);
    if (
      cumulativeSnapshotSeen &&
      providedFields.length > 0 &&
      providedFields.every((field) => cumulativeLastSeen[field] === snapshot[field])
    ) {
      duplicateTotalSnapshotCount += 1;
    }

    if (cumulativeSnapshotSeen) {
      const reset = providedFields.some((field) => {
        const previous = cumulativeLastSeen[field];
        const current = snapshot[field];
        return previous !== null && current !== null && current < previous;
      });
      if (reset) {
        totalCounterResetCount += 1;
        addIssue(
          'usage_counter_reset',
          'warning',
          line,
          'A cumulative token snapshot decreased relative to the prior observed snapshot.',
        );
        cumulativeLastSeen = blankUsage();
      }
    }

    for (const field of providedFields) {
      cumulativeLastSeen[field] = snapshot[field];
    }
    cumulativeSnapshotSeen = true;
    latestTotalUsage = snapshot;
    latestTotalUsageLine = line;
  }

  function observeContentBlocks(content) {
    if (!Array.isArray(content)) {
      return;
    }
    for (const block of content) {
      contentBlockCount += 1;
      const type = isObject(block) ? block.type : null;
      if (
        !['input_text', 'output_text', 'input_image', 'encrypted_content', 'summary_text'].includes(
          type,
        )
      ) {
        unknownContentBlockCount += 1;
      }
    }
  }

  function recordErrorActivity(line, timestampMs, kind = 'error_activity') {
    errorActivityCount += 1;
    addTimeline(kind, line, timestampMs);
  }

  function rememberCompletedTool(digest, ordinal) {
    if (
      !completedToolCallsByDigest.has(digest) &&
      completedToolCallsByDigest.size >= MAX_COMPLETED_TOOL_CORRELATIONS
    ) {
      const oldest = completedToolCallsByDigest.keys().next().value;
      completedToolCallsByDigest.delete(oldest);
      if (!completedToolWindowEvictionReported) {
        completedToolWindowEvictionReported = true;
        addIssue(
          'completed_tool_correlation_window_evicted',
          'warning',
          null,
          'The bounded completed-tool correlation window evicted its oldest entry.',
        );
      }
    }
    completedToolCallsByDigest.set(digest, ordinal);
  }

  function observeToolCall(payload, line, timestampMs) {
    toolsStarted += 1;
    const status = normalizeToolStatus(payload.status);
    toolStatusHistogram[status] = (toolStatusHistogram[status] ?? 0) + 1;
    if (status === 'failed') {
      recordErrorActivity(line, timestampMs, 'tool_error');
    }

    const rawId =
      typeof payload.call_id === 'string'
        ? payload.call_id
        : typeof payload.id === 'string'
          ? payload.id
          : null;

    let ordinal = null;
    if (rawId === null) {
      unidentifiedToolCalls += 1;
    } else if (Buffer.byteLength(rawId, 'utf8') > MAX_TOOL_CORRELATION_BYTES) {
      unidentifiedToolCalls += 1;
      if (!toolCorrelationLengthReported) {
        toolCorrelationLengthReported = true;
        addIssue(
          'tool_correlation_id_too_large',
          'warning',
          null,
          'A tool correlation identifier exceeded the bounded byte limit and was not retained.',
        );
      }
    } else {
      const digest = correlationDigest(rawId);
      if (outstandingToolCallsByDigest.has(digest)) {
        duplicateToolIds += 1;
        duplicateUnpairableToolCalls += 1;
        ordinal = outstandingToolCallsByDigest.get(digest).ordinal;
        addIssue(
          'duplicate_tool_id',
          'warning',
          line,
          'A tool correlation identifier appeared more than once.',
        );
      } else if (completedToolCallsByDigest.has(digest)) {
        duplicateToolIds += 1;
        duplicateUnpairableToolCalls += 1;
        ordinal = completedToolCallsByDigest.get(digest);
        addIssue(
          'duplicate_tool_id',
          'warning',
          line,
          'A tool correlation identifier appeared again after completion.',
        );
      } else if (outstandingToolCallsByDigest.size >= MAX_TOOL_CORRELATIONS) {
        unidentifiedToolCalls += 1;
        if (!toolCorrelationLimitReported) {
          toolCorrelationLimitReported = true;
          addIssue(
            'tool_correlation_limit',
            'warning',
            null,
            'The bounded tool-correlation table reached its limit.',
          );
        }
      } else {
        ordinal = nextToolOrdinal;
        nextToolOrdinal += 1;
        outstandingToolCallsByDigest.set(digest, { ordinal });
      }
    }

    addTimeline('tool_start', line, timestampMs, {
      tool_ordinal: ordinal,
      status,
    });
  }

  function observeToolOutput(payload, line, timestampMs) {
    toolOutputs += 1;
    const rawId =
      typeof payload.call_id === 'string'
        ? payload.call_id
        : typeof payload.id === 'string'
          ? payload.id
          : null;

    let ordinal = null;
    const digest =
      rawId !== null && Buffer.byteLength(rawId, 'utf8') <= MAX_TOOL_CORRELATION_BYTES
        ? correlationDigest(rawId)
        : null;
    if (digest !== null && outstandingToolCallsByDigest.has(digest)) {
      const entry = outstandingToolCallsByDigest.get(digest);
      ordinal = entry.ordinal;
      pairedToolCalls += 1;
      outstandingToolCallsByDigest.delete(digest);
      rememberCompletedTool(digest, ordinal);
    } else if (digest !== null && completedToolCallsByDigest.has(digest)) {
      ordinal = completedToolCallsByDigest.get(digest);
      orphanedToolOutputs += 1;
      addIssue(
        'duplicate_tool_output',
        'warning',
        line,
        'More than one output record referred to the same completed tool call.',
      );
    } else {
      orphanedToolOutputs += 1;
      addIssue(
        'orphaned_tool_output',
        'warning',
        line,
        'A tool output had no preceding observed tool call.',
      );
    }

    addTimeline('tool_output', line, timestampMs, {
      tool_ordinal: ordinal,
      status: 'output_observed',
    });
  }

  function observeToolEndSignal(payload, line, timestampMs, kind) {
    toolEndSignalCount += 1;
    const rawId = typeof payload.call_id === 'string' ? payload.call_id : null;
    const digest =
      rawId !== null && Buffer.byteLength(rawId, 'utf8') <= MAX_TOOL_CORRELATION_BYTES
        ? correlationDigest(rawId)
        : null;
    const ordinal =
      digest === null
        ? null
        : (outstandingToolCallsByDigest.get(digest)?.ordinal ??
          completedToolCallsByDigest.get(digest) ??
          null);
    addTimeline(kind, line, timestampMs, {
      tool_ordinal: ordinal,
      status: 'end_signal_observed',
    });
  }

  function consumeEventMessage(payload, line, timestampMs) {
    if (!isObject(payload) || typeof payload.type !== 'string') {
      observeUnknownSubtype('event_msg', null);
      addIssue(
        'missing_event_subtype',
        'warning',
        line,
        'An event message did not contain a usable subtype.',
      );
      return;
    }

    switch (payload.type) {
      case 'task_started': {
        taskStartedCount += 1;
        addContextValue(payload.model_context_window, line, 'event_msg.task_started');
        addTimeline('task_started', line, timestampMs, {
          context_window: safePositiveInteger(payload.model_context_window),
        });
        break;
      }
      case 'task_complete': {
        taskCompletedCount += 1;
        addTimeline('task_complete', line, timestampMs);
        break;
      }
      case 'turn_aborted': {
        turnAbortedCount += 1;
        addTimeline('turn_aborted', line, timestampMs);
        break;
      }
      case 'stream_error': {
        recordErrorActivity(line, timestampMs, 'stream_error');
        break;
      }
      case 'agent_message': {
        eventMessageCount += 1;
        roleCounts.assistant += 1;
        const phase = normalizePhase(payload.phase);
        phaseCounts[phase] += 1;
        addTimeline('event_message', line, timestampMs, { phase });
        break;
      }
      case 'user_message': {
        eventMessageCount += 1;
        roleCounts.user += 1;
        phaseCounts.none += 1;
        addTimeline('event_message', line, timestampMs, { role: 'user', phase: 'none' });
        break;
      }
      case 'agent_reasoning': {
        reasoningRecordCount += 1;
        addTimeline('reasoning', line, timestampMs);
        break;
      }
      case 'token_count': {
        const info = isObject(payload.info) ? payload.info : null;
        if (!info) {
          addIssue(
            'missing_token_info',
            'warning',
            line,
            'A token-count record did not contain a usable info object.',
          );
          addTimeline('token_snapshot', line, timestampMs);
          break;
        }

        addContextValue(info.model_context_window, line, 'event_msg.token_count');
        const last = sanitizeUsage(info.last_token_usage, line, 'last-turn');
        const total = sanitizeUsage(info.total_token_usage, line, 'cumulative');
        if (last) {
          lastSnapshotCount += 1;
          latestLastUsage = last;
          latestLastUsageLine = line;
        }
        if (total) {
          observeTotalUsage(total, line);
        }
        addTimeline('token_snapshot', line, timestampMs, {
          last_total_tokens: last?.total_tokens ?? null,
          cumulative_total_tokens: total?.total_tokens ?? null,
        });
        break;
      }
      case 'mcp_tool_call_end': {
        observeToolEndSignal(payload, line, timestampMs, 'tool_end_signal');
        break;
      }
      case 'patch_apply_end': {
        observeToolEndSignal(payload, line, timestampMs, 'tool_end_signal');
        break;
      }
      case 'web_search_end': {
        observeToolEndSignal(payload, line, timestampMs, 'web_search_end');
        break;
      }
      case 'context_compacted': {
        contextCompactedCount += 1;
        addTimeline('context_compacted', line, timestampMs);
        break;
      }
      case 'thread_rolled_back': {
        threadRolledBackCount += 1;
        addTimeline('thread_rolled_back', line, timestampMs);
        break;
      }
      case 'thread_settings_applied': {
        threadSettingsAppliedCount += 1;
        break;
      }
      default: {
        observeUnknownSubtype('event_msg', payload.type);
        if (looksErrorShaped(payload, payload.type)) {
          recordErrorActivity(line, timestampMs);
        }
      }
    }
  }

  function consumeResponseItem(payload, line, timestampMs) {
    if (!isObject(payload) || typeof payload.type !== 'string') {
      observeUnknownSubtype('response_item', null);
      addIssue(
        'missing_response_subtype',
        'warning',
        line,
        'A response item did not contain a usable subtype.',
      );
      return;
    }

    switch (payload.type) {
      case 'message': {
        responseMessageCount += 1;
        const role = normalizeRole(payload.role);
        const phase = normalizePhase(payload.phase);
        roleCounts[role] += 1;
        phaseCounts[phase] += 1;
        observeContentBlocks(payload.content);
        addTimeline('response_message', line, timestampMs, { role, phase });
        break;
      }
      case 'agent_message': {
        crossAgentMessageCount += 1;
        observeContentBlocks(payload.content);
        addTimeline('cross_agent_message', line, timestampMs);
        break;
      }
      case 'reasoning': {
        reasoningRecordCount += 1;
        observeContentBlocks(payload.summary);
        addTimeline('reasoning', line, timestampMs);
        break;
      }
      case 'custom_tool_call': {
        observeToolCall(payload, line, timestampMs);
        break;
      }
      case 'custom_tool_call_output': {
        observeToolOutput(payload, line, timestampMs);
        break;
      }
      case 'function_call':
      case 'tool_search_call': {
        observeToolCall(payload, line, timestampMs);
        break;
      }
      case 'function_call_output':
      case 'tool_search_output': {
        observeToolOutput(payload, line, timestampMs);
        break;
      }
      default: {
        observeUnknownSubtype('response_item', payload.type);
        if (looksErrorShaped(payload, payload.type)) {
          recordErrorActivity(line, timestampMs);
        }
      }
    }
  }

  function consume(record, line, timestampMs) {
    if (!isObject(record) || typeof record.type !== 'string') {
      unknownWrapperCount += 1;
      return;
    }

    if (!KNOWN_WRAPPERS.includes(record.type)) {
      unknownWrapperCount += 1;
      if (looksErrorShaped(record.payload, record.type)) {
        recordErrorActivity(line, timestampMs);
      }
      return;
    }

    recognizedRecordCount += 1;
    wrapperCounts[record.type] += 1;

    switch (record.type) {
      case 'session_meta':
      case 'turn_context':
        break;
      case 'world_state':
        worldStateRecordCount += 1;
        break;
      case 'compacted':
        contextCompactedCount += 1;
        addTimeline('compacted_snapshot', line, timestampMs);
        break;
      case 'inter_agent_communication_metadata':
        interAgentRecordCount += 1;
        break;
      case 'event_msg':
        consumeEventMessage(record.payload, line, timestampMs);
        break;
      case 'response_item':
        consumeResponseItem(record.payload, line, timestampMs);
        break;
      default:
        break;
    }
  }

  function finish() {
    const observedContextValues = [...contextValues].sort((left, right) => left - right);
    let contextState = 'missing';
    let configuredTokens = null;
    if (contextWindowOverride !== null) {
      contextState = 'override';
      configuredTokens = contextWindowOverride;
    } else if (observedContextValues.length === 1) {
      contextState = 'observed';
      [configuredTokens] = observedContextValues;
    } else if (observedContextValues.length > 1) {
      contextState = 'conflict';
      addIssue(
        'conflicting_context_window',
        'warning',
        contextEvidenceFirstLine,
        'More than one context-window value was observed.',
      );
    }

    const orphanedToolCalls =
      unidentifiedToolCalls +
      duplicateUnpairableToolCalls +
      outstandingToolCallsByDigest.size;
    if (orphanedToolCalls > 0) {
      addIssue(
        'orphaned_tool_call',
        'warning',
        null,
        'One or more observed tool calls had no matching output.',
      );
    }

    if (timelineDropped > 0) {
      addIssue(
        'timeline_truncated',
        'warning',
        null,
        'The safe timeline reached its bounded event limit.',
      );
    }

    let baseline = null;
    let previous = null;
    const safeTimeline = timeline.map((entry) => {
      const { timestampMs, ...safe } = entry;
      let offsetSeconds = null;
      if (timestampMs !== null) {
        if (baseline === null) {
          baseline = timestampMs;
        }
        if (previous !== null && timestampMs < previous) {
          addIssue(
            'timestamp_out_of_order',
            'warning',
            entry.line,
            'A later source record carried an earlier timestamp.',
          );
        }
        previous = timestampMs;
        offsetSeconds = Math.round((timestampMs - baseline) / 1_000);
      }
      return { ...safe, offset_seconds: offsetSeconds };
    });

    return {
      adapter: {
        id: ADAPTER_ID,
        version: ADAPTER_VERSION,
        match_state: recognizedRecordCount > 0 ? 'matched' : 'none',
        recognized_record_count: recognizedRecordCount,
        observed_format_support: true,
        official_schema_contract: false,
      },
      context_window: {
        configured_tokens: configuredTokens,
        state: contextState,
        observed_values: observedContextValues,
        evidence: {
          count: contextEvidenceCount,
          first_line: contextEvidenceFirstLine,
          last_line: contextEvidenceLastLine,
          rules: [...contextEvidenceRules].sort(),
        },
        override_supplied: contextWindowOverride !== null,
      },
      usage: {
        last_snapshot: {
          semantics: 'observed_last_snapshot',
          evidence_line: latestLastUsageLine,
          values: latestLastUsage,
        },
        cumulative_snapshot: {
          semantics: 'observed_cumulative_snapshot',
          evidence_line: latestTotalUsageLine,
          values: latestTotalUsage,
        },
        last_snapshot_count: lastSnapshotCount,
        cumulative_snapshot_count: totalSnapshotCount,
        duplicate_cumulative_snapshot_count: duplicateTotalSnapshotCount,
        cumulative_reset_count: totalCounterResetCount,
        price_estimated: false,
        billable_tokens_inferred: false,
      },
      activity: {
        record_counts: wrapperCounts,
        messages: {
          event_messages: eventMessageCount,
          response_messages: responseMessageCount,
          cross_agent_messages: crossAgentMessageCount,
          by_role: sortedHistogram(roleCounts),
          by_phase: sortedHistogram(phaseCounts),
        },
        reasoning_records: reasoningRecordCount,
        content_blocks: contentBlockCount,
        unknown_content_blocks: unknownContentBlockCount,
        task_started: taskStartedCount,
        task_completed: taskCompletedCount,
        turn_aborted: turnAbortedCount,
        context_compacted: contextCompactedCount,
        thread_rolled_back: threadRolledBackCount,
        thread_settings_applied: threadSettingsAppliedCount,
        world_state_records: worldStateRecordCount,
        inter_agent_records: interAgentRecordCount,
      },
      tools: {
        kind: 'opaque_custom_tool',
        started: toolsStarted,
        outputs_observed: toolOutputs,
        paired_calls: pairedToolCalls,
        orphaned_calls: orphanedToolCalls,
        orphaned_outputs: orphanedToolOutputs,
        duplicate_correlation_ids: duplicateToolIds,
        end_signals_observed: toolEndSignalCount,
        status_histogram: sortedHistogram(toolStatusHistogram),
        names_emitted: false,
        arguments_emitted: false,
        results_emitted: false,
      },
      errors: {
        activity: errorActivityCount > 0,
        count: errorActivityCount,
        raw_text_emitted: false,
      },
      timeline: safeTimeline,
      unknown_counts: {
        wrappers: unknownWrapperCount,
        subtypes: unknownSubtypeCount,
        event_subtype_groups: unknownEventSubtypeDigests.size,
        response_subtype_groups: unknownResponseSubtypeDigests.size,
        content_blocks: unknownContentBlockCount,
        timeline_events_dropped: timelineDropped,
      },
    };
  }

  return {
    id: ADAPTER_ID,
    version: ADAPTER_VERSION,
    consume,
    finish,
  };
}

export function codexObservedAdapterDescriptor() {
  return {
    id: ADAPTER_ID,
    version: ADAPTER_VERSION,
    description: 'Observed Codex JSONL envelope; content-silent and schema-cautious.',
    official_schema_contract: false,
  };
}
