#!/usr/bin/env bash
set -euo pipefail
source_dir=/opt/campus-platform/setup
site=/etc/nginx/sites-available/campus.czjyy.top
install -d -m 0755 /var/www/campus-acme /opt/campus-platform/backups
if [ -e "$site" ]; then
  cp -a "$site" "/opt/campus-platform/backups/nginx-$(date -u +%Y%m%dT%H%M%SZ).conf"
fi
if [ ! -f /etc/letsencrypt/live/campus.czjyy.top/fullchain.pem ]; then
  cat > "$site" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name campus.czjyy.top;
    location ^~ /.well-known/acme-challenge/ { root /var/www/campus-acme; }
    location / { return 503; }
}
NGINX
  ln -sfn "$site" /etc/nginx/sites-enabled/campus.czjyy.top
  nginx -t
  systemctl reload nginx
  certbot certonly --webroot -w /var/www/campus-acme -d campus.czjyy.top \
    --non-interactive --agree-tos --register-unsafely-without-email
fi
if [ "${1:-}" = "--certificate-only" ]; then exit 0; fi
install -m 0644 "$source_dir/campus-proxy.conf" /etc/nginx/campus-proxy.conf
install -m 0644 "$source_dir/campus.nginx.conf" "$site"
ln -sfn "$site" /etc/nginx/sites-enabled/campus.czjyy.top
nginx -t
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/campus-nginx-reload <<'HOOK'
#!/bin/sh
nginx -t && systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/campus-nginx-reload
curl -fsS --retry 3 --retry-all-errors --retry-delay 1 --resolve campus.czjyy.top:443:127.0.0.1 https://campus.czjyy.top/api/v1/health
echo
