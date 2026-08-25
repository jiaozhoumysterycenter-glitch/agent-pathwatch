#!/usr/bin/env node

import process from 'node:process';
import { parseArgs } from 'node:util';

import { analyzeReadable, appendQualityIssue } from './analyze.mjs';
import { codexObservedAdapterDescriptor } from './adapters/codex-observed-v1.mjs';
import { asSafeCliError, PathwatchError } from './errors.mjs';
import { openExplicitInput, writeExplicitOutput, writeSafeDiagnostic } from './io.mjs';
import { renderAdapters, renderJson, renderMarkdown } from './render.mjs';

const VERSION = '0.1.0';

const HELP = `Agent Pathwatch ${VERSION}

Usage:
  agent-pathwatch inspect <FILE|-> [--format markdown|json]
    [--output <PATH|->] [--adapter auto|codex-observed-v1]
    [--context-window <TOKENS>] [--no-timeline] [--strict]

  agent-pathwatch adapters [--format markdown|json]
  agent-pathwatch version
  agent-pathwatch help

Privacy defaults:
  explicit input only; no message content; no tool data; no paths or IDs;
  no network, telemetry, cache, or automatic session discovery.
`;

function parsePositiveInteger(value) {
  if (value === undefined) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    throw new PathwatchError(
      'PATHWATCH_E_CONTEXT_OVERRIDE',
      'The context-window override must be a positive safe integer.',
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new PathwatchError(
      'PATHWATCH_E_CONTEXT_OVERRIDE',
      'The context-window override must be a positive safe integer.',
    );
  }
  return parsed;
}

function validateFormat(format) {
  if (!['markdown', 'json'].includes(format)) {
    throw new PathwatchError(
      'PATHWATCH_E_FORMAT',
      'The output format must be markdown or json.',
    );
  }
}

function parseCli(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        adapter: { type: 'string', default: 'auto' },
        'context-window': { type: 'string' },
        format: { type: 'string', default: 'markdown' },
        help: { type: 'boolean', short: 'h' },
        output: { type: 'string', short: 'o', default: '-' },
        'no-timeline': { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch {
    throw new PathwatchError(
      'PATHWATCH_E_ARGUMENTS',
      'The command-line arguments were not recognized. Run `agent-pathwatch help`.',
    );
  }
}

async function inspectCommand(source, values) {
  validateFormat(values.format);
  const contextWindowOverride = parsePositiveInteger(values['context-window']);
  const input = await openExplicitInput(source);

  let report;
  let finishState = { changedDuringRead: false };
  try {
    report = await analyzeReadable(input.stream, {
      adapterId: values.adapter,
      contextWindowOverride,
      omitTimeline: values['no-timeline'],
      sourceKind: input.kind,
      sourceBytes: input.size,
    });
  } finally {
    finishState = await input.finish();
  }

  if (finishState.changedDuringRead) {
    appendQualityIssue(report, {
      code: 'input_changed_during_read',
      severity: 'warning',
      line: null,
      detail_safe: 'The explicit input changed while it was being read.',
    });
  }

  if (report.adapter.match_state !== 'matched') {
    throw new PathwatchError(
      'PATHWATCH_E_ADAPTER_NO_MATCH',
      'No built-in adapter recognized the explicit input.',
      3,
    );
  }

  const rendered = values.format === 'json' ? renderJson(report) : renderMarkdown(report);
  await writeExplicitOutput(values.output, rendered);

  if (values.strict && report.data_quality.issue_count > 0) {
    process.exitCode = 4;
  }
}

async function main(argv) {
  const { positionals, values } = parseCli(argv);
  if (values.help) {
    await writeExplicitOutput(values.output, HELP);
    return;
  }
  if (values.version) {
    await writeExplicitOutput(values.output, VERSION);
    return;
  }

  const command = positionals[0] ?? 'help';
  switch (command) {
    case 'help':
      if (positionals.length !== 1) {
        throw new PathwatchError(
          'PATHWATCH_E_ARGUMENTS',
          'The help command does not accept positional arguments.',
        );
      }
      await writeExplicitOutput(values.output, HELP);
      return;
    case 'version':
      if (positionals.length !== 1) {
        throw new PathwatchError(
          'PATHWATCH_E_ARGUMENTS',
          'The version command does not accept positional arguments.',
        );
      }
      await writeExplicitOutput(values.output, VERSION);
      return;
    case 'adapters': {
      validateFormat(values.format);
      if (positionals.length !== 1) {
        throw new PathwatchError(
          'PATHWATCH_E_ARGUMENTS',
          'The adapters command does not accept positional arguments.',
        );
      }
      const rendered = renderAdapters([codexObservedAdapterDescriptor()], values.format);
      await writeExplicitOutput(values.output, rendered);
      return;
    }
    case 'inspect': {
      if (positionals.length !== 2) {
        throw new PathwatchError(
          'PATHWATCH_E_ARGUMENTS',
          'The inspect command requires exactly one explicit file or `-` for stdin.',
        );
      }
      await inspectCommand(positionals[1], values);
      return;
    }
    default:
      throw new PathwatchError(
        'PATHWATCH_E_COMMAND',
        'The command was not recognized. Run `agent-pathwatch help`.',
      );
  }
}

main(process.argv.slice(2)).catch(async (error) => {
  const safe = asSafeCliError(error);
  await writeSafeDiagnostic(`${safe.code}: ${safe.message}\n`);
  process.exitCode = safe.exitCode;
});
