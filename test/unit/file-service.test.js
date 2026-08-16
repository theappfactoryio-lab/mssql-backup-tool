import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileService, validateBackupFilename } from '../../src/services/file-service.js';

test('waliduje dozwolone nazwy i blokuje traversal', () => {
  assert.equal(validateBackupFilename('Baza_2026-08-15_12-30-00.bak.gz'), 'Baza_2026-08-15_12-30-00.bak.gz');
  for (const filename of ['../secret.bak', '..\\secret.bak', '.work.bak', 'backup.exe', 'CON.bak']) {
    assert.throws(() => validateBackupFilename(filename));
  }
});

test('publikuje plik bez możliwości nadpisania', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mssql-backup-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new FileService({ backupPath: root, sqlBackupPath: '/sql/backup' });
  await service.initialize();
  const first = path.join(service.workPath, 'first.part');
  const second = path.join(service.workPath, 'second.part');
  await writeFile(first, 'first');
  await writeFile(second, 'second');

  await service.publish(first, 'database.bak');
  await assert.rejects(() => service.publish(second, 'database.bak'), { code: 'FILE_EXISTS' });
  assert.equal(await readFile(path.join(root, 'database.bak'), 'utf8'), 'first');
  assert.equal(service.toSqlPath('database.bak'), '/sql/backup/database.bak');
});

test('usuwa wyłącznie zwalidowany zwykły plik', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mssql-delete-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new FileService({ backupPath: root, sqlBackupPath: '/sql/backup' });
  await service.initialize();
  await writeFile(path.join(root, 'database.bak'), 'backup');

  assert.deepEqual(await service.delete('database.bak'), { filename: 'database.bak' });
  await assert.rejects(() => service.delete('database.bak'), { code: 'FILE_NOT_FOUND' });
  await assert.rejects(() => service.delete('../secret.bak'));
});