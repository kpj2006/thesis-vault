// Conceptual error codes from the Lab 7 Software Interface Specification.
export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const fail = (code, message, status, details) => { throw new AppError(code, message, status, details); };

export const unauthorized = (msg = 'Please sign in to continue.') => new AppError('UNAUTHORIZED', msg, 401);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new AppError('ACCESS_DENIED', msg, 403);
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`, 404);

export function errorHandler(err, req, res, _next) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'INVALID_FILE', message: 'File is larger than the 50 MB limit.' } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'PERSISTENCE_ERROR', message: 'An unexpected server error occurred. No changes were saved.' } });
}

// Wraps async route handlers so rejections reach the error handler.
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
