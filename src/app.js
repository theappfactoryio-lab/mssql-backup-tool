import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import { create as contentDisposition } from 'content-disposition';
import { createBasicAuthMiddleware } from './middleware/basic-auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { ValidationError } from './errors/app-error.js';
import { createLocaleMiddleware, localizeOperation, message, normalizeLanguage } from './i18n/index.js';

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
  app.use(helmet({ contentSecurityPolicy: false }));
  app.get('/health', (request, response) => response.json({ status: 'ok' }));
  app.use(createLocaleMiddleware(config.defaultLanguage ?? 'en'));
  app.use(createBasicAuthMiddleware(config.auth));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use('/public', express.static(path.join(rootDirectory, 'public'), { fallthrough: false }));
  // htmx is loaded from CDN in the views to avoid bundling it into the image

  app.get('/operations/current', (request, response) => {
    response.json({ operation: localizeOperation(operationManager.getStatus(), response.locals) });
  });

  const environmentTarget = config.database
    ? `${config.database.server}:${config.database.port}`
    : null;
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
      const storedOperation = operationManager.getStatus(request.params.id ?? null);
      if (!storedOperation) return response.status(404).render('partials/message', {
        type: 'error', message: response.locals.t('operation.statusUnavailable'),
      });
      const operation = localizeOperation(storedOperation, response.locals);
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
    const originCanBeValidated = origin && origin !== 'null';
    if ((originCanBeValidated && origin !== config.publicOrigin) || request.body?._csrf !== csrfToken) {
      return next(new ValidationError(message('errors.requestRejected')));
    }
    next();
  }

  app.post('/language', protectMutation, (request, response, next) => {
    const language = normalizeLanguage(request.body.language);
    if (!language) return next(new ValidationError(message('config.languageUnsupported', { supportedLanguages: 'en, de, es, pl' })));
    const secure = new URL(config.publicOrigin ?? 'http://localhost').protocol === 'https:' ? '; Secure' : '';
    response.setHeader('Set-Cookie', `ui_language=${language}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`);
    response.redirect(303, '/');
  });

  app.post('/operations/:id/acknowledge', protectMutation, (request, response) => {
    const acknowledged = operationManager.acknowledge(request.params.id);
    if (!acknowledged) return response.status(409).render('partials/message', {
      type: 'error', message: response.locals.t('operation.acknowledgeUnavailable'),
    });
    response.status(200).send('<div id="operation-dialog-host"></div>');
  });

  function accepted(response, operation) {
    response.status(202).render('partials/operation-status', {
      operation: localizeOperation(operation, response.locals), refreshData: false,
      databases: [], databaseDetails: [], databasesAvailable: true,
      files: [], csrfToken, enableShrinkLog: config.enableShrinkLog,
    });
  }

  app.post('/operations/backup', protectMutation, (request, response, next) => {
    try {
      const operation = operationManager.tryStart({ type: 'backup', summary: message('operation.summary.backupPreparing'),
        work: (context) => services.backup.run({ databaseName: request.body.databaseName,
          compression: request.body.compression }, context) });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/operations/verify', protectMutation, (request, response, next) => {
    try {
      const filename = request.body.filename;
      const operation = operationManager.tryStart({ type: 'verify', summary: message('operation.summary.fileVerifying', { filename }),
        work: (context) => services.restore.verify(filename, context) });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/operations/restore', protectMutation, (request, response, next) => {
    try {
      const input = { filename: request.body.filename, targetMode: request.body.targetMode,
        targetDatabase: request.body.targetDatabase?.trim(), allowOverwrite: request.body.allowOverwrite === 'on',
        disconnectUsers: request.body.disconnectUsers === 'on' };
      const operation = operationManager.tryStart({ type: 'restore', summary: message('operation.summary.restorePreparing'),
        work: (context) => services.restore.restore(input, context) });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/databases/delete', protectMutation, (request, response, next) => {
    try {
      const databaseName = request.body.databaseName?.trim();
      if (request.body.confirmDelete !== 'yes') throw new ValidationError(message('validation.databaseDeleteConfirmationRequired'));
      const operation = operationManager.tryStart({ type: 'delete-database',
        summary: message('operation.summary.databaseDeleting', { databaseName }),
        work: async (context) => {
          context.updatePhase('deleting', message('operation.summary.databaseDeleting', { databaseName }));
          return services.database.deleteDatabase(databaseName);
        } });
      accepted(response, operation);
    } catch (error) { next(error); }
  });
  app.post('/databases/shrink-log', protectMutation, (request, response, next) => {
    try {
      const databaseName = request.body.databaseName?.trim();
      const mode = request.body.mode;
      if (request.body.confirmShrinkLog !== 'yes') throw new ValidationError(message('validation.databaseShrinkConfirmationRequired'));
      if (!['safe', 'aggressive'].includes(mode)) throw new ValidationError(message('validation.databaseShrinkModeInvalid'));
      const operation = operationManager.tryStart({ type: 'shrink-log',
        summary: message('operation.summary.databaseLogShrinking', { databaseName }),
        work: async (context) => {
          context.updatePhase('shrinking-log', message('operation.summary.databaseLogShrinking', { databaseName }));
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
      if (!request.file) return next(new ValidationError(message('validation.uploadFileRequired')));
      let filename;
      try { filename = decodeURIComponent(request.file.originalname); }
      catch { filename = request.file.originalname; }
      try {
        const operation = operationManager.tryStart({ type: 'upload', summary: message('operation.summary.fileSaving', { filename }),
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
        const { stream, info } = await services.files.openForDownload(request.params.name);
        response.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': info.size,
          'Content-Disposition': contentDisposition(request.params.name) });
        await pipeline(stream, response);
      } catch (error) { next(error); }
    });

    // New: rename, compress, extract endpoints
    app.post('/files/rename', protectMutation, (request, response, next) => {
      try {
        const oldName = request.body.filename;
        const newBase = request.body.newBase?.trim();
        const operation = operationManager.tryStart({ type: 'rename-file', summary: message('operation.summary.fileRenaming', { filename: oldName }),
          work: async (context) => {
            context.updatePhase('renaming', message('operation.summary.fileRenaming', { filename: oldName }));
            return services.files.rename(oldName, newBase);
          } });
        accepted(response, operation);
      } catch (error) { next(error); }
    });

    app.post('/files/compress', protectMutation, (request, response, next) => {
      try {
        const filename = request.body.filename;
        const format = request.body.format;
        const operation = operationManager.tryStart({ type: 'compress-file', summary: message('operation.summary.fileCompressing', { filename }),
          work: async (context) => {
            context.updatePhase('checking', message('operation.summary.fileCompressing', { filename }));
            return services.archive.compress(filename, format, context);
          } });
        accepted(response, operation);
      } catch (error) { next(error); }
    });

    app.post('/files/extract', protectMutation, (request, response, next) => {
      try {
        const filename = request.body.filename;
        const operation = operationManager.tryStart({ type: 'extract-file', summary: message('operation.summary.fileExtracting', { filename }),
          work: async (context) => {
            context.updatePhase('checking', message('operation.summary.fileExtracting', { filename }));
            return services.archive.extract(filename, context);
          } });
        accepted(response, operation);
      } catch (error) { next(error); }
    });

    app.post('/files/delete', protectMutation, (request, response, next) => {
      try {
        const filename = request.body.filename;
        if (request.body.confirmDelete !== 'yes') throw new ValidationError(message('validation.fileDeleteConfirmationRequired'));
        const operation = operationManager.tryStart({ type: 'delete-file', summary: message('operation.summary.fileDeleting', { filename }),
          work: async (context) => {
            context.updatePhase('deleting', message('operation.summary.fileDeleting', { filename }));
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
        operation: localizeOperation(operationManager.getStatus(), response.locals),
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