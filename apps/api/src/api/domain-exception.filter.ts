import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_STATUS, type ErrorCode } from '@dataroom/contracts';
import { DomainError } from '../domain/errors';
import { captureException } from '../infra/observability/sentry';

/** §4.2 — one error envelope for every non-2xx response. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<{ url?: string }>();
    const { code, message, details } = this.classify(exception);

    // spec 004 §4 — only INTERNAL is an incident. A 404 or a NAME_CONFLICT is
    // the product working as specified; alerting on those trains people to
    // ignore alerts.
    if (code === 'INTERNAL') {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      captureException(exception, { path: request.url ? redactPath(request.url) : undefined });
    }

    response.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
  }

  private classify(exception: unknown): {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof DomainError) {
      return { code: exception.code, message: exception.message, details: exception.details };
    }

    // Detected structurally, not with `instanceof`: the contracts package and
    // the API can resolve to separate zod instances, which would make an
    // identity check silently misreport validation errors as 500s.
    if (isZodError(exception)) {
      return {
        code: 'VALIDATION_FAILED',
        message: 'Request failed validation',
        details: { issues: exception.issues },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = (Object.keys(ERROR_STATUS) as ErrorCode[]).find(
        (key) => ERROR_STATUS[key] === status,
      );
      return { code: code ?? 'INTERNAL', message: exception.message };
    }

    return { code: 'INTERNAL', message: 'Something went wrong' };
  }
}

function isZodError(error: unknown): error is { issues: unknown[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

/** §4.1 — a share token in a URL is a credential; it never reaches a log sink. */
function redactPath(url: string): string {
  return url.replace(/\/public\/shares\/[^/?#]+/g, '/public/shares/[token]').replace(/([?&]t=)[^&#]*/g, '$1[token]');
}
