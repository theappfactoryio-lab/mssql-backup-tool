import assert from 'node:assert/strict';
import test from 'node:test';
import sql from 'mssql';
import { DatabaseRepository } from '../../src/db/database-repository.js';

const enabled = process.env.RUN_SQL_INTEGRATION === 'true';

function integrationConfig() {
  return {
    server: process.env.MSSQL_HOST || '127.0.0.1',
    port: Number(process.env.MSSQL_PORT || 1433),
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD,
    database: 'master',
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === 'true',
      trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
    },
  };
}

test('zmniejsza log testowej bazy i zachowuje możliwość zapisu', { skip: !enabled }, async () => {
  assert.ok(process.env.MSSQL_PASSWORD, 'MSSQL_PASSWORD jest wymagane dla testu integracyjnego.');
  const pool = new sql.ConnectionPool(integrationConfig());
  const databaseName = `ShrinkIntegration_${Date.now()}`;
  const identifier = `[${databaseName.replaceAll(']', ']]')}]`;
  await pool.connect();

  try {
    await pool.request().query(`CREATE DATABASE ${identifier}; ALTER DATABASE ${identifier} SET RECOVERY SIMPLE;`);
    const repository = new DatabaseRepository(pool);
    const before = (await repository.listDatabaseDetails()).find((database) => database.name === databaseName);

    const result = await repository.shrinkTransactionLog(databaseName, 'safe', { enabled: true });

    assert.equal(result.databaseName, databaseName);
    assert.equal(result.recoveryModelAfter, 'SIMPLE');
    assert.ok(result.afterBytes <= result.beforeBytes);
    await pool.request().query(`USE ${identifier}; CREATE TABLE dbo.ShrinkWriteCheck (id int NOT NULL); INSERT dbo.ShrinkWriteCheck VALUES (1);`);
    const after = (await repository.listDatabaseDetails()).find((database) => database.name === databaseName);
    assert.equal(after.state, 'ONLINE');
  } finally {
    await pool.request().query(`USE master; IF DB_ID(N'${databaseName}') IS NOT NULL BEGIN ALTER DATABASE ${identifier} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${identifier}; END`).catch(() => {});
    await pool.close();
  }
});
