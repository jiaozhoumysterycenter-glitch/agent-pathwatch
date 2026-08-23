export class PathwatchError extends Error {
  constructor(code, safeMessage, exitCode = 2) {
    super(safeMessage);
    this.name = 'PathwatchError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function asSafeCliError(error) {
  if (error instanceof PathwatchError) {
    return error;
  }

  return new PathwatchError(
    'PATHWATCH_E_INTERNAL',
    'An internal error occurred. No source value was printed.',
    5,
  );
}
