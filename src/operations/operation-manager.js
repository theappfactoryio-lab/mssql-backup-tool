import { randomUUID } from 'node:crypto';
import { isMessageDescriptor, message } from '../i18n/index.js';

const MAX_EVENTS = 200;
const MAX_MESSAGE_LENGTH = 500;
const LEVELS = new Set(['info', 'warning', 'error', 'success']);
const SOURCES = new Set(['application', 'sql-server', 'upload']);

function safeText(value) {
  return String(value ?? '')
    .replace(/(password|pwd|token|secret)\s*[=:]\s*[^\s;,]+/gi, '$1=[REDACTED]')
    .replace(/[A-Z]:\\[^\r\n"']+/gi, '[PATH REDACTED]')
    .slice(0, MAX_MESSAGE_LENGTH);
}

function safeMessage(value) {
  if (!isMessageDescriptor(value)) return { raw: safeText(value?.raw ?? value) };
  const params = Object.fromEntries(Object.entries(value.params ?? {}).map(([key, parameter]) => [
    key,
    typeof parameter === 'number' && Number.isFinite(parameter) ? parameter
      : typeof parameter === 'boolean' || parameter === null ? parameter : safeText(parameter),
  ]));
  return message(safeText(value.key), params);
}

export class OperationBusyError extends Error {
  constructor(operation) {
    super('Another operation is already running.');
    this.name = 'OperationBusyError';
    this.code = 'OPERATION_BUSY';
    this.statusCode = 409;
    this.publicMessage = message('operation.busy');
    this.userMessage = this.publicMessage;
    this.operation = operation;
  }
}

export class OperationManager {
  #active = null;
  #last = null;

  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  getStatus(id = null) {
    const operation = this.#active ?? this.#last;
    return !id || operation?.id === id ? operation : null;
  }

  acknowledge(id) {
    if (this.#active?.id === id) return false;
    if (this.#last?.id !== id) return false;
    this.#last = null;
    return true;
  }

  isBusy() {
    return this.#active !== null;
  }

  tryStart({ type, summary, work }) {
    if (this.#active) {
      throw new OperationBusyError(this.#active);
    }

    const operation = {
      id: randomUUID(),
      type,
      summary: safeMessage(summary),
      status: 'running',
      phase: 'starting',
      progress: null,
      startedAt: new Date(),
      finishedAt: null,
      result: null,
      error: null,
      events: [],
    };
    let sequence = 0;
    const addEvent = ({ level = 'info', source = 'application', message, progress = null, phase = operation.phase }) => {
      const hasProgress = progress !== null && progress !== undefined && progress !== '';
      const numericProgress = hasProgress ? Number(progress) : Number.NaN;
      const event = {
        sequence: ++sequence,
        timestamp: new Date(),
        level: LEVELS.has(level) ? level : 'info',
        source: SOURCES.has(source) ? source : 'application',
        phase,
        message: safeMessage(message),
        progress: Number.isFinite(numericProgress) ? Math.max(0, Math.min(100, Math.round(numericProgress))) : null,
      };
      operation.events.push(event);
      if (operation.events.length > MAX_EVENTS) operation.events.splice(0, operation.events.length - MAX_EVENTS);
      if (event.progress !== null) operation.progress = event.progress;
      return event;
    };

    this.#active = operation;
    addEvent({ message: operation.summary });

    const context = {
      log: (message, options = {}) => addEvent({ ...options, message }),
      reportProgress: (progress, message = operation.summary, options = {}) => addEvent({ ...options, message, progress }),
      updatePhase: (phase, nextSummary = operation.summary) => {
        operation.phase = phase;
        operation.summary = safeMessage(nextSummary);
        operation.progress = null;
        addEvent({ phase, message: operation.summary });
      },
    };

    void Promise.resolve()
      .then(() => work(context))
      .then((result) => {
        operation.status = 'succeeded';
        operation.progress = 100;
        operation.result = result ?? null;
        addEvent({ level: 'success', message: message('operation.completedSuccessfully'), progress: 100 });
      })
      .catch((error) => {
        const cause = error?.cause?.stack ? `\nCaused by: ${error.cause.stack}` : '';
        this.logger.error(`[${error?.code ?? 'UNEXPECTED_ERROR'}] ${error?.stack ?? error?.message ?? error}${cause}`);
        operation.status = 'failed';
        operation.error = {
          code: error?.code ?? 'UNEXPECTED_ERROR',
          message: safeMessage(error?.publicMessage ?? error?.userMessage ?? message('operation.failed')),
        };
        addEvent({ level: 'error', message: operation.error.message });
      })
      .finally(() => {
        operation.finishedAt = new Date();
        this.#last = operation;
        this.#active = null;
      });

    return operation;
  }
}