import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../shared/types.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function asAppError(error: unknown, fallbackCode = 'INTERNAL_ERROR'): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError(400, 'INVALID_REQUEST', 'Some submitted fields are invalid.', false, error.flatten());
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new AppError(504, 'PROVIDER_TIMEOUT', 'A provider took too long to respond. Try again.', true);
  }
  const requestError = error as { status?: number; type?: string } | null;
  if (error instanceof SyntaxError && requestError?.status === 400) {
    return new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
  if (requestError?.status === 413 || requestError?.type === 'entity.too.large') {
    return new AppError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.');
  }
  return new AppError(
    500,
    fallbackCode,
    fallbackCode === 'INTERNAL_ERROR'
      ? 'The server could not complete this request.'
      : 'A provider returned an unexpected response. Try again.',
    fallbackCode !== 'INTERNAL_ERROR',
  );
}

export function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

export const notFoundHandler = (request: Request, _response: Response, next: NextFunction) => {
  next(new AppError(404, 'NOT_FOUND', `No API route exists at ${request.path}.`));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const appError = asAppError(error);
  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      retryable: appError.retryable,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  };
  response.status(appError.status).json(body);
};
