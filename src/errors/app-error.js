export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', statusCode = 500, userMessage = message, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 422, userMessage: message });
  }
}