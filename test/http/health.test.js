import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { OperationManager } from '../../src/operations/operation-manager.js';

test('healthcheck nie zależy od MSSQL', async () => {
  const app = createApp({
    config: { maxUploadBytes: 1 },
    operationManager: new OperationManager(),
    services: { database: { listDatabases: () => { throw new Error('SQL offline'); } } },
  });
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('renderuje ekran roboczy z bazami i plikami', async () => {
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080' },
    operationManager: new OperationManager(),
    services: {
      database: { listDatabases: async () => ['Demo'], listDatabaseDetails: async () => [{
        name: 'Demo', state: 'ONLINE', dataSizeBytes: 1024, logSizeBytes: 512,
        totalSizeBytes: 1536, activeConnections: 2, recoveryModel: 'SIMPLE', lastFullBackupAt: null,
        logReuseWait: 'NOTHING', logFileCount: 1, isReadOnly: false,
      }] },
      files: { list: async () => [{ name: 'Demo.bak', format: '.bak', size: 1024, modifiedAt: new Date() }] },
    },
  });
  const response = await request(app).get('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /Wykonaj backup/);
  assert.match(response.text, /Bazy danych i ich parametry administracyjne/);
  assert.match(response.text, /SIMPLE/);
  assert.match(response.text, /Demo\.bak/);
});

test('renderuje informacje o środowisku SQL Server', async () => {
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080',
      database: { server: 'mssql', port: 1433 } },
    operationManager: new OperationManager(),
    services: {
      database: {
        listDatabases: async () => ['Demo'],
        listDatabaseDetails: async () => [],
        getEnvironmentInfo: async () => ({
          serverName: 'SQL01\\DEV', machineName: 'SQL01', instanceName: 'DEV',
          productVersion: '16.0.1000.6', releaseName: 'SQL Server 2022',
          productLevel: 'RTM', edition: 'Developer Edition', databaseName: 'master',
          loginName: 'app_user', netTransport: 'TCP', authenticationScheme: 'SQL',
        }),
      },
      files: { list: async () => [] },
    },
  });

  const response = await request(app).get('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /Środowisko SQL Server/);
  assert.match(response.text, /SQL01\\DEV/);
  assert.match(response.text, /SQL Server 2022 · 16\.0\.1000\.6 \(RTM\)/);
  assert.match(response.text, /Developer Edition/);
  assert.match(response.text, /hx-get="\/partials\/sql-environment"/);
  assert.match(response.text, /hx-get="\/partials\/files"/);
  assert.match(response.text, /hx-get="\/partials\/databases"/);
  assert.doesNotMatch(response.text, /hx-trigger="every/);
  assert.match(response.text, /href="https:\/\/learn\.microsoft\.com\/en-us\/troubleshoot\/sql\/releases\/download-and-install-latest-updates"/);
  assert.match(response.text, /target="_blank" rel="noopener noreferrer"/);
  assert.match(response.text, /mssql:1433/);
});

test('pokazuje bezpieczny stan braku połączenia bez blokowania strony', async () => {
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080',
      database: { server: 'mssql', port: 1433 } },
    operationManager: new OperationManager(),
    services: {
      database: {
        listDatabases: async () => { throw new Error('Login tajny_admin odrzucony'); },
        listDatabaseDetails: async () => { throw new Error('Login tajny_admin odrzucony'); },
        getEnvironmentInfo: async () => { throw new Error('Login tajny_admin odrzucony'); },
      },
      files: { list: async () => [{ name: 'offline.bak', format: '.bak', size: 1, modifiedAt: new Date() }] },
    },
  });

  const response = await request(app).get('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /Nie można nawiązać połączenia z SQL Serverem/);
  assert.match(response.text, /Lista baz jest niedostępna/);
  assert.match(response.text, /offline\.bak/);
  assert.doesNotMatch(response.text, /tajny_admin/);

  const partial = await request(app).get('/partials/sql-environment');
  assert.equal(partial.status, 200);
  assert.match(partial.text, /Brak połączenia/);
  assert.doesNotMatch(partial.text, /tajny_admin/);
});

test('uruchamia backup bez oczekiwania i blokuje drugie żądanie', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const manager = new OperationManager();
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080' },
    operationManager: manager,
    services: { backup: { run: () => pending } },
  });
  const page = await request(app).get('/');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const first = await request(app).post('/operations/backup').type('form')
    .send({ _csrf: token, databaseName: 'Demo', compression: 'none' });
  assert.equal(first.status, 202);
  const second = await request(app).post('/operations/backup').type('form')
    .send({ _csrf: token, databaseName: 'Demo', compression: 'none' });
  assert.equal(second.status, 409);
  release();
});

test('wymaga potwierdzenia usunięcia pliku', async () => {
  let deleted = false;
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080' },
    operationManager: new OperationManager(),
    services: {
      database: { listDatabases: async () => [] },
      files: { list: async () => [], delete: async () => { deleted = true; } },
    },
  });
  const page = await request(app).get('/');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const response = await request(app).post('/files/delete').type('form')
    .send({ _csrf: token, filename: 'Demo.bak' });
  assert.equal(response.status, 422);
  assert.equal(deleted, false);
});

test('po zakończeniu operacji odświeża bazy i pliki przez OOB', async () => {
  const manager = new OperationManager();
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080' },
    operationManager: manager,
    services: {
      database: { listDatabases: async () => ['PoRestore'], listDatabaseDetails: async () => [{
        name: 'PoRestore', state: 'ONLINE', dataSizeBytes: 1, logSizeBytes: 1, totalSizeBytes: 2,
        activeConnections: 0, recoveryModel: 'SIMPLE', lastFullBackupAt: null,
        logReuseWait: 'NOTHING', logFileCount: 1, isReadOnly: false,
      }] },
      files: { list: async () => [{ name: 'nowy.bak', format: '.bak', size: 42, modifiedAt: new Date() }] },
    },
  });
  manager.tryStart({ type: 'restore', summary: 'Restore', work: async () => ({ databaseName: 'PoRestore' }) });
  await new Promise((resolve) => setImmediate(resolve));

  const response = await request(app).get('/partials/operation');
  assert.equal(response.status, 200);
  assert.match(response.text, /hx-swap-oob="outerHTML"/);
  assert.match(response.text, /id="file-table-wrap"/);
  assert.match(response.text, /PoRestore/);
  assert.match(response.text, /nowy\.bak/);
});

test('odświeża niezależnie sekcje plików i baz danych', async () => {
  let fileCalls = 0;
  let databaseCalls = 0;
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080' },
    operationManager: new OperationManager(),
    services: {
      database: {
        listDatabases: async () => ['OdświeżonaBaza'],
        listDatabaseDetails: async () => { databaseCalls += 1; return [{
          name: 'OdświeżonaBaza', state: 'ONLINE', dataSizeBytes: 1, logSizeBytes: 1, totalSizeBytes: 2,
          activeConnections: 0, recoveryModel: 'SIMPLE', lastFullBackupAt: null,
          logReuseWait: 'NOTHING', logFileCount: 1, isReadOnly: false,
        }]; },
      },
      files: { list: async () => { fileCalls += 1; return [{
        name: 'odswiezony.bak', format: '.bak', size: 1, modifiedAt: new Date(),
      }]; } },
    },
  });

  const files = await request(app).get('/partials/files');
  assert.equal(files.status, 200);
  assert.match(files.text, /id="files-section-data"/);
  assert.match(files.text, /odswiezony\.bak/);
  assert.equal(fileCalls, 1);
  assert.equal(databaseCalls, 0);

  const databases = await request(app).get('/partials/databases');
  assert.equal(databases.status, 200);
  assert.match(databases.text, /id="database-table-wrap"/);
  assert.match(databases.text, /OdświeżonaBaza/);
  assert.equal(fileCalls, 1);
  assert.equal(databaseCalls, 1);
});

test('uruchamia potwierdzony shrink logu i odrzuca nieznany tryb', async () => {
  let received;
  const manager = new OperationManager();
  const app = createApp({
    config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080', enableShrinkLog: true },
    operationManager: manager,
    services: {
      database: {
        listDatabases: async () => ['Demo'], listDatabaseDetails: async () => [],
        shrinkTransactionLog: async (...args) => { received = args; return {
          databaseName: 'Demo', beforeBytes: 1024, afterBytes: 512, reclaimedBytes: 512,
        }; },
      },
      files: { list: async () => [] },
    },
  });
  const page = await request(app).get('/');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const invalid = await request(app).post('/databases/shrink-log').type('form')
    .send({ _csrf: token, databaseName: 'Demo', mode: 'arbitrary', confirmShrinkLog: 'yes' });
  assert.equal(invalid.status, 422);

  const response = await request(app).post('/databases/shrink-log').type('form')
    .send({ _csrf: token, databaseName: 'Demo', mode: 'safe', confirmShrinkLog: 'yes', fileId: 99 });
  assert.equal(response.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, ['Demo', 'safe', { enabled: true }]);
});