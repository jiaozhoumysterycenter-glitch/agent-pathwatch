import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const FORBIDDEN = [
  'node:http',
  'node:https',
  'node:net',
  'node:dns',
  'node:dgram',
  'fetch(',
  'XMLHttpRequest',
  'WebSocket(',
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith('.mjs')) {
      files.push(path);
    }
  }
  return files;
}

test('production source contains no network client surface', async () => {
  for (const path of await sourceFiles(SRC)) {
    const source = await readFile(path, 'utf8');
    for (const forbidden of FORBIDDEN) {
      assert.equal(source.includes(forbidden), false, `${forbidden} found in production source`);
    }
  }
});
