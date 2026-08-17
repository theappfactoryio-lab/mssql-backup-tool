import { unlink } from 'node:fs/promises';
import { extractGzip, extractZip } from './extraction-service.js';
import { buildRestoreMapping } from './restore-mapping.js';
import { ValidationError } from '../errors/app-error.js';
import { mapSqlError } from '../db/database-repository.js';
import { message } from '../i18n/index.js';

export class RestoreService {
  constructor({ database, files, config, sevenZip }) { Object.assign(this, { database, files, config, sevenZip }); }

  async prepare(filename, operation) {
    operation.log(message('operation.event.fileChecking', { filename }));
    const source = await this.files.inspect(filename);
    if (filename.toLowerCase().endsWith('.bak')) return { sqlPath: this.files.toSqlPath(filename), cleanup: null };
    operation.updatePhase('extracting', message('operation.summary.fileExtracting', { filename }));
    const work = this.files.createWorkPath('.bak');
    const lower = filename.toLowerCase();
    const displayFormat = lower.endsWith('.zip') ? 'ZIP' : lower.endsWith('.gz') ? 'GZIP' : '7-Zip';
    const onProgress = ({ progress }) => operation.reportProgress(
      progress,
      message('operation.progress.archiveExtracting', { format: displayFormat, progress }),
    );
    if (lower.endsWith('.zip')) {
      await extractZip(source.filePath, work.appPath, {
        maxBytes: this.config.maxExtractedBytes,
        maxCompressionRatio: this.config.maxCompressionRatio,
        onProgress,
      });
    } else if (lower.endsWith('.gz')) {
      await extractGzip(source.filePath, work.appPath, this.config.maxExtractedBytes, { onProgress });
    } else if (lower.endsWith('.7z')) {
      await this.sevenZip.extractArchive(source.filePath, work.appPath, {
        maxBytes: this.config.maxExtractedBytes,
        maxCompressionRatio: this.config.maxCompressionRatio,
      });
    } else throw new ValidationError(message('validation.extractSourceMustBeArchive'));
    operation.log(message('operation.event.fileExtractionCompleted'));
    return { sqlPath: work.sqlPath, cleanup: work.appPath };
  }

  async inspect(filename, operation) {
    const prepared = await this.prepare(filename, operation);
    try {
      operation.updatePhase('verifying', message('operation.summary.fileVerifying', { filename }));
      operation.log(message('operation.event.backupHeaderReading'));
      const header = await this.database.readHeader(prepared.sqlPath);
      const position = Number(header.Position);
      if (!Number.isSafeInteger(position) || position < 1) throw new ValidationError(message('validation.backupSetPositionInvalid'));
      operation.log(message('operation.event.backupChecksumsVerifying'));
      await this.database.verify(prepared.sqlPath, position);
      operation.log(message('operation.event.backupFileListReading'));
      const fileList = await this.database.readFileList(prepared.sqlPath, position);
      return { ...prepared, header, position, fileList };
    } catch (error) {
      if (prepared.cleanup) await unlink(prepared.cleanup).catch(() => {});
      throw mapSqlError(error);
    }
  }

  async verify(filename, operation) {
    const inspected = await this.inspect(filename, operation);
    if (inspected.cleanup) await unlink(inspected.cleanup).catch(() => {});
    return { databaseName: inspected.header.DatabaseName };
  }

  async restore(input, operation) {
    if (!['new', 'existing'].includes(input.targetMode)) throw new ValidationError(message('validation.restoreTargetModeInvalid'));
    if (input.targetMode === 'existing' && !input.allowOverwrite) throw new ValidationError(message('validation.restoreOverwriteConsentRequired'));
    const inspected = await this.inspect(input.filename, operation);
    try {
      const mapping = buildRestoreMapping(inspected.fileList, input.targetDatabase, {
        dataPath: this.config.sqlDataPath, logPath: this.config.sqlLogPath,
      });
      operation.log(message('operation.event.restoreMappingPrepared', { count: mapping.length }));
      await this.database.assertTargetsAvailable(mapping, input.targetDatabase);
      operation.updatePhase('restoring', message('operation.summary.databaseRestoring', { databaseName: input.targetDatabase }));
      await this.database.restore({ targetDatabase: input.targetDatabase, sqlPath: inspected.sqlPath,
        position: inspected.position, mapping, replace: input.targetMode === 'existing',
        disconnectUsers: input.disconnectUsers, operation });
      operation.log(message('operation.event.databaseRestored', { databaseName: input.targetDatabase }));
      return { databaseName: input.targetDatabase };
    } catch (error) {
      throw mapSqlError(error);
    } finally {
      if (inspected.cleanup) {
        await unlink(inspected.cleanup).catch(() => {});
        operation.log(message('operation.event.extractedWorkFileRemoved'));
      }
    }
  }
}