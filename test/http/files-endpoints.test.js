import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { OperationManager } from '../../src/operations/operation-manager.js';

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
