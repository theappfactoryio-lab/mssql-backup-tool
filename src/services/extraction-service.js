import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import yauzl from 'yauzl';
import { AppError } from '../errors/app-error.js';
import { message } from '../i18n/index.js';

function limiter(maxBytes, { totalBytes = null, onProgress } = {}) {
  let total = 0;
  let lastReported = -1;
  return new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new AppError('Extraction limit exceeded.', {
          code: 'EXTRACT_LIMIT', statusCode: 422,
          publicMessage: message('errors.backupExtractedSizeExceeded'),
        }));
        return;
      }
      if (Number.isSafeInteger(totalBytes) && totalBytes >= 0) {
        const progress = totalBytes === 0 ? 100 : Math.min(100, Math.floor(total * 100 / totalBytes));
        if (progress === 100 || progress >= lastReported + 5) {
          lastReported = progress;
          onProgress?.({ progress, processedBytes: total, totalBytes });
        }
      }
      callback(null, chunk);
    },
  });
}

async function removeQuietly(filePath) {
  await unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

export async function extractGzip(sourcePath, targetPath, maxBytes, { onProgress } = {}) {
  try {
    const sourceInfo = await stat(sourcePath);
    onProgress?.({ progress: 0, processedBytes: 0, totalBytes: sourceInfo.size });
    await pipeline(
      createReadStream(sourcePath), limiter(sourceInfo.size, { totalBytes: sourceInfo.size, onProgress }),
      createGunzip(), limiter(maxBytes), createWriteStream(targetPath, { flags: 'wx' }),
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

export async function extractZip(sourcePath, targetPath, { maxBytes, maxCompressionRatio, onProgress }) {
  const zip = await openZip(sourcePath);
  try {
    const entry = await new Promise((resolve, reject) => {
      const entries = [];
      zip.on('entry', (item) => {
        entries.push(item);
        if (entries.length > 1) return reject(new AppError('Archive has multiple entries.', {
          code: 'INVALID_ZIP', statusCode: 422,
          publicMessage: message('errors.zipSingleBakRequired'),
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
      throw new AppError('Invalid ZIP.', { code: 'INVALID_ZIP', statusCode: 422,
        publicMessage: message('errors.zipUnsupportedOrUnsafe') });
    }
    const source = await openEntry(zip, entry);
    onProgress?.({ progress: 0, processedBytes: 0, totalBytes: entry.uncompressedSize });
    await pipeline(
      source, limiter(maxBytes, { totalBytes: entry.uncompressedSize, onProgress }),
      createWriteStream(targetPath, { flags: 'wx' }),
    );
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