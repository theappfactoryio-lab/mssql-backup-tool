import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../../src/config.js';

const validEnv = {
  MSSQL_HOST: 'mssql',
  MSSQL_USER: 'sa',
  MSSQL_PASSWORD: 'secret',
};

test('ładuje bezpieczne wartości domyślne', () => {
  const config = loadConfig(validEnv);
  assert.equal(config.port, 8080);
  assert.equal(config.maxUploadBytes, 50 * 1024 ** 3);
  assert.equal(config.maxExtractedBytes, 100 * 1024 ** 3);
  assert.equal(config.enableShrinkLog, false);
  assert.equal(config.database.requestTimeout, 0);
});

test('wymaga ścisłej wartości logicznej dla shrink logu', () => {
  assert.equal(loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: 'true' }).enableShrinkLog, true);
  assert.equal(loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: 'false' }).enableShrinkLog, false);
  assert.throws(() => loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: 'yes' }), /true albo false/);
  assert.throws(() => loadConfig({ ...validEnv, ENABLE_SHRINK_LOG: '1' }), /true albo false/);
});

test('odrzuca względne ścieżki i brak sekretu', () => {
  assert.throws(() => loadConfig({ ...validEnv, APP_BACKUP_PATH: 'backups' }), /bezwzględną/);
  assert.throws(() => loadConfig({ MSSQL_HOST: 'mssql', MSSQL_USER: 'sa' }), /MSSQL_PASSWORD/);
});