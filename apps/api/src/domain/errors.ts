/**
 * Domain-level errors (§4.2). The API layer translates these into the HTTP
 * envelope; nothing below `api/` knows about status codes.
 */
export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NAME_CONFLICT'
  | 'INVALID_MOVE'
  | 'UPLOAD_VERIFICATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  // spec 003 §1.6, §2.6
  | 'PASSWORD_REQUIRED'
  | 'IDENTITY_CONFLICT'
  | 'RESTORE_TARGET_MISSING'
  | 'INTERNAL';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }

  static validation(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError('VALIDATION_FAILED', message, details);
  }

  static notFound(what = 'Resource'): DomainError {
    return new DomainError('NOT_FOUND', `${what} not found`);
  }

  static forbidden(message = 'You do not have permission to do that'): DomainError {
    return new DomainError('FORBIDDEN', message);
  }

  static invalidMove(message: string): DomainError {
    return new DomainError('INVALID_MOVE', message);
  }
}
