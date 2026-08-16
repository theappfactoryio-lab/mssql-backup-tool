import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTranslator, localizeOperation, normalizeLanguage, parseCookies,
  resolveRequestLanguage, serializeForHtmlScript,
} from '../../src/i18n/index.js';

test('normalizes supported languages and defaults to English', () => {
  assert.equal(normalizeLanguage(' DE-de '), 'de');
  assert.equal(normalizeLanguage('es_ES'), 'es');
  assert.equal(normalizeLanguage('fr'), null);
  assert.equal(resolveRequestLanguage({ headers: {} }, 'en'), 'en');
  assert.equal(resolveRequestLanguage({ headers: { cookie: 'ui_language=pl' } }, 'de'), 'pl');
  assert.equal(resolveRequestLanguage({ headers: { cookie: 'ui_language=invalid' } }, 'de'), 'de');
  assert.deepEqual(parseCookies('theme=dark; ui_language=es'), { theme: 'dark', ui_language: 'es' });
});

test('translates, interpolates, pluralizes and formats each locale', () => {
  for (const language of ['en', 'de', 'es', 'pl']) {
    const translator = createTranslator(language);
    assert.notEqual(translator.t('backup.title'), 'backup.title');
    assert.match(translator.t('operation.summary.fileVerifying', { filename: 'Demo.bak' }), /Demo\.bak/);
    assert.match(translator.formatBytes(1536), /KB$/);
    assert.ok(translator.formatDateTime(new Date('2026-08-16T12:00:00Z')));
  }
  assert.match(createTranslator('pl').t('files.sharedVolumeCount', { count: 2 }), /2 pliki/);
  assert.match(createTranslator('en').t('files.sharedVolumeCount', { count: 2 }), /2 files/);
});

test('localizes stored operation descriptors without mutating them', () => {
  const stored = {
    summary: { key: 'operation.summary.fileVerifying', params: { filename: 'Demo.bak' } },
    error: null,
    events: [{ message: { key: 'operation.completedSuccessfully', params: {} } }],
  };
  const localized = localizeOperation(stored, createTranslator('de'));
  assert.match(localized.summary, /Demo\.bak/);
  assert.equal(typeof localized.events[0].message, 'string');
  assert.equal(typeof stored.summary, 'object');
});

test('serializes client data without allowing script termination', () => {
  const serialized = serializeForHtmlScript({ value: '</script><script>alert(1)</script>&' });
  assert.doesNotMatch(serialized, /<|>|&/);
  assert.match(serialized, /\\u003c/);
});
