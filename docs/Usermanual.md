# MSSQLBackupTool User Manual

MSSQLBackupTool is a web application for creating, uploading, downloading, verifying, and restoring Microsoft SQL Server database backups.

> **Important:** Restoring or deleting a database and deleting a backup file can cause irreversible data loss. Always verify the database name and selected file before confirming an operation.

## 1. Opening the application

1. Open the address supplied by the administrator in a web browser.
2. If the browser displays a sign-in dialog, enter the shared username and password supplied by the administrator. The application uses HTTP Basic Authentication, so it has no separate sign-in page or sign-out button. Ending access may require closing all browser windows.
3. Wait for the database and backup-file lists to load.
4. Check the status in **SQL Server environment**:
   - **Connected** — the application can communicate with SQL Server;
   - **Disconnected** — some functions are unavailable. Select **↻** to refresh the information. Contact the administrator if the problem persists.

When connected, this section also shows the server or instance, SQL Server version and edition, host, connection database, login, transport, authentication method, and configured address. The version links to the corresponding Microsoft SQL Server version history.

The controls in the upper-right corner select English, German, Spanish, or Polish; switch between the light and dark themes; and change the primary interface color. Changing the language reloads the page. These preferences are stored in the browser. If no language preference has been stored, the administrator's configured language is used; English is the default.

## 2. Creating a backup

1. In **Create backup**, select a database.
2. Select a compression type:
   - **No compression** — creates a `.bak` file;
   - **Native MSSQL** — creates a `.bak` file using SQL Server compression;
   - **ZIP** — creates a ZIP archive;
   - **GZIP** — creates a GZIP archive;
   - **7Z** — creates a 7Z archive.
3. Select **Create backup**.
4. Monitor the progress and log in the operation dialog.
5. Review the final status:
   - **Success** — the backup was created and appears in the file list;
   - **Error** — review the error message and operation log.
6. Select **OK** to close the dialog.

The application creates full `COPY_ONLY` backups with `CHECKSUM` and initializes a new backup file. **Native MSSQL** additionally enables SQL Server compression. After successful ZIP, GZIP, or 7Z compression, the intermediate `.bak` file is deleted. Incomplete working files are removed if backup creation fails.

Only online user databases are available for backup. System databases and database snapshots are excluded.

## 3. Uploading a backup file

Supported filename extensions are `.bak`, `.bak.zip`, `.zip`, `.bak.gz`, `.gz`, `.bak.7z`, and `.7z`; extension matching is case-insensitive.

1. In **Backup files**, select **Choose and upload a file**.
2. Select a file from the computer. Upload starts automatically.
3. Monitor the progress indicator.
4. Review the result and select **OK**.

The administrator configures the maximum upload size. Do not close or reload the page while a file is being uploaded. An upload never overwrites a file with the same name.

For security, filenames must be 1–200 characters long, must not start with a period, and cannot contain paths, control characters, or reserved Windows names. Unicode letters, numbers, spaces, and `_( ).-` are accepted.

## 4. Managing backup files

The **Backup files** table shows each file's name, format, size, modification time, and available actions.

### Downloading a file

Select the download icon beside the required file. The browser starts saving it to the computer.

### Deleting a file

1. Select the trash icon beside the required file.
2. Verify the filename in the confirmation dialog.
3. Select **Delete file**.

> A deleted file cannot be recovered through the application.

Select **↻** beside the section heading to refresh the file list.

## 5. Verifying a backup

Verification reads the backup header, runs `RESTORE VERIFYONLY` with checksum validation when available, and reads the backup file list. It confirms that SQL Server can interpret the backup, but it does not replace a test restore or validation of the restored data.

1. In **Restore database**, select a backup file.
2. Select **Verify**.
3. Monitor the operation log.
4. Review the result and select **OK**.

For ZIP, GZIP, or 7Z archives, the application safely extracts a temporary `.bak` file first. The temporary file is deleted when the operation finishes, including after an error. The original archive remains in the file list.

A ZIP or 7Z archive must contain exactly one unencrypted `.bak` entry without a directory path. Extracted-size and compression-ratio safety limits apply. Encrypted and multipart 7Z archives are unsupported. GZIP archives are also subject to the configured extracted-size limit.

## 6. Restoring a backup as a new database

1. In **Restore database**, select a backup file.
2. Select **New database**.
3. Enter a name in **Target database name**.
4. Select **Verify and restore**.
5. Monitor the progress and operation log.
6. After a successful restore, confirm that the new database appears in **Databases**.

The target name must not identify an existing database in **New database** mode. **Automatically disconnect active sessions** applies only when overwriting an existing database.

During restore, the application maps data and log files to the data and log paths configured by the administrator. It generates safe physical filenames rather than reusing physical paths stored in the backup. A restore is rejected if a generated path is already used by another database.

## 7. Overwriting an existing database

> **Warning:** This operation permanently replaces the contents of the selected database with data from the backup.

1. In **Restore database**, select the correct backup file.
2. Select **Existing database**.
3. Select the target database.
4. Confirm that **Allow the existing database to be overwritten** is selected. The interface selects this consent automatically when existing-database mode is chosen, but it can be cleared.
5. If active connections may be interrupted, select **Automatically disconnect active sessions**.
6. Compare the backup filename and target database name again.
7. Select **Verify and restore**.
8. Monitor the operation until it finishes.

The application rejects the request without overwrite consent. If active sessions prevent the restore, it may fail unless automatic disconnection is enabled. Automatic disconnection switches the database to single-user mode and rolls back active transactions immediately. The application attempts to return the database to multi-user mode even if restore fails.

## 8. Database information

The **Databases** table shows:

- database name and state;
- allocated data-file and log-file sizes;
- total allocated size;
- number of active connections;
- recovery model;
- date of the last full backup;
- available administrative actions.

The displayed sizes are allocated file space, not the amount of data currently in use. Hovering over the log size shows the number of LDF files and the log-reuse wait reason. An em dash (**—**) means that information is unavailable or that the application lacks sufficient permissions.

Select **↻** beside the section heading to refresh the table.

## 9. Deleting a database

> **Danger:** Deleting a database permanently destroys all data stored in it. The operation automatically disconnects all sessions and rolls back uncommitted transactions immediately.

1. If the data may still be needed, create and download a backup first.
2. In **Databases**, select the trash icon beside the correct database.
3. Carefully verify the name in the confirmation dialog.
4. Select **Delete database**.
5. Wait for the operation to finish and review its result.

## 10. Shrinking a transaction log

Log-shrink actions are visible only when enabled by the administrator and only for online databases that are not read-only. They are intended for exceptional situations, primarily in development environments. Shrinking should not be routine maintenance, and neither mode disconnects active users.

### Releasing the inactive end of the log

**Release inactive end of log** preserves the current recovery model and releases inactive space at the end of every LDF file. It may recover little or no space if the final log regions are active or the database is waiting for a log backup.

1. Select the corresponding icon beside the database.
2. Read the warning.
3. Select **Shrink log** only if the operation is justified.

### Aggressively shrinking to 256 MB per LDF file

> **Warning:** Aggressive mode temporarily changes the database to the `SIMPLE` recovery model and breaks the transaction-log backup chain.

If the database previously used `FULL` or `BULK_LOGGED`, a database administrator must create a regular full backup **without `COPY_ONLY`** after this operation to start a new log backup chain. Backups created by MSSQLBackupTool use `COPY_ONLY` and therefore do not start a new chain. Consult a database administrator if uncertain.

## 11. Operation progress

Only one managed operation can run at a time. This includes backup, upload, verification, restore, deletion, and log shrinking. Files can still be downloaded and displayed information can be refreshed while an operation is running.

The operation dialog shows:

- current status and stage description;
- percentage progress when available;
- application and SQL Server log messages;
- the final result or error description.

A running operation dialog cannot be closed with **OK**. Closing the browser tab does not necessarily stop a backup or restore, but it prevents progress monitoring. Reopening the application may display the current or most recent operation status, provided that the application service has not restarted. Only the latest status is retained in process memory.

## 12. Troubleshooting

### SQL Server is disconnected

- refresh **SQL Server environment**;
- wait briefly and try again;
- if the problem persists, send the configured address and error text to the administrator.

### A database or file is missing from a list

- select **↻** beside the corresponding section;
- check whether another operation is still running;
- confirm that the previous operation completed successfully.

### A backup cannot be restored

Possible causes include:

- the backup was created by a newer SQL Server version than the target server;
- a certificate required for a TDE-protected backup is unavailable;
- active connections exist on the target database;
- insufficient disk space;
- a damaged or unsupported backup;
- insufficient permissions for the account used by the application.

Review the final message and operation log. When reporting a problem, provide the time, operation name, and complete error message, but never disclose passwords or other secrets.

### Upload was rejected

Check the filename extension and file size. The configured limit may be smaller than the selected backup. Do not rename an unsupported file merely to bypass extension validation. A duplicate filename is also rejected.

### ZIP or GZIP extraction was rejected

A ZIP file must contain exactly one `.bak` file, cannot contain a path or encrypted entry, and must satisfy extraction safety limits. Both ZIP and GZIP content must remain within the configured extracted-size limit.

### Request was rejected

Reload the page and try again. This can occur when the page was opened before the application service restarted, when the page token is missing or invalid, or when the application is accessed through an address that does not match the configured public origin.

## 13. Limitations

- The application supports one full backup set in one file and one media family. Multi-set and striped backups are not supported.
- Restore supports standard SQL Server data and log files. FILESTREAM, In-Memory OLTP, and other backup file types are not supported.
- Encrypted ZIP or GZIP archives are not supported.
- A backup created by a newer SQL Server version cannot be restored to an older version.
- Restoring a TDE-protected database requires the appropriate certificate on the target server.
- Most dynamic interface actions require access to the externally hosted HTMX library. If the browser cannot reach the configured CDN, forms, confirmations, and partial refreshes may not work correctly.

## 14. Safe working practices

- Verify the filename and database name at least twice before a destructive operation.
- Before overwriting or deleting an important database, create a backup and download it away from the server.
- Do not share backup files with unauthorized people; they may contain confidential data.
- Do not close or reload the page during an upload.
- Do not shrink transaction logs without a valid reason and an understanding of the consequences.
- Never include passwords, tokens, or other secrets in a support request.
