import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import test from 'node:test';

import { analyzeReadable, appendQualityIssue } from '../src/analyze.mjs';

const SCHEMA_URL = new URL('../schemas/pathwatch-report-v0.1.schema.json', import.meta.url);
const FIXTURE_URL = new URL('./fixtures/minimal-lifecycle.jsonl', import.meta.url);

function localRef(root, reference) {
  assert.match(reference, /^#\//);
  return reference
    .slice(2)
    .split('/')
    .reduce((value, part) => value[part.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}

function validate(value, rule, root, path = '$') {
  if (rule.$ref) return validate(value, localRef(root, rule.$ref), root, path);
  if (rule.anyOf) {
    const branches = rule.anyOf.map((branch) => validate(value, branch, root, path));
    return branches.some((errors) => errors.length === 0)
      ? []
      : [`${path}: no anyOf branch matched`];
  }

  const errors = [];
  if ('const' in rule && value !== rule.const) errors.push(`${path}: const mismatch`);
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${path}: enum mismatch`);

  if (rule.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [...errors, `${path}: expected object`];
    }
    for (const required of rule.required ?? []) {
      if (!(required in value)) errors.push(`${path}: missing ${required}`);
    }
    const properties = rule.properties ?? {};
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}: additional property ${key}`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) errors.push(...validate(value[key], child, root, `${path}.${key}`));
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) return [...errors, `${path}: expected array`];
    if (rule.maxItems !== undefined && value.length > rule.maxItems) {
      errors.push(`${path}: maxItems exceeded`);
    }
    if (rule.uniqueItems) {
      const unique = new Set(value.map((item) => JSON.stringify(item)));
      if (unique.size !== value.length) errors.push(`${path}: duplicate items`);
    }
    if (rule.items) {
      value.forEach((item, index) => {
        errors.push(...validate(item, rule.items, root, `${path}[${index}]`));
      });
    }
  } else if (rule.type === 'integer') {
    if (!Number.isInteger(value)) return [...errors, `${path}: expected integer`];
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(`${path}: below minimum`);
  } else if (rule.type === 'string') {
    if (typeof value !== 'string') return [...errors, `${path}: expected string`];
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      errors.push(`${path}: maxLength exceeded`);
    }
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${path}: pattern mismatch`);
  } else if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
  } else if (rule.type === 'null') {
    if (value !== null) errors.push(`${path}: expected null`);
  }

  return errors;
}

test('the canonical report validates against the bundled closed schema', async () => {
  const schema = JSON.parse(await readFile(SCHEMA_URL, 'utf8'));
  const bytes = (await readFile(FIXTURE_URL)).byteLength;
  const report = await analyzeReadable(createReadStream(FIXTURE_URL), {
    sourceKind: 'regular-file',
    sourceBytes: bytes,
  });

  assert.deepEqual(validate(report, schema, schema), []);

  const injectedTool = structuredClone(report);
  injectedTool.tools.arguments = 'PATHWATCH_NEVER_EMIT_SCHEMA_ARGUMENTS';
  assert.ok(validate(injectedTool, schema, schema).some((error) => error.includes('additional property')));

  const injectedTimeline = structuredClone(report);
  injectedTimeline.timeline[0].raw_error = 'PATHWATCH_NEVER_EMIT_SCHEMA_ERROR';
  assert.ok(
    validate(injectedTimeline, schema, schema).some((error) =>
      error.includes('additional property raw_error'),
    ),
  );
});

test('a saturated issue list plus a post-read issue still validates', async () => {
  const schema = JSON.parse(await readFile(SCHEMA_URL, 'utf8'));
  const input = Array.from(
    { length: 300 },
    () => '{"type":"session_meta","payload":{}}',
  ).join('\n');
  const report = await analyzeReadable(Readable.from([input]), { sourceKind: 'stdin' });
  appendQualityIssue(report, {
    code: 'input_changed_during_read',
    severity: 'warning',
    line: null,
    detail_safe: 'The explicit input changed while it was being read.',
  });

  assert.equal(report.data_quality.issues.length, 257);
  assert.deepEqual(validate(report, schema, schema), []);
});
