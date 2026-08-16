import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import yauzl from 'yauzl';
import { AppError } from '../errors/app-error.js';

function limiter(maxBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new AppError('Przekroczono limit rozpakowania.', {
          code: 'EXTRACT_LIMIT', statusCode: 422,
          userMessage: 'Rozpakowany backup przekracza dozwolony rozmiar.',
        }));
      } else callback(null, chunk);
    },
  });
}

async function removeQuietly(filePath) {
  await unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

export async function extractGzip(sourcePath, targetPath, maxBytes) {
  try {
    await pipeline(
      createReadStream(sourcePath), createGunzip(), limiter(maxBytes),
      createWriteStream(targetPath, { flags: 'wx' }),
    );
    return targetPath;
  } catch (error) {
    await removeQuietly(targetPath);
    throw error;
  }
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true, autoClose: false }, (error, zip) => {
      if (error) reject(error); else resolve(zip);
    });
  });
}

function openEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
  });
}

export async function extractZip(sourcePath, targetPath, { maxBytes, maxCompressionRatio }) {
  const zip = await openZip(sourcePath);
  try {
    const entry = await new Promise((resolve, reject) => {
      const entries = [];
      zip.on('entry', (item) => {
        entries.push(item);
        if (entries.length > 1) return reject(new AppError('Archiwum ma wiele wpisów.', {
          code: 'INVALID_ZIP', statusCode: 422,
          userMessage: 'Archiwum ZIP musi zawierać dokładnie jeden plik .bak.',
        }));
        zip.readEntry();
      });
      zip.once('end', () => resolve(entries[0]));
      zip.once('error', reject);
      zip.readEntry();
    });
    const invalidName = !entry || /[/\\]/.test(entry.fileName) || !entry.fileName.toLowerCase().endsWith('.bak');
    const encrypted = Boolean(entry.generalPurposeBitFlag & 0x1);
    const ratio = entry?.compressedSize === 0 ? Infinity : entry.uncompressedSize / entry.compressedSize;
    if (invalidName || encrypted || entry.uncompressedSize > maxBytes || ratio > maxCompressionRatio) {
      throw new AppError('Nieprawidłowy ZIP.', { code: 'INVALID_ZIP', statusCode: 422,
        userMessage: 'Archiwum ZIP jest nieobsługiwane lub przekracza limity bezpieczeństwa.' });
    }
    const source = await openEntry(zip, entry);
    await pipeline(source, limiter(maxBytes), createWriteStream(targetPath, { flags: 'wx' }));
    return targetPath;
  } catch (error) {
    await removeQuietly(targetPath);
    throw error;
  } finally {
    zip.close();
  }
}

export async function assertFreeSpace(directory, requiredBytes) {
  const info = await stat(directory);
  return info.isDirectory() && requiredBytes > 0;
}