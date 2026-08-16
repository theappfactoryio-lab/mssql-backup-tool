import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../../src/config.js';

const validEnv = {
  MSSQL_HOST: 'mssql',
  MSSQL_USER: 'sa',
  MSSQL_PASSWORD: 'secret',
  AUTH_USERNAME: 'operator',
  AUTH_PASSWORD: 'auth-secret',
};

test('ładuje bezpieczne wartości domyślne', () => {
  const config = loadConfig(validEnv);
  assert.equal(config.defaultLanguage, 'en');
  assert.equal(config.port, 8080);
  assert.equal(config.maxUploadBytes, 50 * 1024 ** 3);
  assert.equal(config.maxExtractedBytes, 100 * 1024 ** 3);
  assert.equal(config.enableShrinkLog, false);
  assert.equal(config.auth.enabled, true);
  assert.equal(config.auth.username, 'operator');
  assert.equal(config.auth.password, 'auth-secret');
  assert.equal(config.database.requestTimeout, 0);
});

test('waliduje konfigurację uwierzytelniania', () => {
  assert.equal(loadConfig({ ...validEnv, AUTH_ENABLED: 'true' }).auth.enabled, true);
  assert.deepEqual(loadConfig({
    MSSQL_HOST: 'mssql', MSSQL_USER: 'sa', MSSQL_PASSWORD: 'secret', AUTH_ENABLED: 'false',
  }).auth, { enabled: false, username: null, password: null });
  assert.throws(() => loadConfig({ ...validEnv, AUTH_ENABLED: 'yes' }), /true or false/);
  assert.throws(() => loadConfig({ ...validEnv, AUTH_USERNAME: '   ' }), /AUTH_USERNAME/);
  assert.throws(() => loadConfig({ ...validEnv, AUTH_PASSWORD: '   ' }), /AUTH_PASSWORD/);
  assert.throws(() => loadConfig({
    MSSQL_HOST: 'mssql', MSSQL_USER: 'sa', MSSQL_PASSWORD: 'secret',
  }), /AUTH_USERNAME/);
});

test('wymaga ścisłej wartości logicznej dla shrink logu', () => {
  assert.equal(loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: 'true' }).enableShrinkLog, true);
  assert.equal(loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: 'false' }).enableShrinkLog, false);
  assert.throws(() => loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: 'yes' }), /true or false/);
  assert.throws(() => loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: '1' }), /true or false/);
});

test('obsługuje cztery języki i odrzuca nieznany', () => {
  for (const language of ['en', 'de', 'es', 'pl']) assert.equal(loadConfig({ ...validEnv, APP_LANGUAGE: language }).defaultLanguage, language);
  assert.equal(loadConfig({ ...validEnv, APP_LANGUAGE: ' DE-de ' }).defaultLanguage, 'de');
  assert.throws(() => loadConfig({ ...validEnv, APP_LANGUAGE: 'fr' }), /APP_LANGUAGE must be one of/);
});

test('odrzuca względne ścieżki i brak sekretu', () => {
  assert.throws(() => loadConfig({ ...validEnv, APP_BACKUP_PATH: 'backups' }), /absolute POSIX path/);
  assert.throws(() => loadConfig({
    MSSQL_HOST: 'mssql', MSSQL_USER: 'sa', AUTH_ENABLED: 'false',
  }), /MSSQL_PASSWORD/);
});