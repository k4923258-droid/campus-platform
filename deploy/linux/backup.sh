#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/campus-platform
exec 9>/run/campus-backup.lock
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/opt/campus-platform/backups/$stamp"
mkdir -p "$backup"
restart_needed=0
cleanup() {
  if [ "$restart_needed" = 1 ]; then systemctl start campus-platform; fi
}
trap cleanup EXIT
if systemctl is-active --quiet campus-platform; then
  restart_needed=1
  systemctl stop campus-platform
fi
docker compose -f /opt/campus-platform/compose.yaml exec -T db sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --events --no-tablespaces --set-gtid-purged=OFF campus' \
  | gzip > "$backup/database.sql.gz"
tar -czf "$backup/files.tar.gz" -C /opt/campus-platform/data files
readlink /opt/campus-platform/current > "$backup/release.txt"
touch "$backup/complete"
if [ "$restart_needed" = 1 ]; then systemctl start campus-platform; restart_needed=0; fi
python3 - <<'PY'
from pathlib import Path
import shutil
root = Path('/opt/campus-platform/backups').resolve()
backups = sorted(p for p in root.iterdir() if p.is_dir() and (p / 'complete').is_file())
for old in backups[:-7]:
    if old.is_symlink() or old.resolve().parent != root:
        raise SystemExit('Unsafe backup cleanup path')
    shutil.rmtree(old)
print('Completed backups retained:', min(len(backups), 7))
PY
echo "Backup complete: $stamp"
