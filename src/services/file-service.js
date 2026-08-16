import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, ValidationError } from '../errors/app-error.js';

const ALLOWED_EXTENSIONS = ['.bak.zip', '.bak.gz', '.bak', '.zip', '.gz'];
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateBackupFilename(filename) {
  if (typeof filename !== 'string' || filename.length < 1 || filename.length > 200) {
    throw new ValidationError('Nieprawidłowa długość nazwy pliku.');
  }
  if (filename !== path.basename(filename) || /[/\\\0\x00-\x1f]/.test(filename) || filename.startsWith('.')) {
    throw new ValidationError('Nieprawidłowa nazwa pliku.');
  }
  if (RESERVED_NAMES.test(filename) || !/^[\p{L}\p{N} _().-]+$/u.test(filename)) {
    throw new ValidationError('Nazwa pliku zawiera niedozwolone znaki.');
  }
  const lower = filename.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new ValidationError('Dozwolone są pliki .bak, .bak.zip, .bak.gz, .zip i .gz.');
  }
  return filename;
}

function ensureInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new ValidationError('Nieprawidłowa ścieżka pliku.');
  }
}

export class FileService {
  constructor({ backupPath, sqlBackupPath }) {
    this.backupPath = path.resolve(backupPath);
    this.sqlBackupPath = sqlBackupPath.replace(/\/$/, '');
    this.incomingPath = path.join(this.backupPath, '.incoming');
    this.workPath = path.join(this.backupPath, '.work');
  }

  async initialize() {
    await Promise.all([
      mkdir(this.backupPath, { recursive: true }),
      mkdir(this.incomingPath, { recursive: true }),
      mkdir(this.workPath, { recursive: true }),
    ]);
  }

  resolve(filename) {
    const safeName = validateBackupFilename(filename);
    const resolved = path.resolve(this.backupPath, safeName);
    ensureInside(this.backupPath, resolved);
    return resolved;
  }

  toSqlPath(filename) {
    validateBackupFilename(filename);
    return path.posix.join(this.sqlBackupPath, filename);
  }

  createWorkPath(extension = '.bak') {
    const basename = `${randomUUID()}${extension}`;
    return {
      basename,
      appPath: path.join(this.workPath, basename),
      sqlPath: path.posix.join(this.sqlBackupPath, '.work', basename),
    };
  }

  async list() {
    const entries = await readdir(this.backupPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        validateBackupFilename(entry.name);
        const info = await lstat(this.resolve(entry.name));
        if (!info.isFile() || info.isSymbolicLink()) continue;
        files.push({
          name: entry.name,
          size: info.size,
          modifiedAt: info.mtime,
          format: ALLOWED_EXTENSIONS.find((extension) => entry.name.toLowerCase().endsWith(extension)),
        });
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
    }
    return files.sort((left, right) => right.modifiedAt - left.modifiedAt);
  }

  async publish(tempPath, filename) {
    const target = this.resolve(filename);
    try {
      await link(tempPath, target);
      await unlink(tempPath);
      return target;
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new AppError('Plik już istnieje.', {
          code: 'FILE_EXISTS',
          statusCode: 409,
          userMessage: 'Plik o tej nazwie już istnieje.',
          cause: error,
        });
      }
      throw error;
    }
  }

  async inspect(filename) {
    const filePath = this.resolve(filename);
    const info = await stat(filePath);
    if (!info.isFile()) throw new ValidationError('Wybrana ścieżka nie jest plikiem.');
    return { filePath, info };
  }

  async delete(filename) {
    const filePath = this.resolve(filename);
    const info = await lstat(filePath).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new AppError('Plik nie istnieje.', {
          code: 'FILE_NOT_FOUND',
          statusCode: 404,
          userMessage: 'Wybrany plik już nie istnieje.',
          cause: error,
        });
      }
      throw error;
    });
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new ValidationError('Wybrana ścieżka nie jest zwykłym plikiem.');
    }
    await unlink(filePath);
    return { filename };
  }

  async openForDownload(filename) {
    const filePath = this.resolve(filename);
    const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      const linkInfo = await lstat(filePath);
      if (!info.isFile() || linkInfo.isSymbolicLink()) throw new ValidationError('Wybrana ścieżka nie jest zwykłym plikiem.');
      return { filePath, handle, info };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}

export { constants as fileConstants };