import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export interface AppError extends Error {
  statusCode?: number;
  errors?: Record<string, unknown> | Array<unknown>;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(`[${req.method} ${req.url}] Error: ${message}`, {
    stack: err.stack,
    statusCode
  });

  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || undefined,
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
};
