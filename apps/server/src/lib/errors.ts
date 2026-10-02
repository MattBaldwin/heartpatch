import { DEFAULT_ERROR_MESSAGES, type ApiError, type ErrorCode } from '@heartpatch/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { RequestValidationError } from './zod.js';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * Throw from services to return a shared error code. `message` must be
 * kid-readable (style guide §6); it defaults to the code's standard message.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string = DEFAULT_ERROR_MESSAGES[code]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
  }
}

function body(code: ErrorCode, message: string = DEFAULT_ERROR_MESSAGES[code]): ApiError {
  return { error: { code, message } };
}

/** Turns every thrown error into the `{ error: { code, message } }` envelope. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | Error, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(body(err.code, err.message));
    }
    if (err instanceof RequestValidationError) {
      request.log.info({ issues: err.issues }, 'request validation failed');
      return reply.status(400).send(body('VALIDATION_FAILED'));
    }
    // Fastify's own client errors (bad JSON, payload too large, etc.).
    const statusCode = 'statusCode' in err ? err.statusCode : undefined;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      const code: ErrorCode = statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST';
      return reply.status(statusCode).send(body(code));
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL'));
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(body('NOT_FOUND')));
}
