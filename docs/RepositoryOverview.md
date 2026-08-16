# MSSQL Backup Tool

MSSQL Backup Tool is a web application that simplifies Microsoft SQL Server backup and restore operations in local development and testing environments.

> This image contains the web application only. Microsoft SQL Server must be started separately or provided as an existing instance.

## Features

- Create full database backups
- Use native MSSQL, ZIP, or GZIP compression
- Upload and download backup files
- Verify backups before restoring them
- Restore a backup as a new database
- Replace an existing database after confirmation
- Automatically map MDF, NDF, and LDF files
- Display database status, size, active connections, and last backup
- Prevent concurrent state-changing operations
- Optionally shrink transaction log files

Supported file formats:

- `.bak`
- `.bak.zip`
- `.bak.gz`
- `.zip`
- `.gz`

## Quick start

Create a `.env` file:

```env
MSSQL_SA_PASSWORD=Replace-With-A-Strong-Password1!
MSSQL_PASSWORD=Replace-With-A-Strong-Password1!
```

Create a `compose.yaml` file:

```yaml
services:
  mssql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_PID: Developer
      MSSQL_SA_PASSWORD: ${MSSQL_SA_PASSWORD}
    volumes:
      - backup-data:/var/opt/mssql/backup
      - sql-data:/var/opt/mssql
    healthcheck:
      test:
        - CMD-SHELL
        - /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$$MSSQL_SA_PASSWORD" -C -Q "SELECT 1" || exit 1
      interval: 10s
      timeout: 5s
      retries: 20
      start_period: 20s
    restart: unless-stopped

  sql-backup-tool:
    image: <docker-hub-account>/mssql-backup-tool:0.1.0
    init: true
    environment:
      PORT: 8080
      APP_HOST: 0.0.0.0
      PUBLIC_ORIGIN: http://localhost:8080
      MSSQL_HOST: mssql
      MSSQL_PORT: 1433
      MSSQL_USER: sa
      MSSQL_PASSWORD: ${MSSQL_PASSWORD}
      MSSQL_ENCRYPT: "false"
      MSSQL_TRUST_SERVER_CERTIFICATE: "true"
      MSSQL_BACKUP_PATH: /var/opt/mssql/backup
      MSSQL_DATA_PATH: /var/opt/mssql/data
      MSSQL_LOG_PATH: /var/opt/mssql/data
      APP_BACKUP_PATH: /app/backups
    volumes:
      - backup-data:/app/backups
    ports:
      - "127.0.0.1:8080:8080"
    depends_on:
      mssql:
        condition: service_healthy
    restart: unless-stopped

volumes:
  backup-data:
  sql-data:
```

Start the environment:

```bash
docker compose up -d
```

Open the web interface at <http://localhost:8080>.

## Configuration

The most important environment variables are:

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `8080` | Application HTTP port |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Public origin used to validate state-changing requests |
| `APP_LANGUAGE` | `en` | Default UI and application-log language: `en`, `de`, `es`, or `pl`. A browser selection stored in a cookie overrides this UI default. |
| `AUTH_ENABLED` | `true` | Enables HTTP Basic Auth for every endpoint except `/health` |
| `AUTH_USERNAME` | required when enabled | Shared web interface username |
| `AUTH_PASSWORD` | required when enabled | Shared web interface password |
| `MSSQL_HOST` | `mssql` | SQL Server hostname |
| `MSSQL_PORT` | `1433` | SQL Server TCP port |
| `MSSQL_USER` | `sa` | SQL Server login used by the application |
| `MSSQL_PASSWORD` | required | Password for the SQL Server login |
| `MSSQL_ENCRYPT` | `false` | Enables encryption for the TDS connection |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | `true` | Accepts the server certificate without validating its trust chain |
| `APP_BACKUP_PATH` | `/app/backups` | Backup directory visible to the application |
| `MSSQL_BACKUP_PATH` | `/var/opt/mssql/backup` | The same backup directory as seen by SQL Server |
| `MSSQL_DATA_PATH` | `/var/opt/mssql/data` | Destination directory for restored data files |
| `MSSQL_LOG_PATH` | `/var/opt/mssql/data` | Destination directory for restored log files |
| `MAX_UPLOAD_BYTES` | `53687091200` | Maximum upload size; 50 GiB by default |
| `MAX_EXTRACTED_BYTES` | `107374182400` | Maximum extracted backup size; 100 GiB by default |
| `MAX_COMPRESSION_RATIO` | `200` | Maximum permitted archive compression ratio |
| `ENABLE_SHRINK_LOG` | `false` | Enables transaction log shrinking operations |

The application and SQL Server must have access to the same backup files. The example configuration provides this through the shared `backup-data` volume.

## Available tags

Docker images are published to `theappfactoryio/mssql-backup-tool` with the following tags:

- `latest` — the most recent image built from the `main` branch
- `1.2.3` — an exact release version
- `1.2` — the most recent patch release in the `1.2` series
- `1` — the most recent release in the `1` major-version series
- `sha-<commit>` — an image built from a specific Git commit

Version tags are generated when a Git tag in the `vMAJOR.MINOR.PATCH` format, such as `v1.2.3`, is pushed to the repository.

For reproducible deployments, use an exact version instead of `latest`, a major tag, or a minor tag:

```yaml
image: theappfactoryio/mssql-backup-tool:1.2.3
```

## Security recommendations

- Never store passwords or other secrets directly in `compose.yaml`.
- Restrict access to the web interface using a firewall or reverse proxy.
- Enable encrypted SQL Server connections in remote environments.
- Use a trusted server certificate and set `MSSQL_TRUST_SERVER_CERTIFICATE=false`.
- Do not expose the SQL Server port publicly unless it is required.
- Use a dedicated SQL Server login with only the permissions required by the application.

## Intended use

This tool is intended primarily for local development and testing environments. It does not replace an enterprise backup system, retention policy, monitoring solution, or disaster recovery plan for production environments.
