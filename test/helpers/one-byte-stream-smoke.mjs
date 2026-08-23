import { Readable } from 'node:stream';

import { analyzeReadable } from '../../src/analyze.mjs';

const source = Buffer.from(
  `${JSON.stringify({
    timestamp: '2026-07-01T00:00:00.000Z',
    type: 'session_meta',
    payload: { message: `PATHWATCH_NEVER_EMIT_ONE_BYTE_${'x'.repeat(512 * 1024)}` },
  })}\n${JSON.stringify({
    timestamp: '2026-07-01T00:00:01.000Z',
    type: 'event_msg',
    payload: { type: 'task_started', model_context_window: 64000 },
  })}\n`,
  'utf8',
);

class OneByteReadable extends Readable {
  constructor(bytes) {
    super({ highWaterMark: 1 });
    this.bytes = bytes;
    this.offset = 0;
  }

  _read() {
    if (this.offset >= this.bytes.length) {
      this.push(null);
      return;
    }
    const byte = this.bytes.subarray(this.offset, this.offset + 1);
    this.offset += 1;
    this.push(byte);
  }
}

const report = await analyzeReadable(new OneByteReadable(source), {
  sourceKind: 'stdin',
});

process.stdout.write(
  JSON.stringify({
    lines: report.source.lines,
    parseable: report.source.parseable_lines,
    context: report.context_window.configured_tokens,
    content_emitted: report.source.content_emitted,
  }),
);
