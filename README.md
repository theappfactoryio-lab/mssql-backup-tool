# MSSQLBackupTool

A local web application for creating, downloading, uploading, verifying, and restoring Microsoft SQL Server backups.

## Business overview

MSSQLBackupTool simplifies the management of Microsoft SQL Server database backups in local development and test environments. It provides a single interface for tasks that would normally require SQL Server Management Studio, T-SQL scripts, and manual file management. Users can create and compress a backup, download or upload it, verify its integrity, and then restore it as a new database or replace an existing database.

The application was created to standardize and accelerate the repetitive process of exchanging databases between team members and restoring data for development, testing, and diagnostics. It reduces the risk of errors caused by entering commands manually, provides a clear view of progress and errors, and brings backup files and basic administrative operations together in one place. Controlled confirmations for destructive operations provide additional protection against accidentally overwriting or deleting data.

The tool is intended primarily for local environments and is not a replacement for an organization's automated backup, retention, and monitoring system or its disaster recovery plan for production environments.

## Getting started

Docker Engine with Compose and approximately 110 GiB of free space are required for the default limits.

1. Copy `.env.example` to `.env`.
2. Set strong, matching values for `MSSQL_SA_PASSWORD` and `MSSQL_PASSWORD`.
3. Run:

```powershell
docker compose up -d --build
```

The dashboard will be available at <http://localhost:8080>. The port is published only on the local interface.

## Configuration

Place the configuration in an `.env` file next to `compose.yaml`. Use `.env.example` as a starting point. Compose loads this file automatically, while values supplied directly in the process environment take precedence. After changing the configuration, recreate the containers by running `docker compose up -d --build`.

### Backup volume initialization

The application image entrypoint briefly runs as `root`, creates the `.incoming` and `.work` directories, and sets their owner to `10001:0` and permissions to `0770`. It then uses `su-exec` to start Node.js as the unprivileged user `10001:0`. This prevents `EACCES` errors for new and existing volumes without requiring an additional initialization container. The operation does not recursively change ownership of backup files.

### SQL Server service (`mssql`)

| Compose parameter | Value | Description |
|---|---|---|
| `image` | `mcr.microsoft.com/mssql/server:2022-latest` | Official SQL Server 2022 image. The `latest` tag may point to a newer image revision the next time it is pulled. |
| `ACCEPT_EULA` | `Y` | Accepts the SQL Server image license; required by the image. |
| `MSSQL_PID` | `Developer` | Runs the free Developer edition, intended exclusively for development and testing. |
| `MSSQL_SA_PASSWORD` | value from `.env` | Password for the `sa` account, set when SQL Server is initialized. It must meet the SQL Server password complexity policy. |
| `backup-data:/var/opt/mssql/backup` | named volume | Provides SQL Server with the backup directory shared with the application. |
| `sql-data:/var/opt/mssql` | named volume | Persistently stores system databases, user databases, logs, and instance configuration. Removing the volume deletes the SQL Server data. |
| `ports: 1433:1433` | host → container | Publishes SQL Server on port 1433 on all host interfaces. If network access is unnecessary, use `127.0.0.1:1433:1433` or remove the port publication. The application communicates with SQL Server over the Compose network. |
| `healthcheck.test` | `sqlcmd ... SELECT 1` | Verifies that a login can be established and a query executed. The double `$$` leaves password expansion to the container rather than Compose. |
| `healthcheck.interval` | `10s` | Interval between health checks. |
| `healthcheck.timeout` | `5s` | Maximum duration of a single health check. |
| `healthcheck.retries` | `20` | Number of consecutive failures before the container is marked unhealthy. |
| `healthcheck.start_period` | `20s` | Startup period during which failures do not count toward the retry limit. |
| `restart` | `unless-stopped` | Automatically restarts the container after a failure or Docker restart unless it was stopped manually. |

### Application service (`sql-backup-tool`)

| Compose parameter | Value | Description |
|---|---|---|
| `image` | `mssql-backup-tool:latest` | Local application image name and tag. |
| `build` | `.` | Builds the image from the `Dockerfile` and the current directory context. |
| `init` | `true` | Runs a small init process that forwards signals and reaps orphaned processes. |
| `volumes` | `backup-data:/app/backups` | Mounts the shared backup volume at the path visible to the application. |
| `ports` | `127.0.0.1:8080:8080` | Makes the dashboard available locally only on port 8080. Changing `PORT` requires a corresponding change to the container port on the right side of the mapping. |
| `depends_on` | `mssql: condition: service_healthy` | Starts the application only after the SQL Server health check succeeds. This does not guarantee that the server will remain available throughout the application's lifetime. |
| `restart` | `unless-stopped` | Automatically restarts the application after a failure or Docker restart unless it was stopped manually. |

### Application variables

The `${NAME:-value}` syntax specifies a default when a variable is unset or empty. The `${NAME:?message}` syntax prevents Compose from starting when a required value is missing.

| Variable | Compose default | Description |
|---|---:|---|
| `PORT` | `8080` | HTTP port listened on inside the container; the allowed range is 1–65535. |
| `APP_HOST` | `0.0.0.0` | Listen address inside the container. `0.0.0.0` is required for Docker port forwarding to work. |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Public application origin: scheme, host, and optional port. It is used to validate the origin of mutating requests; behind a reverse proxy, it must match the address seen by the user. |
| `APP_LANGUAGE` | `en` | Default language for the UI and application logs. Allowed values: `en`, `de`, `es`, `pl`. A language selected by the user in the UI overrides this value in their browser. |
| `MSSQL_HOST` | `mssql` | SQL Server host name. In Compose, this is the service name resolved by internal DNS. |
| `MSSQL_PORT` | `1433` | SQL Server TCP port, from 1 to 65535. This is the port on the Compose network, not the port published on the host. |
| `MSSQL_USER` | `sa` | SQL Server login used by the application. |
| `MSSQL_PASSWORD` | none — required | Password for the login specified by `MSSQL_USER`. In a typical configuration it should match `MSSQL_SA_PASSWORD` when the `sa` login is used. |
| `MSSQL_ENCRYPT` | `false` | Enables TDS connection encryption only for the exact value `true`. `true` is recommended in remote environments. |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | `true` | When `true`, accepts the certificate without validating its trust chain. In production, `false` and a trusted server certificate are recommended. |
| `MSSQL_BACKUP_PATH` | `/var/opt/mssql/backup` | Absolute POSIX path to the shared backup directory as seen by the SQL Server process. |
| `MSSQL_DATA_PATH` | `/var/opt/mssql/data` | Absolute SQL Server-side directory where restore creates MDF/NDF files using `RESTORE ... WITH MOVE`. |
| `MSSQL_LOG_PATH` | `/var/opt/mssql/data` | Absolute SQL Server-side directory where restore creates LDF files using `RESTORE ... WITH MOVE`. |
| `APP_BACKUP_PATH` | `/app/backups` | Absolute POSIX path to the same backup contents as seen by the application container. It must match the `backup-data` mount point. |
| `MAX_UPLOAD_BYTES` | `53687091200` | Maximum uploaded file size in bytes; 50 GiB by default. The value must be a positive integer. |
| `MAX_EXTRACTED_BYTES` | `107374182400` | Maximum extracted `.bak` file size in bytes; 100 GiB by default. Protects against excessively large archives. |
| `MAX_COMPRESSION_RATIO` | `200` | Maximum ratio of extracted size to archive size. Protects against zip bombs; the minimum is 1. |
| `TEMP_MAX_AGE_HOURS` | `24` | Maximum age of temporary files before cleanup, expressed as a positive whole number of hours. |
| `ENABLE_SHRINK_LOG` | `false` | Enables administrative log-shrinking actions. Accepts only `true` or `false`. |

The application also supports optional variables that are not exposed by default in `compose.yaml`:

| Variable | Default | Description |
|---|---:|---|
| `HTTP_REQUEST_TIMEOUT_MS` | `0` | HTTP request timeout in milliseconds; `0` disables the timeout, allowing long-running backup and restore operations. |
| `MSSQL_CONNECTION_TIMEOUT_MS` | `15000` | SQL Server connection timeout in milliseconds; must be greater than zero. |
| `MSSQL_REQUEST_TIMEOUT_MS` | `0` | Timeout for an individual SQL request in milliseconds; `0` disables the timeout. |

To use them, add them to the `environment` section of the `sql-backup-tool` service, for example as `HTTP_REQUEST_TIMEOUT_MS: ${HTTP_REQUEST_TIMEOUT_MS:-0}`.

### Volumes and paths

The `backup-data` volume is mounted simultaneously as `/var/opt/mssql/backup` in the SQL Server container and `/app/backups` in the application container. Both paths point to the same contents, so the `MSSQL_BACKUP_PATH` and `APP_BACKUP_PATH` values and the mount points must remain consistent. On every startup, the application entrypoint corrects the permissions of the volume directory and working directories without deleting their contents.

The `sql-data` volume stores `/var/opt/mssql`, preserving instance data independently of the container lifecycle. The `docker compose down` command preserves the volumes, while `docker compose down -v` removes them together with all databases and backups.

`MSSQL_DATA_PATH` and `MSSQL_LOG_PATH` are required because paths stored in a backup may originate from another server and may not exist in the target environment. The application uses them to determine new file locations and passes them to the `RESTORE` command as `MOVE` mappings. They must point to existing directories where the account running SQL Server has write permission. These are not paths visible only to the application container.

### Passwords and permissions

`MSSQL_SA_PASSWORD` initializes the `sa` account in the SQL Server container, while `MSSQL_PASSWORD` is used by the application to log in. When `MSSQL_USER=sa`, the values should be identical. Changing only `MSSQL_SA_PASSWORD` after the `sql-data` volume has been created does not automatically change the password of the existing instance.

Do not commit or share the `.env` file. In non-local environments, using a secrets mechanism instead of plain environment variables is recommended.

If a login other than `sa` is used, it must have permissions to list databases, run `BACKUP DATABASE` and `RESTORE`, create and modify databases, and read `sys.master_files`. The active connection count requires visibility into `sys.dm_exec_sessions`, and the latest backup requires read access to the `msdb.dbo.backupset` history; without these permissions, the application displays `—`. `DBCC SHRINKFILE` requires membership in `sysadmin` or `db_owner` for the selected database.

## Metadata and log shrinking

The database list shows status, recovery model, active connections, latest full backup, and allocated data and log file sizes. These sizes do not represent the space actually used within the files.

After setting `ENABLE_SHRINK_LOG=true`, two modes are available:

- **Release log space** — preserves the recovery model and uses `DBCC SHRINKFILE(..., TRUNCATEONLY)` for each LDF. The result may be 0 B if the final log segments are active or if the database is waiting for, for example, a log backup.
- **To 256 MB/LDF** — temporarily switches the database to `SIMPLE`, runs `CHECKPOINT`, shrinks each LDF to a target size of 256 MB, and attempts to restore the previous model.

The aggressive mode breaks the log backup chain. After returning to `FULL` or `BULK_LOGGED`, perform a regular, non-`COPY_ONLY` full backup. Shrinking is not routine maintenance: it may increase load, cause the file to grow again, and degrade the VLF layout. The application does not shrink data files, does not use `DBCC SHRINKDATABASE`, and does not disconnect users during shrinking.

## Behavior

- Available formats are `.bak`, `.bak.zip`, `.bak.gz`, `.bak.7z`, `.zip`, `.gz`, and `.7z`.
- A backup can be uncompressed, compressed natively by MSSQL, or compressed as ZIP, GZIP, or 7Z.
- After successful ZIP/GZIP/7Z compression during backup creation, the intermediate `.bak` file is deleted. Manual compression preserves the source file.
- 7Z operations use the Alpine `7zip` package (`7zz`) with compression level `-mx=5`, at most two threads, a fixed process timeout, and no shell invocation. Encrypted, multipart, multi-entry, linked, or path-bearing archives are rejected.
- An archive uploaded by the user remains on the volume. The temporary `.bak` file is deleted after verification or restore, including when an error occurs.
- Only one mutating operation can run at a time. Downloads remain available.
- Closing the browser tab does not interrupt a backup or restore that has already started. Restarting the container clears the in-memory status and may interrupt the TDS connection.
- Restoring to an existing database requires confirmation to overwrite it. Automatically disconnecting active sessions is a separate option.

## Limitations

The first version supports one full backup set stored in a single file. Multi-set and striped backups, FILESTREAM, In-Memory OLTP, and encrypted archives are rejected. The runtime image includes the Alpine `7zip` package; 7-Zip licensing information is available from the Alpine package metadata and the 7-Zip project. A TDE-encrypted backup requires the appropriate certificate on the SQL Server side. A backup from a newer version of SQL Server cannot be restored on an older version; the application returns a clear error received from the server.

## Tests

```powershell
npm ci
npm test
```

The target environment is Node.js 24. Integration tests that require a real SQL Server are run after starting Compose.