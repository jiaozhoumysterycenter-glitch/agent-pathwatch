import assert from 'node:assert/strict';
import { lstat, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'src', 'cli.mjs');
const MINIMAL = join(ROOT, 'test', 'fixtures', 'minimal-lifecycle.jsonl');
const TOOL_OPAQUE = join(ROOT, 'test', 'fixtures', 'tool-opaque.jsonl');
const ONE_BYTE_HELPER = join(ROOT, 'test', 'helpers', 'one-byte-stream-smoke.mjs');
const NEVER_EMIT = 'PATHWATCH_NEVER_EMIT';

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });
}

test('CLI JSON output is deterministic and does not expose the source path', () => {
  const first = run(['inspect', MINIMAL, '--format', 'json']);
  const second = run(['inspect', MINIMAL, '--format', 'json']);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(first.stderr, '');
  assert.equal(first.stdout.includes(NEVER_EMIT), false);
  assert.equal(first.stdout.includes(MINIMAL), false);
  assert.equal(first.stdout.includes('minimal-lifecycle.jsonl'), false);
  assert.equal(JSON.parse(first.stdout).schema, 'pathwatch.report/v0.1');
});

test('strict mode returns 4 after writing a partial report', () => {
  const result = run(['inspect', TOOL_OPAQUE, '--format', 'json', '--strict']);
  assert.equal(result.status, 4);
  assert.equal(JSON.parse(result.stdout).data_quality.status, 'partial');
  assert.equal(result.stdout.includes(NEVER_EMIT), false);
  assert.equal(result.stderr, '');
});

test('stdin is accepted only when explicitly selected with a dash', async () => {
  const input = await readFile(MINIMAL, 'utf8');
  const result = run(['inspect', '-', '--format', 'json'], { input });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.source.kind, 'stdin');
  assert.equal(report.source.path_emitted, false);
  assert.equal(result.stdout.includes(NEVER_EMIT), false);
});

test('output files are private and are never overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-pathwatch-test-'));
  const output = join(directory, 'report.json');
  try {
    const first = run(['inspect', MINIMAL, '--format', 'json', '--output', output]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, '');
    if (process.platform !== 'win32') {
      const mode = (await lstat(output)).mode & 0o777;
      assert.equal(mode, 0o600);
    }
    assert.equal(JSON.parse(await readFile(output, 'utf8')).schema, 'pathwatch.report/v0.1');
    assert.deepEqual(await readdir(directory), ['report.json']);

    const second = run(['inspect', MINIMAL, '--format', 'json', '--output', output]);
    assert.equal(second.status, 2);
    assert.match(second.stderr, /^PATHWATCH_E_OUTPUT_CREATE:/);
    assert.equal(second.stderr.includes(output), false);
    assert.deepEqual(await readdir(directory), ['report.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unrecognized input fails without emitting its raw value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-pathwatch-test-'));
  const input = join(directory, 'unknown.jsonl');
  try {
    await writeFile(
      input,
      '{"timestamp":"2026-01-01T00:00:00.000Z","type":"mystery","payload":{"text":"PATHWATCH_NEVER_EMIT_NO_MATCH"}}\n',
      'utf8',
    );
    const result = run(['inspect', input, '--format', 'json']);
    assert.equal(result.status, 3);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^PATHWATCH_E_ADAPTER_NO_MATCH:/);
    assert.equal(result.stderr.includes(NEVER_EMIT), false);
    assert.equal(result.stderr.includes(input), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('symlink input is rejected with a content-free error', async (context) => {
  if (process.platform === 'win32') {
    context.skip('symlink permissions vary on Windows');
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), 'agent-pathwatch-test-'));
  const link = join(directory, 'session-link.jsonl');
  try {
    await symlink(MINIMAL, link);
    const result = run(['inspect', link]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^PATHWATCH_E_INPUT_SYMLINK:/);
    assert.equal(result.stderr.includes(link), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('directory input is rejected without printing its path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-pathwatch-test-'));
  try {
    const result = run(['inspect', directory]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^PATHWATCH_E_INPUT_NOT_REGULAR:/);
    assert.equal(result.stderr.includes(directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the executable bit and version command are ready for npm bin use', async () => {
  if (process.platform !== 'win32') {
    assert.notEqual((await lstat(CLI)).mode & 0o111, 0);
  }
  const result = run(['version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '0.1.0\n');
});

test('a drained oversized line stays bounded and is reported before trim', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-pathwatch-test-'));
  const input = join(directory, 'oversized.jsonl');
  let handle;
  try {
    handle = await open(input, 'w', 0o600);
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    for (let index = 0; index < 64; index += 1) {
      await handle.write(chunk);
    }
    await handle.write(
      '\n{"timestamp":"2026-06-01T00:00:00.000Z","type":"session_meta","payload":{}}\n',
    );
    await handle.close();
    handle = null;

    const result = spawnSync(
      process.execPath,
      ['--max-old-space-size=32', CLI, 'inspect', input, '--format', 'json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.source.oversized_lines, 1);
    assert.equal(report.source.parseable_lines, 1);
    assert.equal(report.data_quality.status, 'partial');
  } finally {
    await handle?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test('one-byte chunks do not create an unbounded fragment list', () => {
  const result = spawnSync(
    process.execPath,
    ['--max-old-space-size=128', ONE_BYTE_HELPER],
    { cwd: ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    lines: 2,
    parseable: 2,
    context: 64000,
    content_emitted: false,
  });
  assert.equal(result.stdout.includes(NEVER_EMIT), false);
});

test('a very wide JSON array is refused before JSON.parse can exhaust a small heap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-pathwatch-test-'));
  const input = join(directory, 'wide.jsonl');
  let handle;
  try {
    handle = await open(input, 'w', 0o600);
    await handle.write(
      '{"timestamp":"2026-07-01T00:00:00.000Z","type":"session_meta","payload":{"wide":[',
    );
    const chunk = '0,'.repeat(35_000);
    for (let index = 0; index < 100; index += 1) {
      await handle.write(chunk);
    }
    await handle.write(
      '0]}}\n{"timestamp":"2026-07-01T00:00:01.000Z","type":"session_meta","payload":{}}\n',
    );
    await handle.close();
    handle = null;

    const result = spawnSync(
      process.execPath,
      ['--max-old-space-size=64', CLI, 'inspect', input, '--format', 'json'],
      { cwd: ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.source.invalid_lines, 1);
    assert.equal(report.source.parseable_lines, 1);
    assert.ok(report.data_quality.issues.some((issue) => issue.code === 'record_too_complex'));
  } finally {
    await handle?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test('help and version survive a closed downstream pipe without a stack trace', (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX pipeline test');
    return;
  }

  for (const command of ['help', 'version']) {
    const script = `"${process.execPath}" "${CLI}" ${command} | true`;
    const result = spawnSync('/bin/sh', ['-c', script], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stderr.includes(CLI), false);
    assert.equal(result.stderr.includes(' at '), false);
  }
});

test('a closed stdout becomes a safe error instead of a Node path-bearing stack', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-pathwatch-test-'));
  const input = join(directory, 'large-synthetic.jsonl');
  try {
    const lines = [];
    for (let index = 0; index < 5_000; index += 1) {
      lines.push(
        JSON.stringify({
          timestamp: `2026-06-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            phase: 'commentary',
            message: `PATHWATCH_NEVER_EMIT_EPIPE_${index}`,
          },
        }),
      );
    }
    await writeFile(input, `${lines.join('\n')}\n`, 'utf8');

    const child = spawn(process.execPath, [CLI, 'inspect', input], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.destroy();

    const [code, signal] = await once(child, 'close');
    assert.equal(signal, null);
    assert.equal(code, 2);
    assert.match(stderr, /^PATHWATCH_E_OUTPUT_STREAM:/);
    assert.equal(stderr.includes(NEVER_EMIT), false);
    assert.equal(stderr.includes(input), false);
    assert.equal(stderr.includes(CLI), false);
    assert.equal(stderr.includes(' at '), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
