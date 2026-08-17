import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors/app-error.js';
import { message } from '../i18n/index.js';

export const SEVEN_ZIP_TIMEOUT_MS = 6 * 60 * 60 * 1000;
export const SEVEN_ZIP_THREADS = 2;
export const SEVEN_ZIP_LEVEL = 5;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const MAX_LISTING_BYTES = 1024 * 1024;

async function removeQuietly(filePath) {
  await unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

function processError(code, cause) {
  const missing = cause?.code === 'ENOENT';
  return new AppError(missing ? '7zz executable is unavailable.' : `7zz failed with exit code ${code}.`, {
    code: missing ? 'SEVEN_ZIP_UNAVAILABLE' : 'SEVEN_ZIP_FAILED',
    statusCode: missing ? 500 : 422,
    publicMessage: message(missing ? 'errors.sevenZipUnavailable' : 'errors.archiveInvalid'),
    cause,
  });
}

function appendLimited(current, chunk) {
  if (current.length >= MAX_DIAGNOSTIC_BYTES) return current;
  return (current + chunk.toString('utf8')).slice(0, MAX_DIAGNOSTIC_BYTES);
}

function waitForProcess(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = appendLimited(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AppError('7zz timed out.', {
        code: 'SEVEN_ZIP_TIMEOUT', statusCode: 504,
        publicMessage: message('errors.sevenZipTimeout'),
      }));
    }, timeoutMs);
    timer.unref?.();
    child.once('error', (error) => { clearTimeout(timer); reject(processError(null, error)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stderr });
      else reject(processError(code, new Error(stderr || `Exit code ${code}`)));
    });
  });
}

async function runCapture(spawn, args, { cwd, timeoutMs }) {
  const child = spawn('7zz', args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let bytes = 0;
  let overflow = false;
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_LISTING_BYTES) {
      overflow = true;
      child.kill('SIGKILL');
    } else stdout += chunk.toString('utf8');
  });
  await waitForProcess(child, timeoutMs);
  if (overflow) {
    throw new AppError('7zz listing exceeded its limit.', {
      code: 'INVALID_7Z', statusCode: 422,
      publicMessage: message('errors.sevenZipUnsupportedOrUnsafe'),
    });
  }
  return stdout;
}

export function parseSevenZipListing(output) {
  const marker = output.indexOf('----------');
  if (marker < 0) return [];
  const blocks = output.slice(marker).split(/\r?\n\s*\r?\n/);
  const entries = [];
  for (const block of blocks) {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(' = ');
      if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 3).trim();
    }
    if (fields.Path) entries.push(fields);
  }
  return entries;
}

function validateEntry(entries, { maxBytes, maxCompressionRatio }) {
  if (entries.length !== 1) {
    throw new AppError('7z archive must contain one entry.', {
      code: 'INVALID_7Z', statusCode: 422,
      publicMessage: message('errors.sevenZipSingleBakRequired'),
    });
  }
  const entry = entries[0];
  const name = entry.Path;
  const size = Number(entry.Size);
  const packedSize = Number(entry['Packed Size']);
  const encrypted = entry.Encrypted === '+';
  const isFolder = entry.Folder === '+' || entry.Attributes?.startsWith('D');
  const isLink = Boolean(entry['Symbolic Link'] || entry['Hard Link']);
  const unsafeName = /[/\\]/.test(name) || name.includes('..') || !name.toLowerCase().endsWith('.bak');
  const invalidSize = !Number.isSafeInteger(size) || size < 0 || size > maxBytes;
  const ratio = packedSize === 0 ? (size === 0 ? 1 : Infinity) : size / packedSize;
  if (encrypted || isFolder || isLink || unsafeName || invalidSize || !Number.isFinite(ratio) || ratio > maxCompressionRatio) {
    throw new AppError('Unsafe or unsupported 7z archive.', {
      code: 'INVALID_7Z', statusCode: 422,
      publicMessage: message('errors.sevenZipUnsupportedOrUnsafe'),
    });
  }
  return { name, size };
}

function byteLimiter(maxBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) callback(new AppError('Extraction limit exceeded.', {
        code: 'EXTRACT_LIMIT', statusCode: 422,
        publicMessage: message('errors.backupExtractedSizeExceeded'),
      }));
      else callback(null, chunk);
    },
  });
}

function progressReporter(totalBytes, onProgress) {
  let processedBytes = 0;
  let lastReported = -1;
  return new Transform({
    transform(chunk, encoding, callback) {
      processedBytes += chunk.length;
      const progress = totalBytes === 0 ? 100 : Math.min(100, Math.floor(processedBytes * 100 / totalBytes));
      if (progress === 100 || progress >= lastReported + 5) {
        lastReported = progress;
        onProgress?.({ progress, processedBytes, totalBytes });
      }
      callback(null, chunk);
    },
  });
}

export class SevenZipService {
  constructor({ spawn = nodeSpawn, timeoutMs = SEVEN_ZIP_TIMEOUT_MS } = {}) {
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
  }

  async createArchive(sourcePath, targetPath, entryName = path.basename(sourcePath), { onProgress } = {}) {
    if (entryName !== path.basename(entryName) || !entryName.toLowerCase().endsWith('.bak')) {
      throw new AppError('Invalid 7z entry name.', { code: 'INVALID_7Z_ENTRY', statusCode: 422,
        publicMessage: message('errors.sevenZipSingleBakRequired') });
    }
    try {
      const sourceInfo = await stat(sourcePath);
      const child = this.spawn('7zz', [
        'a', '-t7z', `-mx=${SEVEN_ZIP_LEVEL}`, `-mmt=${SEVEN_ZIP_THREADS}`, '-bd', '-y',
        targetPath, '-si' + entryName,
      ], { cwd: path.dirname(sourcePath), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      onProgress?.({ progress: 0, processedBytes: 0, totalBytes: sourceInfo.size });
      const input = pipeline(createReadStream(sourcePath), progressReporter(sourceInfo.size, onProgress), child.stdin);
      await Promise.all([input, waitForProcess(child, this.timeoutMs)]);
      const info = await stat(targetPath);
      if (!info.isFile() || info.size === 0) throw new Error('7zz did not create an archive.');
      return targetPath;
    } catch (error) {
      await removeQuietly(targetPath);
      if (error instanceof AppError) throw error;
      throw processError(null, error);
    }
  }

  async listArchive(sourcePath) {
    const output = await runCapture(this.spawn, ['l', '-slt', '-bd', '-y', sourcePath], {
      cwd: path.dirname(sourcePath), timeoutMs: this.timeoutMs,
    });
    const volumes = output.match(/^Volumes = (\d+)$/m);
    if (volumes && Number(volumes[1]) !== 1) {
      throw new AppError('Multipart 7z archives are unsupported.', {
        code: 'INVALID_7Z', statusCode: 422,
        publicMessage: message('errors.sevenZipUnsupportedOrUnsafe'),
      });
    }
    return parseSevenZipListing(output);
  }

  async extractArchive(sourcePath, targetPath, { maxBytes, maxCompressionRatio }) {
    const entries = await this.listArchive(sourcePath);
    const entry = validateEntry(entries, { maxBytes, maxCompressionRatio });
    const child = this.spawn('7zz', ['x', '-so', '-bd', '-y', sourcePath, entry.name], {
      cwd: path.dirname(sourcePath), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await Promise.all([
        waitForProcess(child, this.timeoutMs),
        pipeline(child.stdout, byteLimiter(maxBytes), createWriteStream(targetPath, { flags: 'wx' })),
      ]);
      const info = await lstat(targetPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size) {
        throw new AppError('Extracted 7z size mismatch.', { code: 'INVALID_7Z', statusCode: 422,
          publicMessage: message('errors.archiveInvalid') });
      }
      return targetPath;
    } catch (error) {
      child.kill('SIGKILL');
      await removeQuietly(targetPath);
      throw error;
    }
  }
}
