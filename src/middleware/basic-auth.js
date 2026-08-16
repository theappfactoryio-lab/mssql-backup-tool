import { createHash, timingSafeEqual } from 'node:crypto';

const challenge = 'Basic realm="MSSQLBackupTool", charset="UTF-8"';

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function matches(actual, expected) {
  return timingSafeEqual(digest(actual), digest(expected));
}

function unauthorized(response) {
  response.set('WWW-Authenticate', challenge);
  return response.status(401).type('text/plain').send(
    response.locals.t?.('auth.unauthorized') ?? 'Authentication failed.',
  );
}

export function createBasicAuthMiddleware(auth) {
  if (!auth?.enabled) return (request, response, next) => next();

  const expectedUsername = auth.username;
  const expectedPassword = auth.password;

  return (request, response, next) => {
    const authorization = request.get('authorization');
    const match = /^Basic\s+([^\s]+)$/i.exec(authorization ?? '');
    if (!match) return unauthorized(response);

    const encoded = match[1];
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      return unauthorized(response);
    }

    const credentials = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator < 0) return unauthorized(response);

    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);
    const usernameMatches = matches(username, expectedUsername);
    const passwordMatches = matches(password, expectedPassword);
    if (!usernameMatches || !passwordMatches) return unauthorized(response);

    return next();
  };
}
