# 校园社团招新与竞赛信息一体化平台

基于需求文档 v0.5 的课程原型，包含独立运行的 Vue 交互版及 Java + MySQL 后端验证版。Word 原稿未改动。所有内置组织、活动与账号均为演示数据，不能作为学校当届正式通知。

## 启动交互版

环境：Node 24.12+ 或满足 package.json engines 的版本。本机已使用 Node 26.5.1 验证。

```powershell
git clone https://github.com/k4923258-droid/campus-platform.git
cd campus-platform
npm.cmd ci
npm.cmd run dev
```

打开终端给出的本机地址，通常为 http://127.0.0.1:5173/ 。页面顶部为平台名称和功能导航。模拟状态保存在当前浏览器的 IndexedDB，清除站点数据会重置。每个浏览器使用独立数据；模拟版不用于跨浏览器多人协同。

| 角色                 | 账号     | 密码     |
| -------------------- | -------- | -------- |
| 学生 / 队长          | 20260001 | Demo123! |
| 普通队员             | 20260002 | Demo123! |
| 另一名学生           | 20260003 | Demo123! |
| 摄影与创新竞赛负责人 | 20240001 | Demo123! |
| 合唱团负责人         | 20240002 | Demo123! |
| 管理员               | admin    | Demo123! |

登录弹窗可直接填入演示账号。管理员顶部可恢复模拟数据，管理页可推进模拟时间。上述账号只能用于隔离的课程演示环境。

## v0.5 本地邮件验证

已增加校邮注册、密码恢复、身份状态、补核验与换绑、管理员身份冲突处理，以及按用户 ID 关联的团队权限。学校认证接口仍为预留，当前不可用；新校邮域名的学号映射仍待官方资料。

```powershell
./scripts/start-local-mail.ps1
```

该脚本保留原演示库，使用独立的 `campus_v05_local` 数据库与附件目录；首次从官方发布下载并校验 Mailpit。网站为 http://127.0.0.1:8085/ ，测试收件箱为 http://127.0.0.1:8025/ 。MySQL、Node、JDK要求与下文一致。

测试邮箱可使用一个未占用的数字学号加 `@stu.neu.edu.cn`。验证码只进入本地 Mailpit，不会送往学校邮箱；页面与账号标记为本地测试身份。纯浏览器模拟版则在注册弹窗中提供“模拟收件箱”入口。上述两种结果都不算真实校邮认证。

```powershell
npm.cmd run test:identity
$env:CAMPUS_TEST_BASE_URL='http://127.0.0.1:8085'
$env:CAMPUS_REPORT_FILE='artifacts/v05-server-browser-results.json'
npx.cmd playwright test --config playwright.server.config.ts
```

接口检查固定使用本机独立库和 Mailpit。过期与重发边界通过该库的时间夹具验证，不改变服务器时钟。最新结果与未验证项见 [v0.5实现与测试记录](docs/v0.5实现与测试记录.md)。

正式模式默认关闭邮件服务，使用独立数据库且不载入演示用户或业务数据。首次建立管理员须通过进程环境配置 `CAMPUS_BOOTSTRAP_ADMIN_PASSWORD`，不提供默认管理员密码。真实发件另需 `CAMPUS_MAIL_ENABLED=true`、SMTP身份、TLS与至少32字符的 `CAMPUS_OTP_SECRET`。Java读取的是进程环境，不自动读取Vite的`.env`文件。学校认证接入另行实施，不随SMTP配置启用。

## 启动后端验证版

环境：JDK 21+、MySQL 8.4，Windows辅助脚本使用PowerShell 7。源码以Java 21编译，本机运行环境为JDK 25。Maven Wrapper会下载固定的Maven发行版。

```powershell
./scripts/package-server.ps1
./scripts/start-backend.ps1 -SkipBuild
```

打开 http://127.0.0.1:8080/ 。打包时使用 `.env.server`，不启用模拟接口。

开发时也可先启动后端，再运行 `npm.cmd run dev:server`；Vite通过代理访问8080。

本机脚本默认使用已安装的 `C:/Program Files/MySQL/MySQL Server 8.4`，为项目创建独立数据目录、账号与3307端口，不修改已有MySQL84实例。其他机器需调整 `scripts/local-db.ps1` 的工具安装路径，或自行通过 `CAMPUS_DB_URL`、`CAMPUS_DB_USER`、`CAMPUS_DB_PASSWORD` 配置数据库。

`backend/data/local-db.json` 只在本机保存随机数据库凭据并限制文件权限，已列入忽略规则。数据库、附件、备份、JAR和本机下载的工具都不应提交。课程种子账号由 `CAMPUS_DEMO=true` 显式启用；启动脚本仅为课程演示设置此开关。

后端采用单进程部署、提交后缓存读取与MySQL事务锁定写入。各业务集合独立保存为JSON正文表，成员占用另设关系唯一键。详细实现边界见 [业务规则](docs/业务规则.md)，不能将其当成已上线的生产系统。

## 演示步骤

1. 学生在摄影活动中报名，填写自我介绍与年级；在“我的报名”看到初审中。
2. 负责人工作台先保存初审草稿，确认草稿没有推进状态；再正式确认通过，进入面试。
3. 学生选择面试时段；负责人可以查看预约人数并完成面试审核。
4. 管理员将模拟时间推进到11月11日；负责人勾选待录取记录并发布结果；学生查看录取和站内信。
5. 切换到竞赛板块，以队长和队员演示团队报名、退出、补人及重审。外部报名竞赛只展示官方指引。
6. 管理员演示负责人申请审批、目录导入及错误明细、活动下架、学期配置和归档预览。

真实后端不允许调整服务器时间。验证截止场景时可由负责人把测试活动截止时间调整到过去；已接真实接口的测试脚本使用独立测试活动。

## 检查命令与证据

```powershell
npm.cmd run build
npm.cmd run test:rules
npm.cmd run test:e2e
npm.cmd run test:server
./backend/mvnw.cmd -f backend/pom.xml test
```

浏览器测试使用本机Chrome、Edge与375像素视口，不自动安装浏览器。截图与机器可读结果在 `artifacts/`。接口测试会写入模拟记录并归档自己的测试活动。压测入口为 `scripts/load-test.js`；当k6发行包下载不可用时，另提供明确标注工具名称的 `scripts/load-fallback.mjs`，不把替代程序结果标成k6结果。

核对 [需求追踪表](docs/需求追踪表.md)、[OpenAPI](docs/openapi.json)、[验收记录](docs/验收记录.md)。51条功能需求映射并不表示每条均已完成全部人工验收；未验证项目必须保留在验收记录中。

## 备份与恢复

停止后端可执行 `./scripts/stop-backend.ps1`，其会校验JAR完整路径；停止独立数据库用 `./scripts/local-db.ps1 stop`。需要清空Java版测试记录时，先备份，再执行 `node scripts/demo-reset.mjs`，该工具仅适用于显式开启课程演示的环境。

```powershell
./scripts/backup.ps1
./scripts/install-backup-task.ps1
# 停止本项目Java后端后，再恢复一份备份
./scripts/restore.ps1 -BackupDirectory '完整备份目录'
./scripts/start-backend.ps1 -SkipBuild
```

每日任务为 `CampusPlatform-v04-LocalBackup`，保留最近七份备份。数据库必须可连接，任务执行时用户环境与工具路径须有效。恢复保留最新归档清理记录；后端初始化时重新清理旧备份中的已归档个人数据，再允许业务请求。实际演练结果见验收记录。

## 协作

2026年10月29日按逐项核对清单补充了审核/结果历史、活动状态、批量审核、人数统计、上传校验及脱敏排查日志。实现与测试范围见 [补充实现与复核记录](docs/补充实现与复核记录-2026-10-29.md)，问题编号见 [缺陷台账](docs/缺陷台账.md)。`docs/验收场景.json`保存51项具体用例；涉及时间的场景在模拟模式推进时间，真实接口使用独立测试活动调整起止日期，不修改服务器时钟。新增真实接口检查可用`BASE_URL`指定独立测试后端后运行`node scripts/verify-history.mjs`，会创建并归档自己的测试活动。

团队分工和模型任务输入见 [AI协作任务单](docs/AI协作任务单.md)。引入来源与许可证见 [第三方来源](docs/第三方来源.md) 及 `docs/THIRD_PARTY_NOTICES.txt`。模型密钥不进入前端、仓库或模拟数据。

## 服务器演示部署

Linux 部署配置、HTTPS、服务管理和每日备份说明见 [部署说明](deploy/linux/README.md)。线上使用独立 MySQL 数据库，供组员共享演示记录；公开模拟账号只用于课程操作演示。

## 前端改版

首页采用侧栏筛选与活动列表，平台名称、导航和页面标题按功能命名。公开参考网站、截图与采用范围见[前端参考与改版](docs/前端参考与改版.md)。历史演示文案仅在仍保持默认值时迁移，自定义公告和报名记录保留。
