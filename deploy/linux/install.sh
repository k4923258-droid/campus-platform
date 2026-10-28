#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/campus-platform
source_dir=/opt/campus-platform/setup
test -f "$source_dir/app.jar"
test -f "$source_dir/compose.yaml"
if ! id campus-platform >/dev/null 2>&1; then
  useradd --system --home-dir /opt/campus-platform --shell /usr/sbin/nologin campus-platform
fi
install -d -m 0755 /opt/campus-platform /opt/campus-platform/releases /opt/campus-platform/data
install -d -m 0700 /etc/campus-platform /opt/campus-platform/backups
install -d -m 0700 -o campus-platform -g campus-platform /opt/campus-platform/data/files
install -d -m 0755 /var/www/campus-acme
python3 - <<'PY'
from pathlib import Path
import secrets
root = Path('/etc/campus-platform')
db = root / 'db.env'
app = root / 'app.env'
if db.exists() != app.exists():
    raise SystemExit('Credential files are incomplete; inspect before continuing')
if not db.exists():
    password = secrets.token_hex(32)
    db.write_text('MYSQL_DATABASE=campus\nMYSQL_USER=campus\nMYSQL_PASSWORD=' + password + '\nMYSQL_ROOT_PASSWORD=' + secrets.token_hex(32) + '\n')
    app.write_text('\n'.join([
        'CAMPUS_DB_URL=jdbc:mysql://127.0.0.1:13307/campus?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai',
        'CAMPUS_DB_USER=campus', 'CAMPUS_DB_PASSWORD=' + password,
        'CAMPUS_FILES=/opt/campus-platform/data/files', 'CAMPUS_DEMO=true',
        'SERVER_ADDRESS=127.0.0.1', 'SERVER_PORT=18086',
        'SERVER_FORWARD_HEADERS_STRATEGY=native',
        'SERVER_SERVLET_SESSION_COOKIE_SECURE=true',
        'SERVER_TOMCAT_THREADS_MAX=30', 'SERVER_TOMCAT_THREADS_MIN_SPARE=3',
        'SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=8',
    ]) + '\n')
    db.chmod(0o600)
    app.chmod(0o600)
PY
install -m 0644 "$source_dir/compose.yaml" /opt/campus-platform/compose.yaml
docker compose -f /opt/campus-platform/compose.yaml up -d --wait --wait-timeout 240
hash=$(sha256sum "$source_dir/app.jar" | cut -d' ' -f1)
release="/opt/campus-platform/releases/$hash"
install -d -m 0755 "$release"
install -m 0644 "$source_dir/app.jar" "$release/app.jar"
if [ -L /opt/campus-platform/current ]; then
  readlink /opt/campus-platform/current > /opt/campus-platform/previous-release.txt
fi
ln -sfn "$release" /opt/campus-platform/current
install -m 0644 "$source_dir/campus-platform.service" /etc/systemd/system/
install -m 0750 "$source_dir/backup.sh" /opt/campus-platform/backup.sh
install -m 0644 "$source_dir/campus-backup.service" "$source_dir/campus-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable campus-platform
systemctl restart campus-platform
healthy=0
for attempt in $(seq 1 90); do
  if curl -fsS --max-time 2 http://127.0.0.1:18086/api/v1/snapshot >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" != 1 ]; then
  journalctl -u campus-platform -n 70 --no-pager
  exit 1
fi
# Seed initialization is finished. The public site cannot invoke the demo reset.
if grep -qx 'CAMPUS_DEMO=true' /etc/campus-platform/app.env; then
  sed -i 's/^CAMPUS_DEMO=true$/CAMPUS_DEMO=false/' /etc/campus-platform/app.env
  systemctl restart campus-platform
  for attempt in $(seq 1 90); do
    if curl -fsS --max-time 2 http://127.0.0.1:18086/api/v1/snapshot >/dev/null 2>&1; then break; fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:18086/api/v1/health
fi
curl -fsS --max-time 5 http://127.0.0.1:18086/api/v1/snapshot >/dev/null
systemctl enable --now campus-backup.timer
printf '\nInstalled release: %s\n' "$hash"
