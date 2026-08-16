#!/bin/sh
set -eu

backup_path="${APP_BACKUP_PATH:-/app/backups}"

case "$backup_path" in
  /*) ;;
  *)
    echo "APP_BACKUP_PATH musi być bezwzględną ścieżką POSIX." >&2
    exit 1
    ;;
esac

mkdir -p "$backup_path/.incoming" "$backup_path/.work"
chown 10001:0 "$backup_path" "$backup_path/.incoming" "$backup_path/.work"
chmod 0770 "$backup_path" "$backup_path/.incoming" "$backup_path/.work"

exec su-exec 10001:0 "$@"
