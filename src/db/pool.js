import sql from 'mssql';

export function createPool(config) {
  return new sql.ConnectionPool({
    server: config.server,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'master',
    connectionTimeout: config.connectionTimeout,
    requestTimeout: config.requestTimeout,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
      enableArithAbort: true,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  });
}