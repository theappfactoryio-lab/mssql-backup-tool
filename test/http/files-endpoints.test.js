import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { OperationManager } from '../../src/operations/operation-manager.js';
import { FileService } from '../../src/services/file-service.js';
import { loadConfig } from '../../src/config.js';

test('files endpoints require CSRF and Origin and return 202 for accepted operations', async () => {
  const manager = new OperationManager();
  const files = {
    list: async () => [{ name: 'x.bak', format: '.bak', size: 1, modifiedAt: new Date() }],
    inspect: async () => ({ filePath: '/tmp/x', info: { isFile: () => true } }),
    rename: async (oldName, newBase) => ({ filename: `${newBase}.bak` }),
  };
  const app = createApp({ config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080' }, operationManager: manager, services: { files } });
  const page = await request(app).get('/');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];

  // missing CSRF
  let res = await request(app).post('/files/rename').type('form').send({ filename: 'x.bak', newBase: 'y' });
  assert.equal(res.status, 422);

  // wrong origin
  res = await request(app).post('/files/rename').set('Origin', 'http://evil.example').type('form').send({ _csrf: token, filename: 'x.bak', newBase: 'y' });
  assert.equal(res.status, 422);

  // accepted
  res = await request(app).post('/files/rename').set('Origin', 'http://localhost:8080').type('form').send({ _csrf: token, filename: 'x.bak', newBase: 'y' });
  assert.equal(res.status, 202);
});

test('files mutations accept both configured protocols while preserving CSRF', async () => {
  const origins = ['http://backup.example.test', 'https://backup.example.test'];
  for (const origin of origins) {
    const calls = [];
    const config = loadConfig({
      PUBLIC_ORIGINS: origins.join(','), PUBLIC_ORIGIN: 'http://legacy.example.test',
      AUTH_ENABLED: 'false', MSSQL_HOST: 'stub', MSSQL_USER: 'stub', MSSQL_PASSWORD: 'stub',
    });
    const app = createApp({
      config,
      operationManager: new OperationManager(),
      services: { files: {
        list: async () => [],
        rename: async (filename, newBase) => {
          calls.push({ filename, newBase });
          return { filename: `${newBase}.bak` };
        },
      } },
    });
    const input = { filename: 'sample.bak', newBase: 'renamed' };
    const rejected = await request(app).post('/files/rename').set('Origin', origin).type('form').send(input);
    assert.equal(rejected.status, 422);
    const legacy = await request(app).post('/files/rename').set('Origin', 'http://legacy.example.test')
      .type('form').send({ ...input, _csrf: app.locals.csrfToken });
    assert.equal(legacy.status, 422);
    assert.deepEqual(calls, []);
    const accepted = await request(app).post('/files/rename').set('Origin', origin)
      .type('form').send({ ...input, _csrf: app.locals.csrfToken });
    assert.equal(accepted.status, 202);
    assert.deepEqual(calls, [input]);
  }
});

test('download streams the complete file and closes its handle', async () => {
  const backupPath = await mkdtemp(path.join(tmpdir(), 'mssql-backup-download-'));
  try {
    const payload = Buffer.alloc(256 * 1024, 0x5a);
    await writeFile(path.join(backupPath, 'sample.bak'), payload);
    const files = new FileService({ backupPath, sqlBackupPath: '/var/opt/mssql/backup' });
    await files.initialize();
    const app = createApp({
      config: { maxUploadBytes: 1024, publicOrigin: 'http://localhost:8080' },
      operationManager: new OperationManager(),
      services: { files },
    });

    const response = await request(app).get('/files/sample.bak/download').buffer(true);

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-length'], String(payload.length));
    assert.match(response.headers['content-disposition'], /^attachment; filename="?sample\.bak"?/);
    assert.equal(response.headers['accept-ranges'], undefined);
    assert.deepEqual(response.body, payload);
  } finally {
    await rm(backupPath, { recursive: true, force: true });
  }
});
