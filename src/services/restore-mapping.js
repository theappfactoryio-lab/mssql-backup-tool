import path from 'node:path';
import { createHash } from 'node:crypto';
import { ValidationError } from '../errors/app-error.js';

function safeStem(databaseName) {
  if (typeof databaseName !== 'string' || !databaseName.trim()) {
    throw new ValidationError('Nieprawidłowa nazwa bazy docelowej.');
  }
  const name = databaseName.trim();
  const basic = name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'database';
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${basic}_${hash}`;
}

export function buildRestoreMapping(fileList, databaseName, { dataPath, logPath }) {
  if (!Array.isArray(fileList) || fileList.length === 0) throw new ValidationError('Backup nie zawiera listy plików.');
  const stem = safeStem(databaseName);
  let dataIndex = 0;
  let logIndex = 0;
  return [...fileList].sort((a, b) => a.FileID - b.FileID).map((file) => {
    if (file.Type === 'D') {
      dataIndex += 1;
      const extension = dataIndex === 1 ? '.mdf' : `.data${dataIndex}.ndf`;
      return { logicalName: file.LogicalName, targetPath: path.posix.join(dataPath, `${stem}${extension}`) };
    }
    if (file.Type === 'L') {
      logIndex += 1;
      return { logicalName: file.LogicalName, targetPath: path.posix.join(logPath, `${stem}.log${logIndex}.ldf`) };
    }
    throw new ValidationError(`Nieobsługiwany typ pliku backupu: ${file.Type}.`);
  });
}