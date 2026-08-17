import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileService } from '../../src/services/file-service.js';

test('rename preserves suffix and does not overwrite existing file', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mssql-rename-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new FileService({ backupPath: root, sqlBackupPath: '/sql/backup' });
  await service.initialize();

  await writeFile(path.join(root, 'oldname.bak'), 'data');
  const result = await service.rename('oldname.bak', 'newname');
  assert.equal(result.filename, 'newname.bak');
  assert.equal(await readFile(path.join(root, 'newname.bak'), 'utf8'), 'data');

  await assert.rejects(() => service.rename('doesnotexist.bak', 'x'), { code: 'FILE_NOT_FOUND' });

  // collision
  await writeFile(path.join(root, 'collision.bak'), 'a');
  await writeFile(path.join(root, 'source.bak'), 'b');
  await assert.rejects(() => service.rename('source.bak', 'collision'), { code: 'FILE_EXISTS' });
});