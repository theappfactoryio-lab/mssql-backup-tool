import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { OperationManager } from '../../src/operations/operation-manager.js';
import { message } from '../../src/i18n/index.js';

function createLocalizedApp(defaultLanguage = 'en', manager = new OperationManager()) {
  return createApp({
    config: {
      defaultLanguage,
      maxUploadBytes: 1024,
      publicOrigin: 'http://localhost:8080',
      auth: { enabled: false },
    },
    operationManager: manager,
    services: {
      database: { listDatabases: async () => [], listDatabaseDetails: async () => [] },
      files: { list: async () => [] },
    },
  });
}

test('renders every supported language selected by cookie', async () => {
  const app = createLocalizedApp();
  const expectations = {
    en: ['Create backup', 'Backup files'],
    de: ['Sicherung erstellen', 'Sicherungsdateien'],
    es: ['Crear copia de seguridad', 'Archivos de copia de seguridad'],
    pl: ['Wykonaj backup', 'Pliki backupów'],
  };
  for (const [language, labels] of Object.entries(expectations)) {
    const response = await request(app).get('/').set('Cookie', `ui_language=${language}`);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(`<html lang="${language}">`));
    for (const label of labels) assert.match(response.text, new RegExp(label));
  }
});

test('uses environment default and ignores an invalid language cookie', async () => {
  const response = await request(createLocalizedApp('es')).get('/').set('Cookie', 'ui_language=fr');
  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="es">/);
  assert.match(response.text, /Crear copia de seguridad/);
});

test('language endpoint validates CSRF and persists a supported language', async () => {
  const app = createLocalizedApp();
  const page = await request(app).get('/');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const response = await request(app).post('/language').type('form').send({ _csrf: token, language: 'de' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/');
  assert.match(response.headers['set-cookie'][0], /^ui_language=de;/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
  const nullOrigin = await request(app).post('/language').set('Origin', 'null')
    .type('form').send({ _csrf: token, language: 'pl' });
  assert.equal(nullOrigin.status, 303);
  assert.match(nullOrigin.headers['set-cookie'][0], /^ui_language=pl;/);
  const foreignOrigin = await request(app).post('/language').set('Origin', 'https://example.invalid')
    .type('form').send({ _csrf: token, language: 'pl' });
  assert.equal(foreignOrigin.status, 422);
  const invalid = await request(app).post('/language').type('form').send({ _csrf: token, language: 'fr' });
  assert.equal(invalid.status, 422);
});

test('translates stored operation descriptors after language changes', async () => {
  let finish;
  const manager = new OperationManager();
  manager.tryStart({
    type: 'verify',
    summary: message('operation.summary.fileVerifying', { filename: 'Demo.bak' }),
    work: () => new Promise((resolve) => { finish = resolve; }),
  });
  const app = createLocalizedApp('en', manager);
  const english = await request(app).get('/operations/current');
  const polish = await request(app).get('/operations/current').set('Cookie', 'ui_language=pl');
  assert.equal(english.body.operation.summary, 'Verifying Demo.bak');
  assert.equal(polish.body.operation.summary, 'Weryfikowanie Demo.bak');
  finish();
});
