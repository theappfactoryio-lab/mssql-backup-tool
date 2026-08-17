import { unlink } from 'node:fs/promises';
import { createGzipArchive, createZipArchive } from './compression-service.js';
import { ValidationError } from '../errors/app-error.js';
import { message } from '../i18n/index.js';

function outputName(databaseName, date, compression) {
  const timestamp = date.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
  const safeDatabase = databaseName.replace(/[^\p{L}\p{N}_ -]/gu, '_').slice(0, 100);
  const suffix = compression === 'zip' ? '.bak.zip' : compression === 'gzip' ? '.bak.gz' : compression === '7z' ? '.bak.7z' : '.bak';
  return `${safeDatabase}_${timestamp}${suffix}`;
}

export class BackupService {
  constructor({ database, files, sevenZip }) { Object.assign(this, { database, files, sevenZip }); }

  async run({ databaseName, compression }, operation) {
    if (!['none', 'native', 'zip', 'gzip', '7z'].includes(compression)) throw new ValidationError(message('validation.backupCompressionModeInvalid')); 
    operation.log(message('operation.event.backupCheckingSettings'));
    const canonical = await this.database.canonicalDatabaseName(databaseName);
    const work = this.files.createWorkPath('.bak');
    let compressed;
    try {
      operation.updatePhase('backing-up', message('operation.summary.backupCreating', { databaseName: canonical }));
      await this.database.backup(canonical, work.sqlPath, compression === 'native', operation);
      operation.log(message('operation.event.backupSqlWriteCompleted'));
      const filename = outputName(canonical, new Date(), compression);
      if (['zip', 'gzip', '7z'].includes(compression)) {
        operation.updatePhase('compressing', message('operation.summary.backupCompressing', { databaseName: canonical }));
        const extension = compression === 'gzip' ? '.gz' : `.${compression}`;
        compressed = this.files.createWorkPath(extension);
        const reportCompression = (format) => ({ progress }) => operation.reportProgress(
          progress,
          message('operation.progress.archiveCompressing', { format, progress }),
        );
        if (compression === 'zip') await createZipArchive(
          work.appPath, compressed.appPath, filename.replace(/\.zip$/, ''),
          { onProgress: reportCompression('ZIP') },
        );
        else if (compression === 'gzip') await createGzipArchive(
          work.appPath, compressed.appPath, { onProgress: reportCompression('GZIP') },
        );
        else await this.sevenZip.createArchive(work.appPath, compressed.appPath, filename.replace(/\.7z$/, ''), {
          onProgress: reportCompression('7-Zip'),
        });
        operation.log(message('operation.event.backupCompressionCompleted'));
        await this.files.publish(compressed.appPath, filename);
        await unlink(work.appPath);
      } else await this.files.publish(work.appPath, filename);
      operation.log(message('operation.event.filePublished', { filename }));
      return { filename };
    } catch (error) {
      await Promise.all([work.appPath, compressed?.appPath].filter(Boolean).map((file) => unlink(file).catch(() => {})));
      operation.log(message('operation.event.incompleteWorkFilesRemoved'), { level: 'warning' });
      throw error;
    }
  }
}