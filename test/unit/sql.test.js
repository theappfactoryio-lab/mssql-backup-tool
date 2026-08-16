import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteIdentifier, unicodeSqlLiteral } from '../../src/db/sql-escaping.js';
import { DatabaseRepository, mapSqlError, sqlServerReleaseName } from '../../src/db/database-repository.js';
import { buildRestoreMapping } from '../../src/services/restore-mapping.js';

test('bezpiecznie cytuje identyfikatory i literały', () => {
  assert.equal(quoteIdentifier('Baza]Prod'), '[Baza]]Prod]');
  assert.equal(unicodeSqlLiteral("plik'o.bak"), "N'plik''o.bak'");
  assert.throws(() => quoteIdentifier('x'.repeat(129)));
});

test('mapuje MDF, NDF i LDF do skonfigurowanych katalogów', () => {
  const mapping = buildRestoreMapping([
    { FileID: 3, Type: 'L', LogicalName: 'log' },
    { FileID: 2, Type: 'D', LogicalName: 'secondary' },
    { FileID: 1, Type: 'D', LogicalName: 'primary' },
  ], 'Baza testowa', { dataPath: '/sql/data', logPath: '/sql/log' });
  assert.equal(mapping[0].targetPath.endsWith('.mdf'), true);
  assert.equal(mapping[1].targetPath.endsWith('.data2.ndf'), true);
  assert.equal(mapping[2].targetPath.endsWith('.log1.ldf'), true);
  assert.equal(mapping[2].targetPath.startsWith('/sql/log/'), true);
});

test('mapuje błąd żądania SQL na komunikat operacji', () => {
  const mapped = mapSqlError(Object.assign(new Error('Access is denied.'), {
    code: 'EREQUEST',
    number: 3201,
    precedingErrors: [{ number: 5, message: 'Cannot open backup device.' }],
  }));

  assert.equal(mapped.code, 'SQL_RESTORE_FAILED');
  assert.equal(mapped.userMessage,
    'SQL Server odrzucił operację: Cannot open backup device. Access is denied.');
});

test('mapuje numer produktu na nazwę wydania SQL Server', () => {
  assert.equal(sqlServerReleaseName('17.0.1000.7'), 'SQL Server 2025');
  assert.equal(sqlServerReleaseName('16.0.4265.3'), 'SQL Server 2022');
  assert.equal(sqlServerReleaseName('15.0.2000.5'), 'SQL Server 2019');
  assert.equal(sqlServerReleaseName('10.50.6000.34'), 'SQL Server 2008 R2');
  assert.equal(sqlServerReleaseName('10.0.6814.4'), 'SQL Server 2008');
  assert.equal(sqlServerReleaseName('9.00.5324'), 'SQL Server 2005');
  assert.equal(sqlServerReleaseName('8.00.2283'), 'SQL Server 2000');
  assert.equal(sqlServerReleaseName('7.00.1063'), 'SQL Server 7.0');
  assert.equal(sqlServerReleaseName('6.50.479'), 'SQL Server 6.5');
  assert.equal(sqlServerReleaseName('99.0.1.0'), null);
});

test('pobiera i normalizuje informacje o środowisku SQL Server', async () => {
  let queryText;
  const pool = {
    connected: true,
    request: () => ({
      async query(query) {
        queryText = query;
        return { recordset: [{
          serverName: 'SQL01\\DEV', machineName: 'SQL01', instanceName: 'DEV',
          productVersion: '16.0.1000.6', productLevel: 'RTM', edition: 'Developer Edition',
          databaseName: 'master', loginName: 'sa', netTransport: 'TCP', authenticationScheme: 'SQL',
        }] };
      },
    }),
  };

  const info = await new DatabaseRepository(pool).getEnvironmentInfo();

  assert.equal(info.serverName, 'SQL01\\DEV');
  assert.equal(info.productVersion, '16.0.1000.6');
  assert.equal(info.releaseName, 'SQL Server 2022');
  assert.equal(info.databaseName, 'master');
  assert.equal(info.authenticationScheme, 'SQL');
  assert.match(queryText, /SERVERPROPERTY\('ProductVersion'\)/);
  assert.match(queryText, /CONNECTIONPROPERTY\('auth_scheme'\)/);
  assert.doesNotMatch(queryText, /@@VERSION|dm_exec_connections/i);
});

test('weryfikuje backup bez metadanych CHECKSUM', async () => {
  const queries = [];
  const pool = {
    connected: true,
    request: () => ({
      input() { return this; },
      async query(query) {
        queries.push(query);
        if (queries.length === 1) {
          throw Object.assign(new Error('VERIFY DATABASE is terminating abnormally.'), {
            precedingErrors: [{ number: 3187,
              message: 'RESTORE WITH CHECKSUM cannot be specified because the backup set does not contain checksum information.' }],
          });
        }
      },
    }),
  };

  await new DatabaseRepository(pool).verify('/backup/database.bak', 1);

  assert.match(queries[0], /CHECKSUM/);
  assert.doesNotMatch(queries[1], /CHECKSUM/);
});

test('odtwarza istniejącą bazę z sesji master i rozłącza ją w tym samym batchu', async () => {
  const queries = [];
  const pool = {
    connected: true,
    request: () => ({
      input() { return this; },
      on() { return this; },
      async query(query) {
        queries.push(query);
        if (query.includes('SELECT name FROM sys.databases')) return { recordset: [{ name: 'Demo' }] };
        return { recordset: [] };
      },
    }),
  };

  await new DatabaseRepository(pool).restore({
    targetDatabase: 'Demo',
    sqlPath: '/backup/demo.bak',
    position: 1,
    mapping: [
      { logicalName: 'Demo', targetPath: '/data/demo.mdf' },
      { logicalName: 'Demo_log', targetPath: '/data/demo.ldf' },
    ],
    replace: true,
    disconnectUsers: true,
  });

  const restoreBatch = queries.find((query) => query.includes('RESTORE DATABASE'));
  const cleanupBatch = queries.find((query) => query.includes('SET MULTI_USER'));
  assert.match(restoreBatch,
    /^USE \[master\];[\s\S]*ALTER DATABASE \[Demo\] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;[\s\S]*RESTORE DATABASE \[Demo\]/);
  assert.equal(queries.filter((query) => query.includes('SET SINGLE_USER')).length, 1);
  assert.match(cleanupBatch, /^USE \[master\];/);
});

test('scala podstawowe i opcjonalne metadane baz', async () => {
  const pool = {
    connected: true,
    request: () => ({ async query(query) {
      if (query.includes('FROM sys.databases d')) return { recordset: [{ databaseId: 5, name: 'Demo',
        state: 'ONLINE', recoveryModel: 'FULL', logReuseWait: 'LOG_BACKUP', isReadOnly: false,
        dataSizeBytes: '1048576', logSizeBytes: '524288', logFileCount: 2 }] };
      if (query.includes('dm_exec_sessions')) return { recordset: [{ databaseId: 5, activeConnections: '3' }] };
      return { recordset: [{ name: 'Demo', lastFullBackupAt: new Date('2026-01-01T00:00:00Z') }] };
    } }),
  };

  const [database] = await new DatabaseRepository(pool).listDatabaseDetails();
  assert.equal(database.totalSizeBytes, 1572864);
  assert.equal(database.activeConnections, 3);
  assert.equal(database.logFileCount, 2);
  assert.equal(database.lastFullBackupAt.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('degraduje opcjonalne metadane przy braku uprawnień', async () => {
  const pool = {
    connected: true,
    request: () => ({ async query(query) {
      if (query.includes('FROM sys.databases d')) return { recordset: [{ databaseId: 5, name: 'Demo',
        state: 'ONLINE', recoveryModel: 'SIMPLE', logReuseWait: 'NOTHING', isReadOnly: false,
        dataSizeBytes: 1, logSizeBytes: 2, logFileCount: 1 }] };
      throw new Error('permission denied');
    } }),
  };

  const [database] = await new DatabaseRepository(pool).listDatabaseDetails();
  assert.equal(database.activeConnections, null);
  assert.equal(database.lastFullBackupAt, null);
});

test('bezpiecznie zmniejsza wszystkie pliki logu bez zmiany FULL', async () => {
  const queries = [];
  let logRead = 0;
  const pool = {
    connected: true,
    request: () => ({
      input() { return this; },
      async query(query) {
        queries.push(query);
        if (query.includes('FROM sys.databases WHERE')) return { recordset: [{
          name: 'Demo]Dev', recoveryModel: 'FULL', logReuseWait: 'LOG_BACKUP',
        }] };
        if (query.includes('FROM sys.database_files')) {
          logRead += 1;
          return { recordset: [{ fileId: 2, name: 'Demo_log', sizeBytes: logRead === 1 ? 1024 : 512 },
            { fileId: 3, name: 'Demo_log2', sizeBytes: logRead === 1 ? 2048 : 1024 }] };
        }
        return { recordset: [] };
      },
    }),
  };

  const result = await new DatabaseRepository(pool).shrinkTransactionLog('Demo]Dev', 'safe', { enabled: true });
  const shrink = queries.find((query) => query.includes('DBCC SHRINKFILE'));
  assert.match(shrink, /USE \[Demo\]\]Dev\]/);
  assert.match(shrink, /SHRINKFILE \(2, TRUNCATEONLY\)/);
  assert.match(shrink, /SHRINKFILE \(3, TRUNCATEONLY\)/);
  assert.doesNotMatch(shrink, /CHECKPOINT|SHRINKDATABASE/);
  assert.equal(result.reclaimedBytes, 1536);
  assert.equal(result.backupChainBroken, false);
});

test('agresywnie zmniejsza każdy LDF i przywraca model odzyskiwania', async () => {
  const queries = [];
  const pool = {
    connected: true,
    request: () => ({
      input() { return this; },
      async query(query) {
        queries.push(query);
        if (query.includes('FROM sys.databases WHERE')) return { recordset: [{
          name: 'Demo', recoveryModel: 'BULK_LOGGED', logReuseWait: 'NOTHING',
        }] };
        if (query.includes('FROM sys.database_files')) return { recordset: [{ fileId: 2, name: 'log', sizeBytes: 1024 }] };
        return { recordset: [] };
      },
    }),
  };

  const result = await new DatabaseRepository(pool).shrinkTransactionLog('Demo', 'aggressive', { enabled: true });
  assert.ok(queries.some((query) => /SET RECOVERY SIMPLE/.test(query)));
  assert.ok(queries.some((query) => /CHECKPOINT;[\s\S]*SHRINKFILE \(2, 256\)/.test(query)));
  assert.ok(queries.some((query) => /SET RECOVERY BULK_LOGGED/.test(query)));
  assert.equal(result.backupChainBroken, true);
});

test('odrzuca shrink wyłączony w konfiguracji', async () => {
  const repository = new DatabaseRepository({ connected: true });
  await assert.rejects(repository.shrinkTransactionLog('Demo', 'safe'), { code: 'SHRINK_LOG_DISABLED' });
});