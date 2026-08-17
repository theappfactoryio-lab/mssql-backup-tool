import { unlink } from 'node:fs/promises';
import { createZipArchive, createGzipArchive } from './compression-service.js';
import { extractZip, extractGzip } from './extraction-service.js';
import { AppError, ValidationError } from '../errors/app-error.js';
import { message } from '../i18n/index.js';

async function removeQuietly(filePath) {
  await unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function extractionError(error) {
  if (error instanceof AppError || error instanceof ValidationError) return error;
  return new AppError('Archive extraction failed.', {
    code: 'INVALID_ARCHIVE',
    statusCode: 422,
    publicMessage: message('errors.archiveInvalid'),
    cause: error,
  });
}

export class ArchiveService {
  constructor({ files, config, sevenZip }) {
    this.files = files;
    this.config = config;
    this.sevenZip = sevenZip;
  }

  async compress(filename, format, context) {
    if (!['zip', 'gzip', '7z'].includes(format)) {
      throw new ValidationError(message('validation.backupCompressionFormatInvalid'));
    }
    await this.files.inspect(filename);
    if (!filename.toLowerCase().endsWith('.bak')) {
      throw new ValidationError(message('validation.compressSourceMustBeBak'));
    }

    const extension = format === 'gzip' ? '.gz' : `.${format}`;
    const work = this.files.createWorkPath(extension);
    const resultName = `${filename}${extension}`;
    try {
      context?.updatePhase('compressing', message('operation.summary.fileCompressing', { filename }));
      const displayFormat = format === 'gzip' ? 'GZIP' : format === 'zip' ? 'ZIP' : '7-Zip';
      const onProgress = ({ progress }) => context?.reportProgress(
        progress,
        message('operation.progress.archiveCompressing', { format: displayFormat, progress }),
      );
      if (format === 'zip') await createZipArchive(
        this.files.resolve(filename), work.appPath, filename, { onProgress },
      );
      else if (format === 'gzip') await createGzipArchive(
        this.files.resolve(filename), work.appPath, { onProgress },
      );
      else await this.sevenZip.createArchive(
        this.files.resolve(filename), work.appPath, filename, { onProgress },
      );

      context?.updatePhase('publishing', message('operation.summary.filePublishing', { filename: resultName }));
      await this.files.publish(work.appPath, resultName);
      return { filename: resultName };
    } finally {
      await removeQuietly(work.appPath);
    }
  }

  async extract(filename, context) {
    await this.files.inspect(filename);
    const lower = filename.toLowerCase();
    const isZip = lower.endsWith('.zip');
    const isGzip = lower.endsWith('.gz');
    const isSevenZip = lower.endsWith('.7z');
    if (!isZip && !isGzip && !isSevenZip) {
      throw new ValidationError(message('validation.extractSourceMustBeArchive'));
    }

    const work = this.files.createWorkPath('.bak');
    const resultName = filename.replace(/(?:\.bak)?(?:\.zip|\.gz|\.7z)$/i, '.bak');
    try {
      context?.updatePhase('extracting', message('operation.summary.fileExtracting', { filename }));
      try {
        const displayFormat = isZip ? 'ZIP' : isGzip ? 'GZIP' : '7-Zip';
        const onProgress = ({ progress }) => context?.reportProgress(
          progress,
          message('operation.progress.archiveExtracting', { format: displayFormat, progress }),
        );
        if (isZip) {
          await extractZip(this.files.resolve(filename), work.appPath, {
            maxBytes: this.config.maxExtractedBytes,
            maxCompressionRatio: this.config.maxCompressionRatio,
            onProgress,
          });
        } else if (isGzip) {
          await extractGzip(
            this.files.resolve(filename), work.appPath, this.config.maxExtractedBytes, { onProgress },
          );
        } else {
          await this.sevenZip.extractArchive(this.files.resolve(filename), work.appPath, {
            maxBytes: this.config.maxExtractedBytes,
            maxCompressionRatio: this.config.maxCompressionRatio,
          });
        }
      } catch (error) {
        throw extractionError(error);
      }

      context?.updatePhase('publishing', message('operation.summary.filePublishing', { filename: resultName }));
      await this.files.publish(work.appPath, resultName);
      return { filename: resultName };
    } finally {
      await removeQuietly(work.appPath);
    }
  }
}

