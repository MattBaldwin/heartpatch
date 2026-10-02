import { DEFAULT_ERROR_MESSAGES, type ApiError, type ErrorCode } from '@heartpatch/shared';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
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

/** Shared code for Fastify's own 4xx errors; anything unlisted is BAD_REQUEST. */
const CODE_BY_CLIENT_STATUS: Readonly<Partial<Record<number, ErrorCode>>> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
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

/**
 * Sends the error envelope. Uses plain JSON rather than the route's response
 * schema, so a route that declares a schema for an error status can never turn
 * an error into a serialization failure that leaks validation details.
 */
function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string = DEFAULT_ERROR_MESSAGES[code],
): FastifyReply {
  const body: ApiError = { error: { code, message } };
  return reply
    .status(statusCode)
    .type('application/json; charset=utf-8')
    .serializer(JSON.stringify)
    .send(body);
}

/** Turns every thrown error into the `{ error: { code, message } }` envelope. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | Error, request, reply) => {
    if (err instanceof AppError) {
      return sendError(reply, err.statusCode, err.code, err.message);
    }
    if (err instanceof RequestValidationError) {
      request.log.info({ issues: err.issues }, 'request validation failed');
      return sendError(reply, 400, 'VALIDATION_FAILED');
    }
    // Fastify's own client errors (bad JSON, payload too large, wrong content type, ...).
    const statusCode = 'statusCode' in err ? err.statusCode : undefined;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return sendError(reply, statusCode, CODE_BY_CLIENT_STATUS[statusCode] ?? 'BAD_REQUEST');
    }
    request.log.error({ err }, 'unhandled error');
    return sendError(reply, 500, 'INTERNAL');
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'NOT_FOUND'));
}
