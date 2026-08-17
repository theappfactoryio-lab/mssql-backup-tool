import en from './locales/en.js';
import de from './locales/de.js';
import es from './locales/es.js';
import pl from './locales/pl.js';

export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'de', 'es', 'pl']);
export const LANGUAGE_NAMES = Object.freeze({ en: 'English', de: 'Deutsch', es: 'Español', pl: 'Polski' });
export const LANGUAGE_LOCALES = Object.freeze({ en: 'en-GB', de: 'de-DE', es: 'es-ES', pl: 'pl-PL' });
const catalogs = Object.freeze({ en, de, es, pl });

export function normalizeLanguage(value, fallback = null) {
  const language = typeof value === 'string' ? value.trim().toLowerCase().split(/[-_]/, 1)[0] : '';
  return SUPPORTED_LANGUAGES.includes(language) ? language : fallback;
}

export function message(key, params = {}) {
  return { key, params };
}

export function rawMessage(raw) {
  return { raw: String(raw ?? '') };
}

export function isMessageDescriptor(value) {
  return Boolean(value && typeof value === 'object' && typeof value.key === 'string');
}

function interpolate(template, params) {
  return template.replace(/\{([\w]+)\}/g, (match, name) => (
    Object.hasOwn(params, name) ? String(params[name] ?? '') : match
  ));
}

export function createTranslator(language = 'en') {
  const resolvedLanguage = normalizeLanguage(language, 'en');
  const catalog = catalogs[resolvedLanguage];
  const locale = LANGUAGE_LOCALES[resolvedLanguage];

  function t(key, params = {}) {
    const count = Number(params.count);
    let resolvedKey = key;
    if (Number.isFinite(count)) {
      const category = new Intl.PluralRules(locale).select(count);
      if (catalog[`${key}.${category}`] !== undefined || en[`${key}.${category}`] !== undefined) resolvedKey = `${key}.${category}`;
      else if (catalog[`${key}.other`] !== undefined || en[`${key}.other`] !== undefined) resolvedKey = `${key}.other`;
    }
    const template = catalog[resolvedKey] ?? en[resolvedKey] ?? catalog[key] ?? en[key] ?? key;
    return interpolate(String(template), params);
  }

  function translate(value, fallbackKey = 'errors.unexpected') {
    if (isMessageDescriptor(value)) return t(value.key, value.params ?? {});
    if (value && typeof value === 'object' && Object.hasOwn(value, 'raw')) return String(value.raw ?? '');
    if (typeof value === 'string' && value) return value;
    return t(fallbackKey);
  }

  const number = new Intl.NumberFormat(locale);
  return {
    language: resolvedLanguage,
    locale,
    t,
    translate,
    formatNumber: (value, options = {}) => new Intl.NumberFormat(locale, options).format(value),
    formatDateTime: (value) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)),
    formatTime: (value) => new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(new Date(value)),
    formatPercent: (value) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Number(value) / 100),
    formatBytes(value) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let amount = Number(value);
      let unit = 0;
      while (Math.abs(amount) >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(amount)} ${units[unit]}`;
    },
    formatCount: (key, count) => t(key, { count: number.format(count) }),
  };
}

export function parseCookies(header = '') {
  return String(header).split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    if (!key || Object.hasOwn(cookies, key)) return cookies;
    try { cookies[key] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { cookies[key] = ''; }
    return cookies;
  }, {});
}

export function resolveRequestLanguage(request, defaultLanguage = 'en') {
  return normalizeLanguage(parseCookies(request?.headers?.cookie).ui_language)
    ?? normalizeLanguage(defaultLanguage, 'en');
}

export function serializeForHtmlScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function clientMessages(translator) {
  const keys = [
    'client.theme.enableLight', 'client.theme.enableDark', 'client.accent.switchToRed',
    'client.accent.switchToBlue', 'confirmation.defaultTitle', 'common.confirm',
    'errors.operationFailedTitle', 'status.error', 'common.ok', 'client.upload.uploading',
    'files.upload.choose', 'client.upload.dialogTitle', 'client.upload.dialogSummary',
    'status.running', 'operations.progress', 'operations.running.cannotClose',
    'validation.restoreOverwriteConsentRequired', 'validation.renameBaseRequired',
    'validation.renameBaseCharactersInvalid', 'validation.filenameUnchanged',
  ];
  return Object.fromEntries(keys.map((key) => [key, translator.t(key)]));
}

export function localizeOperation(operation, translator) {
  if (!operation) return operation;
  return {
    ...operation,
    summary: translator.translate(operation.summary),
    error: operation.error ? { ...operation.error, message: translator.translate(operation.error.message) } : null,
    events: (operation.events ?? []).map((event) => ({ ...event, message: translator.translate(event.message) })),
  };
}

export function createLocaleMiddleware(defaultLanguage = 'en') {
  return (request, response, next) => {
    const translator = createTranslator(resolveRequestLanguage(request, defaultLanguage));
    Object.assign(response.locals, translator, {
      languages: LANGUAGE_NAMES,
      translateMessage: translator.translate,
      clientCatalogJson: serializeForHtmlScript({ locale: translator.locale, messages: clientMessages(translator) }),
      localizeOperation: (operation) => localizeOperation(operation, translator),
    });
    next();
  };
}
