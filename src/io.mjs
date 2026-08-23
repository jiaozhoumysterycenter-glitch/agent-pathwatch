import { constants as fsConstants, promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { PathwatchError } from './errors.mjs';

function sameFileState(before, after) {
  return (
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    (before.ino === 0 || after.ino === 0 || before.ino === after.ino)
  );
}

function writeContentSilentStream(stream, bytes) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      reject(
        new PathwatchError(
          'PATHWATCH_E_OUTPUT_STREAM',
          'The output stream closed before the report could be written.',
        ),
      );
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      stream.off('error', fail);
      resolve();
    };

    stream.on('error', fail);
    try {
      stream.write(bytes, (error) => {
        if (error) {
          fail();
        } else {
          succeed();
        }
      });
    } catch {
      fail();
    }
  });
}

export async function openExplicitInput(source) {
  if (source === '-') {
    return {
      kind: 'stdin',
      size: null,
      stream: process.stdin,
      async finish() {
        return { changedDuringRead: false };
      },
    };
  }

  let namedState;
  try {
    namedState = await fs.lstat(source);
  } catch {
    throw new PathwatchError(
      'PATHWATCH_E_INPUT_OPEN',
      'The explicit input could not be opened as a regular file.',
    );
  }
  if (namedState.isSymbolicLink()) {
    throw new PathwatchError(
      'PATHWATCH_E_INPUT_SYMLINK',
      'Symbolic-link input is refused; provide the explicit regular file instead.',
    );
  }
  if (!namedState.isFile()) {
    throw new PathwatchError(
      'PATHWATCH_E_INPUT_NOT_REGULAR',
      'The explicit input is not a regular file.',
    );
  }

  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    handle = await fs.open(source, fsConstants.O_RDONLY | noFollow);
  } catch {
    throw new PathwatchError(
      'PATHWATCH_E_INPUT_OPEN',
      'The explicit input could not be opened as a regular file.',
    );
  }

  let before;
  try {
    before = await handle.stat();
    if (!before.isFile()) {
      throw new PathwatchError(
        'PATHWATCH_E_INPUT_NOT_REGULAR',
        'The explicit input is not a regular file.',
      );
    }
    if (!sameFileState(namedState, before)) {
      throw new PathwatchError(
        'PATHWATCH_E_INPUT_CHANGED',
        'The explicit input changed before the read could begin.',
      );
    }
  } catch (error) {
    await handle.close().catch(() => {});
    if (error instanceof PathwatchError) {
      throw error;
    }
    throw new PathwatchError(
      'PATHWATCH_E_INPUT_STAT',
      'The explicit input could not be inspected safely.',
    );
  }

  const stream = handle.createReadStream({ autoClose: false });
  let finished = false;

  return {
    kind: 'regular-file',
    size: before.size,
    stream,
    async finish() {
      if (finished) {
        return { changedDuringRead: false };
      }
      finished = true;

      let changedDuringRead = false;
      try {
        const after = await handle.stat();
        changedDuringRead = !sameFileState(before, after);
      } catch {
        changedDuringRead = true;
      } finally {
        await handle.close().catch(() => {});
      }

      return { changedDuringRead };
    },
  };
}

export async function writeExplicitOutput(target, text) {
  const bytes = text.endsWith('\n') ? text : `${text}\n`;

  if (!target || target === '-') {
    await writeContentSilentStream(process.stdout, bytes);
    return;
  }

  const temporary = join(
    dirname(target),
    `.agent-pathwatch-${randomBytes(12).toString('hex')}.tmp`,
  );
  let handle;
  let temporaryCreated = false;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    await handle.writeFile(bytes, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.link(temporary, target);
  } catch {
    throw new PathwatchError(
      'PATHWATCH_E_OUTPUT_CREATE',
      'The output could not be created. Existing files are never overwritten.',
    );
  } finally {
    await handle?.close().catch(() => {});
    if (temporaryCreated) {
      await fs.unlink(temporary).catch(() => {});
    }
  }
}

export async function writeSafeDiagnostic(text) {
  try {
    await writeContentSilentStream(process.stderr, text);
  } catch {
    // A closed diagnostic stream has no safer fallback channel.
  }
}
