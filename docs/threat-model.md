# Threat model

## Protected properties

- Conversation and tool content do not enter reports or normal errors.
- The input file is opened read-only and is not automatically discovered.
- Output is deterministic, is atomically published from an already-redacted
  same-directory temporary file, and does not silently overwrite a file.
- Malformed and future-schema records produce explicit quality signals.
- Production code contains no network client.

## Expected hostile or broken inputs

- prompt-injection prose inside JSON fields;
- ANSI, Markdown, or terminal control sequences;
- malformed JSON, blank lines, BOM, and CRLF;
- negative, fractional, infinite, or unsafe token counters;
- unknown wrapper/subtype/content-block values;
- unmatched and interleaved tool events;
- counter resets and duplicate snapshots;
- oversized lines and input files that change during reading;
- directories, symlinks, FIFOs, sockets, and device files supplied as input.

## Non-goals

- defending a compromised OS or same-user process;
- encrypted local storage;
- loading third-party adapters;
- proving the complete semantics of a private or future record format;
- diagnosing causality, billing, model quality, or network policy.
