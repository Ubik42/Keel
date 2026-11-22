import { type PublicErrorCode, type PublicErrorReason, publicReasonFromError, classifyUnknownFailure } from '../../shared/protocol/errors';
import { LibraryInputError } from './library-rules';

/**
 * Library Service error types and error-code helpers.
 */
export class SimulatedCrashError extends Error {}

export class StaleMediaRevisionError extends Error {
  readonly code = 'STALE_REVISION';

  constructor(message: string) {
    super(message);
    this.name = 'StaleMediaRevisionError';
  }
}

export function isStaleMediaRevisionError(error: unknown): error is StaleMediaRevisionError {
  return error instanceof StaleMediaRevisionError;
}

export class LibraryServiceError extends Error {
  constructor(
    readonly code: PublicErrorCode,
    options?: {
      cause?: unknown;
      reason?: PublicErrorReason;
      retryable?: boolean;
      currentEntityVersion?: number;
    },
  ) {
    super(code, options);
    this.name = 'LibraryServiceError';
    this.reason = options?.reason ?? publicReasonFromError(options?.cause);
    this.retryable = options?.retryable;
    this.currentEntityVersion = options?.currentEntityVersion;
  }

  readonly reason?: PublicErrorReason;
  readonly retryable?: boolean;
  readonly currentEntityVersion?: number;
}

export function serviceError(error: unknown, fallback: PublicErrorCode): LibraryServiceError {
  if (error instanceof LibraryServiceError) return error;
  if (error instanceof LibraryInputError) return new LibraryServiceError(error.code, { cause: error });
  const classified = classifyUnknownFailure(error);
  if (classified) {
    return new LibraryServiceError(classified.code, {
      cause: error,
      reason: classified.reason,
    });
  }
  return new LibraryServiceError(fallback, { cause: error });
}

export function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
