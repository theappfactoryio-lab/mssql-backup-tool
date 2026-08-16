import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { OperationManager } from './operations/operation-manager.js';
import { FileService } from './services/file-service.js';
import { createPool } from './db/pool.js';
import { DatabaseRepository } from './db/database-repository.js';
import { BackupService } from './services/backup-service.js';
import { RestoreService } from './services/restore-service.js';

const config = loadConfig();
const operationManager = new OperationManager();
const files = new FileService(config);
await files.initialize();
const pool = createPool(config.database);
const database = new DatabaseRepository(pool);
const app = createApp({ config, operationManager, services: {
  files, database,
  backup: new BackupService({ database, files }),
  restore: new RestoreService({ database, files, config }),
} });
const server = createServer(app);
server.requestTimeout = config.requestTimeoutMs;

server.listen(config.port, config.host, () => {
  console.log(`MSSQLBackupTool nasłuchuje na porcie ${config.port}.`);
  void pool.connect().catch((error) => {
    console.error(`[MSSQL_CONNECTION_FAILED] ${error.message}`);
  });
});

function shutdown() {
  server.close((error) => {
    void pool.close();
    if (error) console.error(error);
    process.exitCode = error ? 1 : 0;
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);