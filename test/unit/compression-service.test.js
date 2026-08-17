import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGzipArchive, createZipArchive } from '../../src/services/compression-service.js';
import { extractGzip, extractZip } from '../../src/services/extraction-service.js';

test('tworzy i rozpakowuje GZIP strumieniowo z raportowaniem postępu', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mssql-compression-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.bak');
  const archive = path.join(root, 'source.bak.gz');
  const restored = path.join(root, 'restored.bak');
  const compressionProgress = [];
  const extractionProgress = [];
  await writeFile(source, Buffer.alloc(1024 * 1024, 7));
  await createGzipArchive(source, archive, {
    onProgress: ({ progress }) => compressionProgress.push(progress),
  });
  await extractGzip(archive, restored, 2 * 1024 * 1024, {
    onProgress: ({ progress }) => extractionProgress.push(progress),
  });
  assert.deepEqual(await readFile(restored), Buffer.alloc(1024 * 1024, 7));
  assert.equal(compressionProgress[0], 0);
  assert.equal(compressionProgress.at(-1), 100);
  assert.equal(extractionProgress[0], 0);
  assert.equal(extractionProgress.at(-1), 100);
});

test('tworzy i bezpiecznie rozpakowuje pojedynczy ZIP', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mssql-zip-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.bak');
  const archive = path.join(root, 'source.bak.zip');
  const restored = path.join(root, 'restored.bak');
  const compressionProgress = [];
  const extractionProgress = [];
  const content = randomBytes(1024 * 1024);
  await writeFile(source, content);
  await createZipArchive(source, archive, 'source.bak', {
    onProgress: ({ progress }) => compressionProgress.push(progress),
  });
  await extractZip(archive, restored, {
    maxBytes: 2 * 1024 * 1024,
    maxCompressionRatio: 300,
    onProgress: ({ progress }) => extractionProgress.push(progress),
  });
  assert.deepEqual(await readFile(restored), content);
  assert.equal(compressionProgress[0], 0);
  assert.equal(compressionProgress.at(-1), 100);
  assert.equal(extractionProgress[0], 0);
  assert.equal(extractionProgress.at(-1), 100);
});