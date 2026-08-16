import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { createBasicAuthMiddleware } from '../../src/middleware/basic-auth.js';

function appWith(auth) {
  const app = express();
  app.use(createBasicAuthMiddleware(auth));
  app.get('/', (req, res) => res.sendStatus(204));
  return app;
}

const auth = { enabled: true, username: 'operator', password: 'sekret:część' };

for (const authorization of [undefined, 'Bearer token', 'Basic !!!=', `Basic ${Buffer.from('bez-separatora').toString('base64')}`]) {
  test(`odrzuca nieprawidłowy nagłówek: ${authorization ?? 'brak'}`, async () => {
    let call = request(appWith(auth)).get('/');
    if (authorization) call = call.set('Authorization', authorization);
    const response = await call;
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Basic realm="MSSQLBackupTool", charset="UTF-8"');
    assert.doesNotMatch(response.text, /operator|sekret/);
  });
}

test('odrzuca błędny login i błędne hasło', async () => {
  const app = appWith(auth);
  assert.equal((await request(app).get('/').auth('inny', auth.password)).status, 401);
  assert.equal((await request(app).get('/').auth(auth.username, 'inne')).status, 401);
});

test('akceptuje UTF-8 i dwukropek w haśle', async () => {
  const response = await request(appWith(auth)).get('/').auth(auth.username, auth.password);
  assert.equal(response.status, 204);
});

test('przepuszcza żądanie, gdy uwierzytelnianie jest wyłączone', async () => {
  const response = await request(appWith({ enabled: false })).get('/');
  assert.equal(response.status, 204);
});
