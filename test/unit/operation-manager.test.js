import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationBusyError, OperationManager } from '../../src/operations/operation-manager.js';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('blokuje drugą operację przed pierwszym await', async () => {
  const manager = new OperationManager();
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });

  const operation = manager.tryStart({
    type: 'backup',
    summary: 'Backup',
    work: () => pending,
  });

  assert.equal(operation.status, 'running');
  assert.equal(manager.isBusy(), true);
  assert.throws(
    () => manager.tryStart({ type: 'restore', summary: 'Restore', work: async () => {} }),
    OperationBusyError,
  );

  finish({ filename: 'database.bak' });
  await nextTurn();
  assert.equal(manager.getStatus().status, 'succeeded');
  assert.equal(manager.getStatus().result.filename, 'database.bak');
  assert.equal(manager.isBusy(), false);
});

test('zapisuje bezpieczny błąd i zawsze zwalnia blokadę', async () => {
  const logged = [];
  const manager = new OperationManager({ logger: { error: (message) => logged.push(message) } });
  const error = new Error('sekret techniczny');
  error.code = 'BACKUP_FAILED';
  error.userMessage = 'Nie udało się wykonać backupu.';

  manager.tryStart({
    type: 'backup',
    summary: 'Backup',
    work: async ({ updatePhase }) => {
      updatePhase('backing-up');
      throw error;
    },
  });

  await nextTurn();
  assert.equal(manager.getStatus().status, 'failed');
  assert.equal(manager.getStatus().phase, 'backing-up');
  assert.deepEqual(manager.getStatus().error, {
    code: 'BACKUP_FAILED',
    message: { raw: 'Nie udało się wykonać backupu.' },
  });
  assert.equal(manager.getStatus().error.message.raw.includes('sekret'), false);
  assert.match(logged[0], /BACKUP_FAILED.*sekret techniczny/s);
  assert.equal(manager.getStatus().events.at(-1).level, 'error');
  assert.deepEqual(manager.getStatus().events.at(-1).message, { raw: 'Nie udało się wykonać backupu.' });
  assert.equal(manager.isBusy(), false);
});

test('prowadzi chronologiczny log, raportuje postęp i usuwa go po potwierdzeniu', async () => {
  const manager = new OperationManager();
  const operation = manager.tryStart({
    type: 'backup',
    summary: 'Przygotowanie',
    work: async ({ updatePhase, reportProgress, log }) => {
      updatePhase('backing-up', 'Tworzenie backupu');
      reportProgress(10, 'Zapisywanie backupu: 10%', { source: 'sql-server' });
      log('Plik opublikowany.');
      return { filename: 'database.bak' };
    },
  });

  assert.equal(manager.getStatus('obca-operacja'), null);
  assert.equal(manager.acknowledge(operation.id), false);
  await nextTurn();

  const completed = manager.getStatus(operation.id);
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.events.map((event) => event.sequence), [1, 2, 3, 4, 5]);
  assert.equal(completed.events[2].source, 'sql-server');
  assert.equal(completed.events[2].progress, 10);
  assert.equal(completed.progress, 100);
  assert.equal(manager.acknowledge(operation.id), true);
  assert.equal(manager.getStatus(), null);
  assert.equal(manager.acknowledge(operation.id), false);
});