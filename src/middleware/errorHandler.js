import { AppError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Global error handler
 */
export const errorHandler = (err, req, res, _next) => {
  const logContext = {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.session?.userId,
    userAgent: req.get('User-Agent'),
  };

  if (err instanceof AppError && err.isOperational) {
    const level = err.code === 'AUTH_REQUIRED' ? 'debug' : 'warn';
    logger[level](err.message, { ...logContext, code: err.code, ...(err.errors && { details: err.errors }) });
  } else {
    logger.error(err.message, { ...logContext, stack: err.stack });
  }

  if (err instanceof AppError) {
    const response = {
      success: false,
      error: {
        message: err.message,
        code: err.code,
      },
    };

    if (err instanceof ValidationError && err.errors?.length > 0) {
      response.error.details = err.errors;
    } else if (err.details) {
      // Context the client needs to act, e.g. the possible duplicates of an entry.
      response.error.details = err.details;
    }

    if (config.isDev) {
      response.error.stack = err.stack;
    }

    return res.status(err.statusCode).json(response);
  }

  // Zod validation error
  if (err.name === 'ZodError') {
    const errors = err.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    return res.status(422).json({
      success: false,
      error: {
        message: 'Invalid data',
        code: 'VALIDATION_ERROR',
        details: errors,
      },
    });
  }

  // SQLite error
  if (err.code?.startsWith('SQLITE_')) {
    logger.error('Database error', { ...logContext, sqliteCode: err.code });

    return res.status(500).json({
      success: false,
      error: {
        message: 'Database error',
        code: 'DATABASE_ERROR',
        ...(config.isDev && { details: err.message }),
      },
    });
  }

  // Generic error
  return res.status(500).json({
    success: false,
    error: {
      message: config.isProd ? 'Internal server error' : err.message,
      code: 'INTERNAL_ERROR',
      ...(config.isDev && { stack: err.stack }),
    },
  });
};

/**
 * Handler for routes not found
 */
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
      code: 'ROUTE_NOT_FOUND',
      path: req.path,
    },
  });
};

/**
 * Async wrapper for controllers
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
