import { unlink } from 'node:fs/promises';
import { extractGzip, extractZip } from './extraction-service.js';
import { buildRestoreMapping } from './restore-mapping.js';
import { ValidationError } from '../errors/app-error.js';
import { mapSqlError } from '../db/database-repository.js';

export class RestoreService {
  constructor({ database, files, config }) { Object.assign(this, { database, files, config }); }

  async prepare(filename, operation) {
    operation.log(`Sprawdzanie pliku ${filename}.`);
    const source = await this.files.inspect(filename);
    if (filename.toLowerCase().endsWith('.bak')) return { sqlPath: this.files.toSqlPath(filename), cleanup: null };
    operation.updatePhase('extracting', `Rozpakowywanie ${filename}`);
    const work = this.files.createWorkPath('.bak');
    if (filename.toLowerCase().endsWith('.zip')) {
      await extractZip(source.filePath, work.appPath, {
        maxBytes: this.config.maxExtractedBytes,
        maxCompressionRatio: this.config.maxCompressionRatio,
      });
    } else await extractGzip(source.filePath, work.appPath, this.config.maxExtractedBytes);
    operation.log('Rozpakowywanie zostało zakończone.');
    return { sqlPath: work.sqlPath, cleanup: work.appPath };
  }

  async inspect(filename, operation) {
    const prepared = await this.prepare(filename, operation);
    try {
      operation.updatePhase('verifying', `Weryfikowanie ${filename}`);
      operation.log('Odczytywanie nagłówka backupu.');
      const header = await this.database.readHeader(prepared.sqlPath);
      const position = Number(header.Position);
      if (!Number.isSafeInteger(position) || position < 1) throw new ValidationError('Backup ma nieprawidłową pozycję zestawu.');
      operation.log('Weryfikowanie sum kontrolnych backupu.');
      await this.database.verify(prepared.sqlPath, position);
      operation.log('Odczytywanie listy plików backupu.');
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
    if (!['new', 'existing'].includes(input.targetMode)) throw new ValidationError('Nieprawidłowy tryb odtwarzania.');
    if (input.targetMode === 'existing' && !input.allowOverwrite) throw new ValidationError('Zaznacz zgodę na nadpisanie bazy.');
    const inspected = await this.inspect(input.filename, operation);
    try {
      const mapping = buildRestoreMapping(inspected.fileList, input.targetDatabase, {
        dataPath: this.config.sqlDataPath, logPath: this.config.sqlLogPath,
      });
      operation.log(`Przygotowano mapowanie ${mapping.length} plików bazy.`);
      await this.database.assertTargetsAvailable(mapping, input.targetDatabase);
      operation.updatePhase('restoring', `Odtwarzanie bazy ${input.targetDatabase}`);
      await this.database.restore({ targetDatabase: input.targetDatabase, sqlPath: inspected.sqlPath,
        position: inspected.position, mapping, replace: input.targetMode === 'existing',
        disconnectUsers: input.disconnectUsers, operation });
      operation.log(`Baza ${input.targetDatabase} została odtworzona.`);
      return { databaseName: input.targetDatabase };
    } catch (error) {
      throw mapSqlError(error);
    } finally {
      if (inspected.cleanup) {
        await unlink(inspected.cleanup).catch(() => {});
        operation.log('Usunięto rozpakowany plik roboczy.');
      }
    }
  }
}