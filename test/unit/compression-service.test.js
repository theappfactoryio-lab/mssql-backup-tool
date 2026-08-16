import assert from 'node:assert/strict';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGzipArchive, createZipArchive } from '../../src/services/compression-service.js';
import { extractZip } from '../../src/services/extraction-service.js';

test('tworzy GZIP strumieniowo', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mssql-compression-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.bak');
  const archive = path.join(root, 'source.bak.gz');
  const restored = path.join(root, 'restored.bak');
  await writeFile(source, 'backup-content');
  await createGzipArchive(source, archive);
  await pipeline(createReadStream(archive), createGunzip(), (await import('node:fs')).createWriteStream(restored));
  assert.equal(await readFile(restored, 'utf8'), 'backup-content');
});

test('tworzy i bezpiecznie rozpakowuje pojedynczy ZIP', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mssql-zip-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.bak');
  const archive = path.join(root, 'source.bak.zip');
  const restored = path.join(root, 'restored.bak');
  await writeFile(source, Buffer.alloc(256, 7));
  await createZipArchive(source, archive, 'source.bak');
  await extractZip(archive, restored, { maxBytes: 1024, maxCompressionRatio: 300 });
  assert.deepEqual(await readFile(restored), Buffer.alloc(256, 7));
});