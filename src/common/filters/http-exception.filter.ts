import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter — the NestJS analog of Spring's
 * @RestControllerAdvice / GlobalExceptionHandler. Produces a consistent JSON
 * error envelope. Adjust the shape here if the frontend depends on Spring's
 * exact error body (verify during Phase 5 contract testing).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Internal server error';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as Record<string, unknown>).message ?? res;
    } else if (exception instanceof Error && /Cannot convert .+ to a BigInt/i.test(exception.message)) {
      // A malformed id path param (e.g. "undefined"/"NaN") reached a BigInt() conversion.
      // Treat as a client error rather than crashing with a 500.
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid or missing id parameter';
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
    });
  }
}
