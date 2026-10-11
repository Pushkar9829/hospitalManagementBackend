import mongoose from 'mongoose';
import { ERROR_CODES } from '@hms/shared';
import { logger } from '../observability/logger.js';

/** An error the client is meant to see. `code` comes from @hms/shared ERROR_CODES. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  notFound: (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  forbidden: (message = 'You do not have permission to do this') =>
    new AppError(403, 'FORBIDDEN', message),
  conflict: (code, message) => new AppError(409, code, message),
  validation: (details, message = 'Some fields are invalid') =>
    new AppError(422, 'VALIDATION_FAILED', message, details),
  versionConflict: () =>
    new AppError(
      409,
      'VERSION_CONFLICT',
      'Someone else changed this record. Reload and try again.',
    ),
};

/** Maps library errors to the API error format; unknown errors become 500 INTERNAL. */
function normalise(err) {
  if (err instanceof AppError) return err;
  if (err instanceof mongoose.Error.VersionError) return errors.versionConflict();
  if (err instanceof mongoose.Error.ValidationError) {
    return errors.validation(
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }
  if (err instanceof mongoose.Error.CastError)
    return new AppError(404, 'NOT_FOUND', 'Record not found');
  if (err?.code === 11000) return new AppError(409, 'DUPLICATE', 'This record already exists');
  if (err?.type === 'entity.parse.failed')
    return new AppError(400, 'BAD_REQUEST', 'Malformed JSON body');
  if (err?.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  return null;
}

export function errorHandler(err, req, res, _next) {
  const known = normalise(err);
  const requestId = req.id;
  if (!known) {
    (req.log ?? logger).error({ err, requestId }, 'Unhandled error');
    return res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong. Share the request id with support.',
        requestId,
      },
    });
  }
  if (known.status >= 500) (req.log ?? logger).error({ err, requestId }, known.message);
  const status = known.status ?? ERROR_CODES[known.code] ?? 500;
  const body = { code: known.code, message: known.message, requestId };
  if (known.details?.length) body.details = known.details;
  res.status(status).json({ error: body });
}

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}
