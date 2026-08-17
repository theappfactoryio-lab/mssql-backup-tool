import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { parseSevenZipListing, SevenZipService } from '../../src/services/seven-zip-service.js';

function childProcess({ stdout = '', stderr = '', code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit('close', code);
  });
  return child;
}

const listing = (name = 'backup.bak', size = 7, packed = 6) => `7-Zip listing\n----------\nPath = ${name}\nSize = ${size}\nPacked Size = ${packed}\nFolder = -\nEncrypted = -\n`;

test('parses technical 7z listing entries', () => {
  assert.deepEqual(parseSevenZipListing(listing())[0], {
    Path: 'backup.bak', Size: '7', 'Packed Size': '6', Folder: '-', Encrypted: '-',
  });
});

test('reports streaming progress while creating an archive', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'seven-zip-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'backup.bak');
  const target = path.join(root, 'backup.7z');
  await writeFile(source, Buffer.alloc(1024 * 1024));
  const progress = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.resume();
    child.stdin.on('finish', async () => {
      await writeFile(target, 'archive');
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  };
  const service = new SevenZipService({ spawn, timeoutMs: 1000 });

  await service.createArchive(source, target, 'backup.bak', {
    onProgress: ({ progress: value }) => progress.push(value),
  });
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.length > 2);
});

test('extracts the validated single bak stream and checks its size', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'seven-zip-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'backup.7z');
  const target = path.join(root, 'backup.bak');
  await writeFile(source, 'archive');
  let invocation = 0;
  const spawn = () => childProcess({ stdout: invocation++ === 0 ? listing() : 'payload' });
  const service = new SevenZipService({ spawn, timeoutMs: 1000 });

  await service.extractArchive(source, target, { maxBytes: 100, maxCompressionRatio: 10 });
  assert.equal(await readFile(target, 'utf8'), 'payload');
});

test('rejects unsafe paths before extraction', async () => {
  const spawn = () => childProcess({ stdout: listing('../backup.bak') });
  const service = new SevenZipService({ spawn, timeoutMs: 1000 });
  await assert.rejects(
    service.extractArchive('unsafe.7z', 'unsafe.bak', { maxBytes: 100, maxCompressionRatio: 10 }),
    { code: 'INVALID_7Z' },
  );
});

test('maps a missing 7zz executable to a controlled error', async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })));
    return child;
  };
  const service = new SevenZipService({ spawn, timeoutMs: 1000 });
  await assert.rejects(service.listArchive('backup.7z'), { code: 'SEVEN_ZIP_UNAVAILABLE' });
});
