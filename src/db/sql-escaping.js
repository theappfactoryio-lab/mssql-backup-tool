import { ValidationError } from '../errors/app-error.js';

export function quoteIdentifier(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\0\x00-\x1f]/.test(value)) {
    throw new ValidationError('Nieprawidłowa nazwa bazy danych.');
  }
  return `[${value.replaceAll(']', ']]')}]`;
}

export function unicodeSqlLiteral(value) {
  if (typeof value !== 'string' || /\0/.test(value)) throw new ValidationError('Nieprawidłowa wartość SQL.');
  return `N'${value.replaceAll("'", "''")}'`;
}