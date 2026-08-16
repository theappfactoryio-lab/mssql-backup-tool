import path from 'node:path';
import { ValidationError } from './errors/app-error.js';

const GIB = 1024 ** 3;

function integer(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ValidationError(`${name} musi być liczbą całkowitą od ${min} do ${max}.`);
  }
  return value;
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new ValidationError(`Brak wymaganej zmiennej ${name}.`);
  return value;
}

function boolean(env, name, fallback = false) {
  if (env[name] === undefined) return fallback;
  if (env[name] === 'true') return true;
  if (env[name] === 'false') return false;
  throw new ValidationError(`${name} musi mieć wartość true albo false.`);
}

function absolutePath(env, name, fallback) {
  const value = env[name]?.trim() || fallback;
  if (!path.posix.isAbsolute(value)) {
    throw new ValidationError(`${name} musi być bezwzględną ścieżką POSIX.`);
  }
  return value.replace(/\/$/, '') || '/';
}

export function loadConfig(env = process.env) {
  return {
    host: env.APP_HOST?.trim() || '0.0.0.0',
    port: integer(env, 'PORT', 8080, { min: 1, max: 65535 }),
    publicOrigin: env.PUBLIC_ORIGIN?.trim() || 'http://localhost:8080',
    backupPath: absolutePath(env, 'APP_BACKUP_PATH', '/app/backups'),
    sqlBackupPath: absolutePath(env, 'MSSQL_BACKUP_PATH', '/var/opt/mssql/backup'),
    sqlDataPath: absolutePath(env, 'MSSQL_DATA_PATH', '/var/opt/mssql/data'),
    sqlLogPath: absolutePath(env, 'MSSQL_LOG_PATH', '/var/opt/mssql/data'),
    maxUploadBytes: integer(env, 'MAX_UPLOAD_BYTES', 50 * GIB, { min: 1 }),
    maxExtractedBytes: integer(env, 'MAX_EXTRACTED_BYTES', 100 * GIB, { min: 1 }),
    maxCompressionRatio: integer(env, 'MAX_COMPRESSION_RATIO', 200, { min: 1 }),
    tempMaxAgeHours: integer(env, 'TEMP_MAX_AGE_HOURS', 24, { min: 1 }),
    requestTimeoutMs: integer(env, 'HTTP_REQUEST_TIMEOUT_MS', 0),
    enableShrinkLog: boolean(env, 'ENABLE_SHRINK_LOG'),
    database: {
      server: required(env, 'MSSQL_HOST'),
      port: integer(env, 'MSSQL_PORT', 1433, { min: 1, max: 65535 }),
      user: required(env, 'MSSQL_USER'),
      password: required(env, 'MSSQL_PASSWORD'),
      encrypt: env.MSSQL_ENCRYPT === 'true',
      trustServerCertificate: env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
      connectionTimeout: integer(env, 'MSSQL_CONNECTION_TIMEOUT_MS', 15000, { min: 1 }),
      requestTimeout: integer(env, 'MSSQL_REQUEST_TIMEOUT_MS', 0),
    },
  };
}