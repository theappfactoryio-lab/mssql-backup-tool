import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { OperationManager } from './operations/operation-manager.js';
import { FileService } from './services/file-service.js';
import { createPool } from './db/pool.js';
import { DatabaseRepository } from './db/database-repository.js';
import { BackupService } from './services/backup-service.js';
import { RestoreService } from './services/restore-service.js';
import { createTranslator } from './i18n/index.js';

const config = loadConfig();
const { t } = createTranslator(config.defaultLanguage);
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
  console.log(t('server.started', { port: config.port }));
  if (!config.auth.enabled) {
    console.warn(`[AUTH_DISABLED] ${t('server.authDisabled')}`);
  }
  void pool.connect().catch((error) => {
    console.error(`[MSSQL_CONNECTION_FAILED] ${t('server.databaseConnectionFailed', { detail: error.message })}`);
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