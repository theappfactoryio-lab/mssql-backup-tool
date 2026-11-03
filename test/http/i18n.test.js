import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { OperationManager } from '../../src/operations/operation-manager.js';
import { message } from '../../src/i18n/index.js';

function createLocalizedApp(defaultLanguage = 'en', manager = new OperationManager(), config = {}) {
  return createApp({
    config: {
      defaultLanguage,
      maxUploadBytes: 1024,
      publicOrigin: 'http://localhost:8080',
      auth: { enabled: false },
      ...config,
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

test('keeps legacy cookie and HSTS policies except in mixed HTTP/HTTPS mode', async () => {
  const httpOrigin = 'http://backup.example.test';
  const httpsOrigin = 'https://backup.example.test';
  const cases = [
    { config: { publicOrigin: httpOrigin }, origin: httpOrigin, dual: false, secure: false },
    { config: { publicOrigin: httpsOrigin }, origin: httpsOrigin, dual: false, secure: true },
    { config: { publicOrigins: [httpOrigin, httpsOrigin] }, origin: httpOrigin, dual: true, secure: false },
    { config: { publicOrigins: [httpsOrigin, httpOrigin] }, origin: httpsOrigin, dual: true, secure: false },
    { config: { publicOrigins: [httpsOrigin, 'https://backup.example.test:8443'] }, origin: httpsOrigin, dual: false, secure: true },
    { config: { publicOrigins: [httpOrigin, 'http://backup.example.test:8080'] }, origin: httpOrigin, dual: false, secure: false },
  ];
  for (const { config, origin, dual, secure } of cases) {
    const app = createLocalizedApp('en', new OperationManager(), config);
    const health = await request(app).get('/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.location, undefined);
    assert.equal(health.headers['strict-transport-security'], dual ? 'max-age=0' : 'max-age=31536000; includeSubDomains');
    assert.equal(health.headers['x-content-type-options'], 'nosniff');
    assert.equal(app.get('trust proxy'), false);
    const page = await request(app).get('/').set('Cookie', 'ui_language=de; ui_language_dual=pl');
    assert.match(page.text, new RegExp(`<html lang="${dual ? 'pl' : 'de'}">`));
    const response = await request(app).post('/language').set('Origin', origin)
      .set('X-Forwarded-Proto', 'https').type('form').send({ _csrf: app.locals.csrfToken, language: 'es' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/');
    const cookies = response.headers['set-cookie'];
    assert.equal(cookies.length, 1);
    assert.match(cookies[0], new RegExp(`^${dual ? 'ui_language_dual' : 'ui_language'}=es;`));
    assert.match(cookies[0], /Path=\/; Max-Age=31536000; SameSite=Lax/);
    assert.equal(/; Secure(?:;|$)/.test(cookies[0]), secure);
    if (!dual) {
      const rejected = await request(app).post('/language')
        .set('Origin', new URL(origin).protocol === 'https:' ? httpOrigin : httpsOrigin)
        .type('form').send({ _csrf: app.locals.csrfToken, language: 'pl' });
      assert.equal(rejected.status, 422);
    }
  }
});

test('mixed origins still require CSRF and reject unlisted hosts and ports', async () => {
  const httpOrigin = 'http://backup.example.test';
  const httpsOrigin = 'https://backup.example.test';
  const app = createLocalizedApp('en', new OperationManager(), { publicOrigins: [httpOrigin, httpsOrigin] });
  const token = app.locals.csrfToken;
  const cases = [
    [httpOrigin, token, 303], [httpsOrigin, token, 303],
    ['http://backup.example.test:8080', token, 422], ['https://backup.example.test:8443', token, 422],
    ['http://evil.example.test', token, 422], ['https://evil.example.test', token, 422],
    ['https://backup.example.test.evil.example', token, 422], ['https://backup.example.test/', token, 422],
    ['http://localhost:8080', token, 422],
    [httpOrigin, undefined, 422], [httpsOrigin, undefined, 422],
    [httpOrigin, 'invalid', 422], [httpsOrigin, 'invalid', 422],
    [undefined, token, 303], ['null', token, 303],
    [undefined, 'invalid', 422], ['null', 'invalid', 422],
  ];
  for (const [origin, csrf, status] of cases) {
    const mutation = request(app).post('/language').set('Host', 'backup.example.test')
      .set('X-Forwarded-Proto', 'https').type('form');
    if (origin !== undefined) mutation.set('Origin', origin);
    const response = await mutation.send({ _csrf: csrf, language: 'pl' });
    assert.equal(response.status, status, `${origin}: ${csrf === token ? 'valid CSRF' : 'invalid CSRF'}`);
    if (status === 422) assert.equal(response.headers['set-cookie'], undefined);
  }
});

test('shares language across configured protocols without overwriting the legacy cookie', async () => {
  const httpOrigin = 'http://backup.example.test';
  const httpsOrigin = 'https://backup.example.test';
  const app = createLocalizedApp('en', new OperationManager(), { publicOrigins: [httpsOrigin, httpOrigin] });
  const legacyCookie = 'ui_language=de';
  const legacyPage = await request(app).get('/').set('Cookie', legacyCookie);
  assert.match(legacyPage.text, /<html lang="de">/);
  let dualCookie;
  for (const [origin, language] of [[httpOrigin, 'pl'], [httpsOrigin, 'es'], [httpOrigin, 'de']]) {
    const response = await request(app).post('/language').set('Origin', origin)
      .set('Cookie', [legacyCookie, dualCookie].filter(Boolean).join('; '))
      .type('form').send({ _csrf: app.locals.csrfToken, language });
    assert.equal(response.status, 303);
    assert.equal(response.headers['set-cookie'].length, 1);
    assert.match(response.headers['set-cookie'][0], new RegExp(`^ui_language_dual=${language};`));
    assert.doesNotMatch(response.headers['set-cookie'][0], /; Secure(?:;|$)/);
    dualCookie = response.headers['set-cookie'][0].split(';')[0];
    const page = await request(app).get('/').set('Cookie', `${legacyCookie}; ${dualCookie}`);
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`<html lang="${language}">`));
  }
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
