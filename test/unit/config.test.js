import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../../src/config.js';
import { ValidationError } from '../../src/errors/app-error.js';

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
  assert.equal(config.publicOrigin, 'http://localhost:8080');
  assert.deepEqual(config.publicOrigins, ['http://localhost:8080']);
  assert.equal(config.maxUploadBytes, 50 * 1024 ** 3);
  assert.equal(config.maxExtractedBytes, 100 * 1024 ** 3);
  assert.equal(config.enableShrinkLog, false);
  assert.equal(config.auth.enabled, true);
  assert.equal(config.auth.username, 'operator');
  assert.equal(config.auth.password, 'auth-secret');
  assert.equal(config.database.requestTimeout, 0);
});

test('zachowuje PUBLIC_ORIGIN przy braku albo pustej liście', () => {
  for (const publicOrigins of [undefined, '', ' \t ']) {
    const config = loadConfig({
      ...validEnv, PUBLIC_ORIGINS: publicOrigins, PUBLIC_ORIGIN: ' HTTPS://Backup.EXAMPLE.test:443/ ',
    });
    assert.deepEqual(config.publicOrigins, ['https://backup.example.test']);
    assert.equal(config.publicOrigin, 'https://backup.example.test');
    const defaults = loadConfig({ ...validEnv, PUBLIC_ORIGINS: publicOrigins, PUBLIC_ORIGIN: ' ' });
    assert.deepEqual(defaults.publicOrigins, ['http://localhost:8080']);
  }
});

test('niepusta lista ma pierwszeństwo i nie dopisuje originu legacy', () => {
  for (const publicOrigin of ['http://legacy.example.test', 'invalid']) {
    const config = loadConfig({
      ...validEnv, PUBLIC_ORIGIN: publicOrigin,
      PUBLIC_ORIGINS: 'http://backup.example.test,https://backup.example.test',
    });
    assert.deepEqual(config.publicOrigins, ['http://backup.example.test', 'https://backup.example.test']);
    assert.equal(config.publicOrigin, 'http://backup.example.test');
  }
});

test('normalizuje originy, usuwa duplikaty i zachowuje jawne porty oraz IPv6', () => {
  const config = loadConfig({
    ...validEnv,
    PUBLIC_ORIGINS: ' HTTP://Backup.EXAMPLE.test:80/ , https://BACKUP.example.test:443/ , http://backup.example.test , https://backup.example.test:8443 , http://[::1]:8080/ , http://backup.example.test:65535 ',
  });
  assert.deepEqual(config.publicOrigins, [
    'http://backup.example.test', 'https://backup.example.test', 'https://backup.example.test:8443',
    'http://[::1]:8080', 'http://backup.example.test:65535',
  ]);
  assert.equal(config.publicOrigin, config.publicOrigins[0]);
});

test('odrzuca wartości inne niż pełne originy HTTP/HTTPS', () => {
  const invalidOrigins = [
    'null', '*', 'ftp://backup.example.test', 'file:///backup', 'https://',
    'http://*.example.test', 'https://%2a.example.test',
    'https://user:secret@backup.example.test', 'https://@backup.example.test',
    'https://backup.example.test/path', 'https://backup.example.test/.',
    'https://backup.example.test?query=1', 'https://backup.example.test?',
    'https://backup.example.test#fragment', 'https://backup.example.test#',
    'http:backup.example.test', 'http:///backup.example.test', 'http://backup.example.test\\',
    'http://back up.example.test', 'http://back\nup.example.test',
    'http://backup.example.test:', 'http://backup.example.test:0',
    'http://backup.example.test:65536', 'http://backup.example.test:invalid',
  ];
  for (const name of ['PUBLIC_ORIGIN', 'PUBLIC_ORIGINS']) {
    for (const origin of invalidOrigins) {
      assert.throws(() => loadConfig({ ...validEnv, [name]: origin }), (error) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.message, new RegExp(name));
        return true;
      }, `${name}: ${origin}`);
    }
  }
});

test('odrzuca puste elementy niepustej listy', () => {
  for (const value of [',', ',http://backup.example.test', 'http://backup.example.test,',
    'http://backup.example.test, ,https://backup.example.test']) {
    assert.throws(() => loadConfig({ ...validEnv, PUBLIC_ORIGINS: value }), ValidationError);
  }
});

test('lokalizuje błąd originu bez ujawniania wartości konfiguracji', () => {
  const messages = new Set();
  for (const language of ['en', 'de', 'es', 'pl']) {
    assert.throws(() => loadConfig({
      ...validEnv, APP_LANGUAGE: language, PUBLIC_ORIGINS: 'https://user:secret@backup.example.test',
    }), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.match(error.message, /PUBLIC_ORIGINS/);
      assert.doesNotMatch(error.message, /user:secret|backup\.example\.test/);
      messages.add(error.message);
      return true;
    });
  }
  assert.equal(messages.size, 4);
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