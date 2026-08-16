import { unlink } from 'node:fs/promises';
import { createGzipArchive, createZipArchive } from './compression-service.js';
import { ValidationError } from '../errors/app-error.js';

function outputName(databaseName, date, compression) {
  const timestamp = date.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
  const safeDatabase = databaseName.replace(/[^\p{L}\p{N}_ -]/gu, '_').slice(0, 100);
  const suffix = compression === 'zip' ? '.bak.zip' : compression === 'gzip' ? '.bak.gz' : '.bak';
  return `${safeDatabase}_${timestamp}${suffix}`;
}

export class BackupService {
  constructor({ database, files }) { this.database = database; this.files = files; }

  async run({ databaseName, compression }, operation) {
    if (!['none', 'native', 'zip', 'gzip'].includes(compression)) throw new ValidationError('Nieprawidłowy tryb kompresji.');
    operation.log('Sprawdzanie bazy danych i ustawień backupu.');
    const canonical = await this.database.canonicalDatabaseName(databaseName);
    const work = this.files.createWorkPath('.bak');
    let compressed;
    try {
      operation.updatePhase('backing-up', `Tworzenie backupu bazy ${canonical}`);
      await this.database.backup(canonical, work.sqlPath, compression === 'native', operation);
      operation.log('SQL Server zakończył zapis backupu.');
      const filename = outputName(canonical, new Date(), compression);
      if (compression === 'zip' || compression === 'gzip') {
        operation.updatePhase('compressing', `Kompresowanie backupu bazy ${canonical}`);
        compressed = this.files.createWorkPath(compression === 'zip' ? '.zip' : '.gz');
        if (compression === 'zip') await createZipArchive(work.appPath, compressed.appPath, filename.replace(/\.zip$/, ''));
        else await createGzipArchive(work.appPath, compressed.appPath);
        operation.log('Kompresja została zakończona.');
        await this.files.publish(compressed.appPath, filename);
        await unlink(work.appPath);
      } else await this.files.publish(work.appPath, filename);
      operation.log(`Opublikowano plik ${filename}.`);
      return { filename };
    } catch (error) {
      await Promise.all([work.appPath, compressed?.appPath].filter(Boolean).map((file) => unlink(file).catch(() => {})));
      operation.log('Usunięto niekompletne pliki robocze.', { level: 'warning' });
      throw error;
    }
  }
}