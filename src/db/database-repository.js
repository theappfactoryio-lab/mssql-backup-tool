import sql from 'mssql';
import { quoteIdentifier, unicodeSqlLiteral } from './sql-escaping.js';
import { AppError, ValidationError } from '../errors/app-error.js';
import { message } from '../i18n/index.js';

// Official mapping: https://learn.microsoft.com/en-us/troubleshoot/sql/releases/download-and-install-latest-updates
const SQL_SERVER_RELEASES = new Map([
  [17, 'SQL Server 2025'],
  [16, 'SQL Server 2022'],
  [15, 'SQL Server 2019'],
  [14, 'SQL Server 2017'],
  [13, 'SQL Server 2016'],
  [12, 'SQL Server 2014'],
  [11, 'SQL Server 2012'],
  [9, 'SQL Server 2005'],
  [8, 'SQL Server 2000'],
  [7, 'SQL Server 7.0'],
]);

export function sqlServerReleaseName(productVersion) {
  const [major, minor] = String(productVersion ?? '').split('.').map(Number);
  if (major === 10) return minor === 50 ? 'SQL Server 2008 R2' : 'SQL Server 2008';
  if (major === 6 && minor === 50) return 'SQL Server 6.5';
  return SQL_SERVER_RELEASES.get(major) ?? null;
}

export class DatabaseRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async request() {
    if (!this.pool.connected) await this.pool.connect();
    return this.pool.request();
  }

  async listDatabases() {
    const result = await (await this.request()).query(`
      SELECT name FROM sys.databases
      WHERE database_id > 4 AND state_desc = N'ONLINE' AND source_database_id IS NULL
      ORDER BY name`);
    return result.recordset.map((row) => row.name);
  }

  async listDatabaseDetails() {
    const core = await (await this.request()).query(`
      SELECT d.database_id AS databaseId, d.name, d.state_desc AS state,
        d.recovery_model_desc AS recoveryModel, d.log_reuse_wait_desc AS logReuseWait,
        d.is_read_only AS isReadOnly,
        COALESCE(SUM(CASE WHEN mf.type = 0 THEN CONVERT(bigint, mf.size) * 8192 ELSE 0 END), 0) AS dataSizeBytes,
        COALESCE(SUM(CASE WHEN mf.type = 1 THEN CONVERT(bigint, mf.size) * 8192 ELSE 0 END), 0) AS logSizeBytes,
        COALESCE(SUM(CASE WHEN mf.type = 1 THEN 1 ELSE 0 END), 0) AS logFileCount
      FROM sys.databases d
      LEFT JOIN sys.master_files mf ON mf.database_id = d.database_id
      WHERE d.database_id > 4 AND d.source_database_id IS NULL
      GROUP BY d.database_id, d.name, d.state_desc, d.recovery_model_desc,
        d.log_reuse_wait_desc, d.is_read_only
      ORDER BY d.name`);

    const optionalQuery = async (query) => {
      try { return { available: true, rows: (await (await this.request()).query(query)).recordset }; }
      catch { return { available: false, rows: [] }; }
    };
    const [connections, backups] = await Promise.all([
      optionalQuery(`SELECT database_id AS databaseId, COUNT_BIG(*) AS activeConnections
        FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND database_id > 4 GROUP BY database_id`),
      optionalQuery(`SELECT database_name AS name, MAX(backup_finish_date) AS lastFullBackupAt
        FROM msdb.dbo.backupset WHERE type = 'D' AND is_snapshot = 0 GROUP BY database_name`),
    ]);
    const connectionsById = new Map(connections.rows.map((row) => [Number(row.databaseId), Number(row.activeConnections)]));
    const backupsByName = new Map(backups.rows.map((row) => [row.name, row.lastFullBackupAt]));

    return core.recordset.map((row) => {
      const dataSizeBytes = Number(row.dataSizeBytes);
      const logSizeBytes = Number(row.logSizeBytes);
      return {
        name: row.name,
        state: row.state,
        dataSizeBytes,
        logSizeBytes,
        totalSizeBytes: dataSizeBytes + logSizeBytes,
        activeConnections: connections.available ? (connectionsById.get(Number(row.databaseId)) ?? 0) : null,
        recoveryModel: row.recoveryModel,
        lastFullBackupAt: backups.available ? (backupsByName.get(row.name) ?? null) : null,
        logReuseWait: row.logReuseWait,
        logFileCount: Number(row.logFileCount),
        isReadOnly: Boolean(row.isReadOnly),
      };
    });
  }

  async getEnvironmentInfo() {
    const result = await (await this.request()).query(`
      SELECT
        CAST(SERVERPROPERTY('ServerName') AS nvarchar(128)) AS serverName,
        CAST(SERVERPROPERTY('MachineName') AS nvarchar(128)) AS machineName,
        CAST(SERVERPROPERTY('InstanceName') AS nvarchar(128)) AS instanceName,
        CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS productVersion,
        CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(128)) AS productLevel,
        CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
        DB_NAME() AS databaseName,
        SUSER_SNAME() AS loginName,
        CAST(CONNECTIONPROPERTY('net_transport') AS nvarchar(40)) AS netTransport,
        CAST(CONNECTIONPROPERTY('auth_scheme') AS nvarchar(40)) AS authenticationScheme`);
    const row = result.recordset[0] ?? {};
    return {
      serverName: row.serverName ?? null,
      machineName: row.machineName ?? null,
      instanceName: row.instanceName ?? null,
      productVersion: row.productVersion ?? null,
      releaseName: sqlServerReleaseName(row.productVersion),
      productLevel: row.productLevel ?? null,
      edition: row.edition ?? null,
      databaseName: row.databaseName ?? null,
      loginName: row.loginName ?? null,
      netTransport: row.netTransport ?? null,
      authenticationScheme: row.authenticationScheme ?? null,
    };
  }

  async canonicalDatabaseName(name, { mustExist = true } = {}) {
    const request = await this.request();
    request.input('name', sql.NVarChar(128), name);
    const result = await request.query('SELECT name FROM sys.databases WHERE name = @name');
    const canonical = result.recordset[0]?.name ?? null;
    if (mustExist && !canonical) throw new ValidationError(message('validation.databaseNotFound'));
    return canonical;
  }

  async backup(databaseName, sqlPath, nativeCompression = false, operation = null) {
    const canonical = await this.canonicalDatabaseName(databaseName);
    const request = await this.request();
    request.input('backupPath', sql.NVarChar(4000), sqlPath);
    attachSqlProgress(request, operation, 'operation.progress.backupWriting');
    const compression = nativeCompression ? ', COMPRESSION' : '';
    await request.query(`BACKUP DATABASE ${quoteIdentifier(canonical)} TO DISK = @backupPath
      WITH COPY_ONLY, INIT, CHECKSUM, STATS = 10${compression}`);
  }

  async deleteDatabase(databaseName) {
    const request = await this.request();
    request.input('name', sql.NVarChar(128), databaseName);
    const result = await request.query(`SELECT name FROM sys.databases
      WHERE name = @name AND database_id > 4 AND source_database_id IS NULL`);
    const canonical = result.recordset[0]?.name;
    if (!canonical) throw new ValidationError(message('validation.userDatabaseNotFound'));
    const identifier = quoteIdentifier(canonical);
    await (await this.request()).query(`ALTER DATABASE ${identifier} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE ${identifier};`);
    return { databaseName: canonical };
  }

  async shrinkTransactionLog(databaseName, mode, { enabled = false } = {}) {
    if (!enabled) throw new AppError('Log shrinking is disabled.', {
      code: 'SHRINK_LOG_DISABLED', statusCode: 403,
      publicMessage: message('errors.databaseShrinkDisabled'),
    });
    if (!['safe', 'aggressive'].includes(mode)) throw new ValidationError(message('validation.databaseShrinkModeInvalid'));

    const lookup = await this.request();
    lookup.input('name', sql.NVarChar(128), databaseName);
    const databaseResult = await lookup.query(`SELECT name, recovery_model_desc AS recoveryModel,
        log_reuse_wait_desc AS logReuseWait
      FROM sys.databases WHERE name = @name AND database_id > 4
        AND source_database_id IS NULL AND state_desc = N'ONLINE' AND is_read_only = 0`);
    const database = databaseResult.recordset[0];
    if (!database) throw new ValidationError(message('validation.databaseUnavailableForWrite'));

    const identifier = quoteIdentifier(database.name);
    const readLogFiles = async () => (await (await this.request()).query(`USE ${identifier};
      SELECT file_id AS fileId, name, CONVERT(bigint, size) * 8192 AS sizeBytes
      FROM sys.database_files WHERE type = 1 ORDER BY file_id`)).recordset.map((row) => ({
      fileId: Number(row.fileId), name: row.name, sizeBytes: Number(row.sizeBytes),
    }));
    const before = await readLogFiles();
    if (!before.length) throw new AppError('No log files found.', {
      code: 'SHRINK_LOG_FILES_UNAVAILABLE', publicMessage: message('errors.databaseLogFilesUnavailable'),
    });

    const originalModel = database.recoveryModel;
    let modelChanged = false;
    let operationError;
    let restoreError;
    try {
      if (mode === 'aggressive' && originalModel !== 'SIMPLE') {
        await (await this.request()).query(`ALTER DATABASE ${identifier} SET RECOVERY SIMPLE`);
        modelChanged = true;
      }
      const checkpoint = mode === 'aggressive' || originalModel === 'SIMPLE' ? 'CHECKPOINT;\n' : '';
      const shrinkCommands = before.map(({ fileId }) => mode === 'safe'
        ? `DBCC SHRINKFILE (${fileId}, TRUNCATEONLY) WITH NO_INFOMSGS;`
        : `DBCC SHRINKFILE (${fileId}, 256) WITH NO_INFOMSGS;`).join('\n');
      await (await this.request()).query(`USE ${identifier};\n${checkpoint}${shrinkCommands}`);
    } catch (error) {
      operationError = error;
    } finally {
      if (modelChanged) {
        try {
          const recoveryModel = originalModel === 'BULK_LOGGED' ? 'BULK_LOGGED' : 'FULL';
          await (await this.request()).query(`ALTER DATABASE ${identifier} SET RECOVERY ${recoveryModel}`);
        } catch (error) { restoreError = error; }
      }
    }

    if (operationError || restoreError) {
      throw new AppError(restoreError ? 'Log shrinking failed and recovery model restoration failed.' : 'Log shrinking failed.', {
        code: restoreError ? 'SHRINK_LOG_RECOVERY_MODEL_FAILED' : 'SHRINK_LOG_FAILED',
        publicMessage: message(restoreError ? 'errors.databaseShrinkFailedRecoveryModel' : 'errors.databaseShrinkFailed'),
        cause: restoreError ?? operationError,
      });
    }

    const after = await readLogFiles();
    const beforeBytes = before.reduce((sum, file) => sum + file.sizeBytes, 0);
    const afterBytes = after.reduce((sum, file) => sum + file.sizeBytes, 0);
    return {
      databaseName: database.name,
      mode,
      recoveryModelBefore: originalModel,
      recoveryModelAfter: originalModel,
      logReuseWait: database.logReuseWait,
      beforeBytes,
      afterBytes,
      reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
      backupChainBroken: mode === 'aggressive' && modelChanged,
      files: before.map((file) => ({ ...file,
        afterBytes: after.find((candidate) => candidate.fileId === file.fileId)?.sizeBytes ?? null,
      })),
    };
  }

  async readHeader(sqlPath) {
    const request = await this.request();
    request.input('backupPath', sql.NVarChar(4000), sqlPath);
    const result = await request.query('RESTORE HEADERONLY FROM DISK = @backupPath');
    const full = result.recordset.filter((row) => Number(row.BackupType) === 1);
    if (result.recordset.length !== 1 || full.length !== 1 || Number(full[0].FamilyCount ?? 1) !== 1) {
      throw new ValidationError(message('validation.backupSingleFullSetRequired'));
    }
    return full[0];
  }

  async verify(sqlPath, position) {
    const verify = async (withChecksum) => {
      const request = await this.request();
      request.input('backupPath', sql.NVarChar(4000), sqlPath);
      const checksum = withChecksum ? ', CHECKSUM' : '';
      await request.query(`RESTORE VERIFYONLY FROM DISK = @backupPath WITH FILE = ${Number(position)}${checksum}`);
    };
    try {
      await verify(true);
    } catch (error) {
      const errors = [...(error?.precedingErrors ?? []), error];
      const lacksChecksum = errors.some((item) => item?.number === 3187
        || item?.message?.includes('backup set does not contain checksum information'));
      if (!lacksChecksum) throw error;
      await verify(false);
    }
  }

  async readFileList(sqlPath, position) {
    const request = await this.request();
    request.input('backupPath', sql.NVarChar(4000), sqlPath);
    const result = await request.query(`RESTORE FILELISTONLY FROM DISK = @backupPath WITH FILE = ${Number(position)}`);
    return result.recordset;
  }

  async assertTargetsAvailable(targets, targetDatabase) {
    const request = await this.request();
    request.input('targetDatabase', sql.NVarChar(128), targetDatabase);
    targets.forEach((target, index) => request.input(`path${index}`, sql.NVarChar(4000), target.targetPath));
    const values = targets.map((_, index) => `@path${index}`).join(', ');
    const result = await request.query(`SELECT physical_name FROM sys.master_files
      WHERE physical_name IN (${values}) AND DB_NAME(database_id) <> @targetDatabase`);
    if (result.recordset.length) throw new ValidationError(message('validation.restoreTargetPathInUse'));
  }

  async restore({ targetDatabase, sqlPath, position, mapping, replace, disconnectUsers, operation = null }) {
    const exists = await this.canonicalDatabaseName(targetDatabase, { mustExist: false });
    if (replace && !exists) throw new ValidationError(message('validation.restoreOverwriteDatabaseMissing'));
    if (!replace && exists) throw new ValidationError(message('validation.restoreTargetDatabaseExists'));
    const identifier = quoteIdentifier(exists ?? targetDatabase);
    const singleUser = replace && disconnectUsers
      ? `ALTER DATABASE ${identifier} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;\n`
      : '';
    if (singleUser) operation?.log(message('operation.event.databaseSessionsDisconnecting'));
    const moves = mapping.map((item) =>
      `MOVE ${unicodeSqlLiteral(item.logicalName)} TO ${unicodeSqlLiteral(item.targetPath)}`).join(',\n');
    const options = [`FILE = ${Number(position)}`, moves, 'RECOVERY', 'STATS = 10'];
    if (replace) options.push('REPLACE');
    const request = await this.request();
    request.input('backupPath', sql.NVarChar(4000), sqlPath);
    attachSqlProgress(request, operation, 'operation.progress.databaseRestoring');
    try {
      await request.query(`USE [master];\n${singleUser}RESTORE DATABASE ${identifier}
        FROM DISK = @backupPath WITH ${options.join(',\n')}`);
    } finally {
      if (replace && disconnectUsers) {
        await (await this.request()).query(`USE [master];
          IF DB_ID(${unicodeSqlLiteral(exists)}) IS NOT NULL
            AND DATABASEPROPERTYEX(${unicodeSqlLiteral(exists)}, 'Status') <> 'RESTORING'
            ALTER DATABASE ${identifier} SET MULTI_USER`).catch(() => {});
        operation?.log(message('operation.event.databaseMultiUserRestored'));
      }
    }
  }
}

function attachSqlProgress(request, operation, messageKey) {
  if (!operation || typeof request.on !== 'function') return;
  let lastProgress = -1;
  request.on('info', (info) => {
    const match = String(info?.message ?? '').match(/(\d+)\s+percent processed/i);
    if (!match) return;
    const progress = Number(match[1]);
    if (!Number.isFinite(progress) || progress === lastProgress) return;
    lastProgress = progress;
    operation.reportProgress(progress, message(messageKey, { progress }), { source: 'sql-server' });
  });
}

export function mapSqlError(error) {
  const sqlErrors = [...(error?.precedingErrors ?? []), error]
    .filter((item) => typeof item?.message === 'string')
    .filter((item, index, items) => items.findIndex((candidate) => candidate.message === item.message) === index);
  const sqlMessage = sqlErrors.map((item) => item.message).join(' ');
  if (sqlErrors.some((item) => item.number === 3169)) return new AppError(sqlMessage, { code: 'SQL_VERSION_MISMATCH',
    publicMessage: message('errors.sql.versionMismatch'), cause: error });
  if (error?.code === 'EREQUEST' || Number.isInteger(error?.number)) {
    return new AppError(sqlMessage, { code: 'SQL_RESTORE_FAILED',
      publicMessage: message('errors.sql.operationRejected', { detail: sqlMessage }), cause: error });
  }
  return error;
}