# Linux 演示部署

目标域名为 `campus.czjyy.top`。前端打包进 Java JAR，Nginx 提供 HTTPS 并转发到 `127.0.0.1:18086`。Java 由 systemd 管理，MySQL 8.4.9 通过 Docker Compose 独立运行，仅绑定 `127.0.0.1:13307`。

这是供小组共享的课程演示站，使用公开的模拟账号和独立数据库。浏览器之间共享报名、审核和通知记录；请勿录入真实个人材料。服务器不会导入开发电脑上的数据库、附件或数据库密码。

## 首次安装

需要 Java 21、Docker Compose、Nginx、Certbot、Python 3，并确保域名指向服务器，80、443 端口可访问。当前配置适用于 Ubuntu 和 systemd，执行安装需要 root。现有站点不得占用 `campus.czjyy.top`，本项目专用端口不得已被其他服务使用。

1. 在开发机执行 `pwsh -File scripts/package-server.ps1`。
2. 在服务器创建 `/opt/campus-platform/setup`，上传 `backend/target/campus-platform-0.4.0.jar`，命名为 `app.jar`，并上传本目录所有部署文件。
3. 执行 `bash /opt/campus-platform/setup/install.sh`。
4. 执行 `bash /opt/campus-platform/setup/enable-site.sh`。
5. 检查 `https://campus.czjyy.top/api/v1/health` 返回 `{"status":"up"}`，再检查页面和登录。

首次安装会在服务器生成随机数据库凭据，仅保存在 `/etc/campus-platform/db.env` 和 `app.env`，权限为 `0600`。这些文件不进入仓库。首次启动初始化模拟账号后，安装脚本关闭后端演示重置能力；Nginx 也拒绝 `/api/v1/demo/reset`。

安装使用 JAR 的 SHA-256 作为发布目录名，`/opt/campus-platform/current` 指向当前版本。默认按小组演示规模配置：Java 堆上限 256MB，进程内存上限 576MB，数据库容器内存上限 384MB。这不是此前千人并发测试的机器配置。

## 运维与更新

```bash
systemctl status campus-platform
journalctl -u campus-platform -n 80 --no-pager
docker compose -f /opt/campus-platform/compose.yaml ps
systemctl restart campus-platform
systemctl list-timers campus-backup.timer certbot.timer
```

更新前执行 `systemctl start campus-backup.service`，确认备份成功，再将新的 JAR 上传到 `setup/app.jar`，重新执行 `install.sh`。凭据和业务数据保留，安装脚本会短暂重启应用。更新失败时可将 `current` 改指向 `previous-release.txt` 中的旧目录并重启；如果新版本包含不向后兼容的数据库迁移，需要同时处理数据库恢复，不能只更换 JAR。

证书由 Certbot 自动续期，续期钩子校验配置后重新加载 Nginx。证书仅覆盖本项目子域名，不替换服务器其他站点的证书。

## 备份与恢复

每天北京时间 03:20 左右运行 `campus-backup.timer`，保留最近七份完成的备份。备份保存在 `/opt/campus-platform/backups`，包含 SQL、附件目录及发布版本路径。备份期间短暂停止应用以保持 SQL 与附件一致，完成或失败都会尝试恢复原先运行的服务。MySQL 本身继续运行。

```bash
systemctl start campus-backup.service
journalctl -u campus-backup.service -n 30 --no-pager
```

恢复必须先停止应用，并在备份之外保留当前 `data/files/archive-ledger.json`；导入 SQL 和附件后，应合并保留最新归档清理记录，再启动应用。应用会根据清理记录删除旧备份中已归档的个人内容，完成前不应开放站点。不要直接覆盖当前归档记录。恢复操作涉及覆盖当前数据，需另行确认目标备份并验证；本次部署不执行覆盖恢复。

备份目前和数据库位于同一台服务器，无法抵御整机或磁盘损坏。后续可把加密后的备份复制到另一台机器；本次未配置异地存储。
