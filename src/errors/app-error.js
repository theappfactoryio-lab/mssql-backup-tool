function technicalMessage(value) {
  if (typeof value === 'string') return value;
  if (value?.key) return value.key;
  if (Object.hasOwn(value ?? {}, 'raw')) return String(value.raw ?? '');
  return 'Application error';
}

export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', statusCode = 500, userMessage = message, publicMessage = userMessage, cause } = {}) {
    super(technicalMessage(message), { cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
    this.userMessage = publicMessage;
  }
}

export class ValidationError extends AppError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'VALIDATION_ERROR', statusCode: 422, publicMessage: options.publicMessage ?? message });
  }
}