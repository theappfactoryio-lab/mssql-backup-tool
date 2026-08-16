import { OperationBusyError } from '../operations/operation-manager.js';

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  const statusCode = error instanceof OperationBusyError
    ? 409
    : error.statusCode ?? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message = error.userMessage
    ?? (statusCode < 500 ? error.message : 'Wystąpił nieoczekiwany błąd.');

  if (statusCode >= 500) {
    console.error(`[${error.code ?? 'UNEXPECTED_ERROR'}] ${error.message}`);
  }

  if (request.get('HX-Request') === 'true') {
    if (error instanceof OperationBusyError && error.operation) {
      return response.status(statusCode).render('partials/operation-status', {
        operation: error.operation, refreshData: false, databases: [], databaseDetails: [],
        databasesAvailable: true, files: [], csrfToken: response.app.locals.csrfToken,
        enableShrinkLog: response.app.locals.enableShrinkLog,
      });
    }
    return response.status(statusCode).render('partials/message', { type: 'error', message });
  }
  return response.status(statusCode).json({ error: { code: error.code ?? 'APP_ERROR', message } });
}