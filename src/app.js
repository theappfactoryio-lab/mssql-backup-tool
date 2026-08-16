import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { create as contentDisposition } from 'content-disposition';
import { errorHandler } from './middleware/error-handler.js';
import { ValidationError } from './errors/app-error.js';

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp({ config, operationManager, services = {} }) {
  const app = express();
  const csrfToken = randomUUID();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(rootDirectory, 'views'));
  app.locals.operationManager = operationManager;
  app.locals.csrfToken = csrfToken;
  app.locals.enableShrinkLog = config.enableShrinkLog;
  app.locals.formatBytes = (value) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const bytes = Number(value);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unit = 0;
    let amount = bytes;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount.toLocaleString('pl-PL', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
  };
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use('/public', express.static(path.join(rootDirectory, 'public'), { fallthrough: false }));
  // htmx is loaded from CDN in the views to avoid bundling it into the image

  app.get('/health', (request, response) => response.json({ status: 'ok' }));
  app.get('/operations/current', (request, response) => {
    response.json({ operation: operationManager.getStatus() });
  });

  const environmentTarget = config.database
    ? `${config.database.server}:${config.database.port}`
    : 'Nie skonfigurowano';
  const disconnectedEnvironment = () => ({
    connected: false,
    target: environmentTarget,
  });
  const getSqlEnvironment = async () => ({
    connected: true,
    target: environmentTarget,
    ...await services.database.getEnvironmentInfo(),
  });

  app.get('/partials/sql-environment', async (request, response) => {
    let sqlEnvironment;
    try { sqlEnvironment = await getSqlEnvironment(); }
    catch { sqlEnvironment = disconnectedEnvironment(); }
    response.render('partials/sql-environment', { sqlEnvironment });
  });

  app.get('/partials/files', async (request, response, next) => {
    try {
      const files = await services.files.list();
      response.render('partials/files-data', { files, csrfToken });
    } catch (error) { next(error); }
  });

  app.get('/partials/databases', async (request, response) => {
    try {
      const databaseDetails = await services.database.listDatabaseDetails();
      response.render('partials/database-data', {
        databaseDetails, databasesAvailable: true, csrfToken, oob: true,
        enableShrinkLog: config.enableShrinkLog,
      });
    } catch {
      response.render('partials/database-data', {
        databaseDetails: [], databasesAvailable: false, csrfToken, oob: true,
        enableShrinkLog: config.enableShrinkLog,
      });
    }
  });

  async function renderOperation(request, response, next) {
    try {
      const operation = operationManager.getStatus(request.params.id ?? null);
      if (!operation) return response.status(404).render('partials/message', {
        type: 'error', message: 'Status tej operacji nie jest już dostępny.',
      });
      const refreshData = operation.status !== 'running';
      let databases = [];
      let databaseDetails = [];
      let files = [];
      let databasesAvailable = true;
      if (refreshData) {
        const [namesResult, detailsResult, filesResult] = await Promise.allSettled([
          services.database.listDatabases(), services.database.listDatabaseDetails(), services.files.list(),
        ]);
        databases = namesResult.status === 'fulfilled' ? namesResult.value : [];
        databaseDetails = detailsResult.status === 'fulfilled' ? detailsResult.value : [];
        files = filesResult.status === 'fulfilled' ? filesResult.value : [];
        databasesAvailable = detailsResult.status === 'fulfilled';
      }
      response.render('partials/operation-status', { operation, refreshData, databases, databaseDetails,
        databasesAvailable, files, csrfToken, enableShrinkLog: config.enableShrinkLog });
    } catch (error) { next(error); }
  }
  app.get('/partials/operation', renderOperation);
  app.get('/partials/operations/:id', renderOperation);

  function protectMutation(request, response, next) {
    const origin = request.get('origin');
    if ((origin && origin !== config.publicOrigin) || request.body?._csrf !== csrfToken) {
      return next(new ValidationError('Żądanie zostało odrzucone. Odśwież stronę i spróbuj ponownie.'));
    }
    next();
  }

  app.post('/operations/:id/acknowledge', protectMutation, (request, response) => {
    const acknowledged = operationManager.acknowledge(request.params.id);
    if (!acknowledged) return response.status(409).render('partials/message', {
      type: 'error', message: 'Operacja nadal trwa albo jej status nie jest już dostępny.',
    });
    response.status(200).send('<div id="operation-dialog-host"></div>');
  });

  function accepted(response, operation) {
    response.status(202).render('partials/operation-status', {
      operation, refreshData: false, databases: [], databaseDetails: [], databasesAvailable: true,
      files: [], csrfToken, enableShrinkLog: config.enableShrinkLog,
    });
  }

  app.post('/operations/backup', protectMutation, (request, response, next) => {
    try {
      const operation = operationManager.tryStart({ type: 'backup', summary: 'Przygotowanie backupu',
        work: (context) => services.backup.run({ databaseName: request.body.databaseName,
          compression: request.body.compression }, context) });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/operations/verify', protectMutation, (request, response, next) => {
    try {
      const filename = request.body.filename;
      const operation = operationManager.tryStart({ type: 'verify', summary: `Weryfikowanie ${filename}`,
        work: (context) => services.restore.verify(filename, context) });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/operations/restore', protectMutation, (request, response, next) => {
    try {
      const input = { filename: request.body.filename, targetMode: request.body.targetMode,
        targetDatabase: request.body.targetDatabase?.trim(), allowOverwrite: request.body.allowOverwrite === 'on',
        disconnectUsers: request.body.disconnectUsers === 'on' };
      const operation = operationManager.tryStart({ type: 'restore', summary: 'Przygotowanie odtwarzania',
        work: (context) => services.restore.restore(input, context) });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/databases/delete', protectMutation, (request, response, next) => {
    try {
      const databaseName = request.body.databaseName?.trim();
      if (request.body.confirmDelete !== 'yes') throw new ValidationError('Potwierdź usunięcie bazy danych.');
      const operation = operationManager.tryStart({ type: 'delete-database',
        summary: `Usuwanie bazy ${databaseName}`,
        work: async (context) => {
          context.updatePhase('deleting', `Usuwanie bazy ${databaseName}`);
          return services.database.deleteDatabase(databaseName);
        } });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/databases/shrink-log', protectMutation, (request, response, next) => {
    try {
      const databaseName = request.body.databaseName?.trim();
      const mode = request.body.mode;
      if (request.body.confirmShrinkLog !== 'yes') throw new ValidationError('Potwierdź zmniejszenie logu bazy.');
      if (!['safe', 'aggressive'].includes(mode)) throw new ValidationError('Nieprawidłowy tryb zmniejszania logu.');
      const operation = operationManager.tryStart({ type: 'shrink-log',
        summary: `Zmniejszanie logu bazy ${databaseName}`,
        work: async (context) => {
          context.updatePhase('shrinking-log', `Zmniejszanie logu bazy ${databaseName}`);
          return services.database.shrinkTransactionLog(databaseName, mode, { enabled: config.enableShrinkLog });
        } });
      accepted(response, operation);
    } catch (error) { next(error); }
  });

  if (services.files) {
    const upload = multer({ storage: multer.diskStorage({ destination: services.files.incomingPath,
      filename: (request, file, callback) => callback(null, `${randomUUID()}.part`) }),
      limits: { fileSize: config.maxUploadBytes, files: 1 } }).single('backupFile');
    app.post('/files/upload', upload, protectMutation, (request, response, next) => {
      if (!request.file) return next(new ValidationError('Wybierz plik do przesłania.'));
      let filename;
      try { filename = decodeURIComponent(request.file.originalname); }
      catch { filename = request.file.originalname; }
      try {
        const operation = operationManager.tryStart({ type: 'upload', summary: `Zapisywanie ${filename}`,
          work: async () => {
            try { await services.files.publish(request.file.path, filename); return { filename }; }
            catch (error) { const { unlink } = await import('node:fs/promises'); await unlink(request.file.path).catch(() => {}); throw error; }
          } });
        accepted(response, operation);
      } catch (error) {
        void unlink(request.file.path).catch(() => {});
        next(error);
      }
    });
    app.get('/files/:name/download', async (request, response, next) => {
      try {
        const { filePath, handle, info } = await services.files.openForDownload(request.params.name);
        response.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': info.size,
          'Content-Disposition': contentDisposition(request.params.name), 'Accept-Ranges': 'bytes' });
        createReadStream(filePath, { fd: handle.fd, autoClose: true }).on('error', next).pipe(response);
      } catch (error) { next(error); }
    });
    app.post('/files/delete', protectMutation, (request, response, next) => {
      try {
        const filename = request.body.filename;
        if (request.body.confirmDelete !== 'yes') throw new ValidationError('Potwierdź usunięcie pliku.');
        const operation = operationManager.tryStart({ type: 'delete-file', summary: `Usuwanie ${filename}`,
          work: async (context) => {
            context.updatePhase('deleting', `Usuwanie ${filename}`);
            return services.files.delete(filename);
          } });
        accepted(response, operation);
      } catch (error) { next(error); }
    });
  }
  app.get('/', async (request, response, next) => {
    try {
      const [databaseResult, detailResult, environmentResult, files] = await Promise.all([
        Promise.resolve(services.database?.listDatabases?.() ?? [])
          .then((databases) => ({ databases, available: true }))
          .catch(() => ({ databases: [], available: false })),
        Promise.resolve(services.database?.listDatabaseDetails?.() ?? [])
          .then((databaseDetails) => ({ databaseDetails, available: true }))
          .catch(() => ({ databaseDetails: [], available: false })),
        services.database?.getEnvironmentInfo
          ? getSqlEnvironment().catch(disconnectedEnvironment)
          : Promise.resolve(disconnectedEnvironment()),
        services.files?.list?.() ?? [],
      ]);
      response.render('index', {
        databases: databaseResult.databases,
        databaseDetails: detailResult.databaseDetails,
        databasesAvailable: detailResult.available,
        enableShrinkLog: config.enableShrinkLog,
        sqlEnvironment: environmentResult,
        files,
        operation: operationManager.getStatus(),
        maxUploadBytes: config.maxUploadBytes,
        csrfToken,
        refreshData: false,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);
  return app;
}