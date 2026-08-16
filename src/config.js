import path from 'node:path';
import { ValidationError } from './errors/app-error.js';
import { createTranslator, normalizeLanguage, SUPPORTED_LANGUAGES } from './i18n/index.js';

const GIB = 1024 ** 3;

function integer(env, name, fallback, t, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new ValidationError(t('config.integerOutOfRange', { name, min, max }));
  return value;
}

function required(env, name, t) {
  const value = env[name]?.trim();
  if (!value) throw new ValidationError(t('config.requiredVariableMissing', { name }));
  return value;
}

function boolean(env, name, fallback, t) {
  if (env[name] === undefined) return fallback;
  if (env[name] === 'true') return true;
  if (env[name] === 'false') return false;
  throw new ValidationError(t('config.booleanInvalid', { name }));
}

function absolutePath(env, name, fallback, t) {
  const value = env[name]?.trim() || fallback;
  if (!path.posix.isAbsolute(value)) throw new ValidationError(t('config.absolutePosixPathRequired', { name }));
  return value.replace(/\/$/, '') || '/';
}

export function loadConfig(env = process.env) {
  const requestedLanguage = env.APP_LANGUAGE?.trim() || 'en';
  const defaultLanguage = normalizeLanguage(requestedLanguage);
  if (!defaultLanguage) throw new ValidationError(createTranslator('en').t('config.languageUnsupported', { supportedLanguages: SUPPORTED_LANGUAGES.join(', ') }));
  const { t } = createTranslator(defaultLanguage);
  const authEnabled = boolean(env, 'AUTH_ENABLED', true, t);

  return {
    defaultLanguage,
    host: env.APP_HOST?.trim() || '0.0.0.0',
    port: integer(env, 'PORT', 8080, t, { min: 1, max: 65535 }),
    publicOrigin: env.PUBLIC_ORIGIN?.trim() || 'http://localhost:8080',
    auth: {
      enabled: authEnabled,
      username: authEnabled ? required(env, 'AUTH_USERNAME', t) : null,
      password: authEnabled ? required(env, 'AUTH_PASSWORD', t) : null,
    },
    backupPath: absolutePath(env, 'APP_BACKUP_PATH', '/app/backups', t),
    sqlBackupPath: absolutePath(env, 'MSSQL_BACKUP_PATH', '/var/opt/mssql/backup', t),
    sqlDataPath: absolutePath(env, 'MSSQL_DATA_PATH', '/var/opt/mssql/data', t),
    sqlLogPath: absolutePath(env, 'MSSQL_LOG_PATH', '/var/opt/mssql/data', t),
    maxUploadBytes: integer(env, 'MAX_UPLOAD_BYTES', 50 * GIB, t, { min: 1 }),
    maxExtractedBytes: integer(env, 'MAX_EXTRACTED_BYTES', 100 * GIB, t, { min: 1 }),
    maxCompressionRatio: integer(env, 'MAX_COMPRESSION_RATIO', 200, t, { min: 1 }),
    tempMaxAgeHours: integer(env, 'TEMP_MAX_AGE_HOURS', 24, t, { min: 1 }),
    requestTimeoutMs: integer(env, 'HTTP_REQUEST_TIMEOUT_MS', 0, t),
    enableShrinkLog: boolean(env, 'ENABLE_SHRINK_LOG', false, t),
    database: {
      server: required(env, 'MSSQL_HOST', t),
      port: integer(env, 'MSSQL_PORT', 1433, t, { min: 1, max: 65535 }),
      user: required(env, 'MSSQL_USER', t),
      password: required(env, 'MSSQL_PASSWORD', t),
      encrypt: env.MSSQL_ENCRYPT === 'true',
      trustServerCertificate: env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
      connectionTimeout: integer(env, 'MSSQL_CONNECTION_TIMEOUT_MS', 15000, t, { min: 1 }),
      requestTimeout: integer(env, 'MSSQL_REQUEST_TIMEOUT_MS', 0, t),
    },
  };
}