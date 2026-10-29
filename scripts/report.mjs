import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const read = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''))
const load = read('artifacts/load-results.json'),
  submission = read('artifacts/submission-load.json'),
  backup = read('artifacts/backup-checks.json'),
  recovery = read('artifacts/recovery-timing.json'),
  restore = read('artifacts/restore-results.json'),
  browser = read('artifacts/playwright-results.json'),
  serverBrowser = read('artifacts/server-browser-results.json'),
  api = read('artifacts/server-checks.json')
const unit = read('artifacts/unit-results.json'),
  historyApi = read('artifacts/history-server-checks.json')
const javaTests = fs
  .readdirSync(path.join(root, 'backend/target/surefire-reports'))
  .filter((f) => /^TEST-.*\.xml$/.test(f))
  .reduce((sum, f) => {
    const xml = fs.readFileSync(path.join(root, 'backend/target/surefire-reports', f), 'utf8')
    const header = xml.match(/<testsuite\s[^>]+>/)?.[0] || ''
    return sum + Number(header.match(/tests="(\d+)"/)?.[1] || 0)
  }, 0)
const checks = [
  [
    'REQ-N-001',
    '已按本机样例测量',
    `1000虚拟用户、600秒，${load.requests}次公开读取；错误率${load.errorRate}，P95 ${load.p95Milliseconds.toFixed(2)}ms。工具为Node HTTP替代程序，不是k6。`,
  ],
  [
    'REQ-N-002',
    '部分验证',
    `10并发100次同一报名重试，P95 ${submission.p95Milliseconds.toFixed(2)}ms，只保留1条；200/409分别表示成功/重复。没有以1000名独立学生同时提交新报名。`,
  ],
  [
    'REQ-N-003',
    '实现并部分验证',
    '客户端与服务端20MB限制、MIME与实际字节校验已实现，真实PDF与伪造PNG已检查；上传前20MB/20MB+1、扩展名与MIME已有单元测试；所有真实文件格式边界尚未逐项测试。',
  ],
  ['REQ-N-010', '部分验证', '本机Chrome156、Edge156与375px检查已执行；前一个大版本尚未验证。'],
  [
    'REQ-N-011',
    '待真实用户验证',
    '目前只有自动化和制作方检查，没有真实学生或负责人的首次使用研究。',
  ],
  [
    'REQ-N-012',
    '实现并部分检查',
    '使用原生/Element Plus控件、显式标签、焦点样式和海报替代文本；已检查桌面/窄屏截图，完整键盘与无障碍审计待完成。',
  ],
  [
    'REQ-N-020',
    '核心场景通过',
    '真实接口拒绝跨组织审核和未授权附件读取；角色/所属组织由服务端校验。',
  ],
  [
    'REQ-N-021',
    '实现并检查',
    'Java密码使用BCrypt，模拟版使用SHA-256保存演示密码摘要；30分钟会话、退出失效和登录审计已实现。',
  ],
  [
    'REQ-N-022',
    '实现并部分验证',
    'Markdown禁用HTML并净化；数据库参数绑定，文件按内容检测，外链有跳转提示。未进行完整渗透测试。',
  ],
  [
    'REQ-N-030',
    '核心场景通过',
    '游客、其他学生、跨组织负责人及未授权附件读取检查已通过；学生投影隐藏评分草稿。',
  ],
  [
    'REQ-N-031',
    '归档及恢复演练通过',
    '归档删除报名、相关通知、审计敏感内容与附件；从归档前备份恢复后未复活。旧备份在七份保留期内可能仍含历史数据，未宣称物理介质立即不可恢复。',
  ],
  [
    'REQ-N-032',
    '实现并检查',
    '接口不返回密码，异常日志只记请求编号、匿名用户标识、模块和异常类型，不记录请求体或文件正文。管理员与负责人可导出掩码手机号、邮箱及证件号的排查日志；单元与浏览器下载检查通过。',
  ],
  [
    'REQ-N-040',
    '核心并发场景通过',
    '真实MySQL并发重复报名和最后一个预约名额争抢通过；数据库写锁和成员唯一键生效。',
  ],
  [
    'REQ-N-041',
    backup.lastTaskResult === 0 && restore.passed ? '配置与单次演练通过' : '待修复',
    `每日02:00任务实际触发退出码${backup.lastTaskResult}；保留${backup.validBackups}份。演练RTO ${recovery.rtoSeconds.toFixed(2)}秒、RPO ${recovery.rpoSeconds.toFixed(2)}秒。未观察连续多日运行；机器和数据库需要可用。`,
  ],
  [
    'REQ-N-042',
    '已实现，故障场景待补',
    '关键异常响应有请求编号，服务端异常日志使用匿名用户标识；尚未开展数据库断连、磁盘满等故障注入。',
  ],
  [
    'REQ-N-050',
    '可操作，部分自动化验证',
    '表单、时机、环节、评分、团队人数及面试配置均有界面；已验证草稿、结构锁定及自定义年级字段。复杂组合待组员逐项复核。',
  ],
  [
    'REQ-N-051',
    '已实现，待完整人工验收',
    '目录与活动独立保存，停用目录不删除历史活动；目录导入有逐行校验与错误明细。',
  ],
  [
    'REQ-N-052',
    '核心自动化通过',
    '前端规则/表格、Java规则、浏览器主线与真实接口都有测试；数据库采用独立JSON正文表加约束表，单Java进程部署。',
  ],
  [
    'REQ-N-060',
    '场景已建档，人工验收未全部完成',
    '45条功能需求已补具体输入、步骤、预期及实际执行字段，生成器保留执行记录；完整人工验收待完成。',
  ],
  [
    'REQ-N-061',
    '追踪已建立',
    'REQ、UC、TC及DEF稳定编号已关联；缺陷台账记录12项处理结果。原Word保留，补充规则单独记录。',
  ],
]
fs.writeFileSync(
  path.join(root, 'docs/非功能验收.md'),
  '# 非功能需求验收\n\n|编号|状态|证据与限制|\n|---|---|---|\n' +
    checks.map((r) => '|' + r.join('|') + '|').join('\n') +
    '\n',
)
const summary = `# v0.4 实现与验收记录

记录日期：2026年10月29日。补充实现见docs/补充实现与复核记录-2026-10-29.md。性能与恢复数据仍为2026年10月28日历史测量，本次未重测。原始需求Word未修改；交互版和Java/MySQL版源码均在本仓库。45条功能需求的实现映射见需求追踪表，20条非功能需求的逐项状态见非功能验收。

## 已执行检查

|检查|实际结果|证据|
|---|---|---|
|Vue/TypeScript构建|通过|npm run build / scripts/package-server.ps1|
|前端规则、表格与文案迁移|${unit.numPassedTests}项通过，失败${unit.numFailedTests}项|artifacts/unit-results.json|
|Java业务规则|${javaTests}项通过|backend/target/surefire-reports|
|交互版Chrome、Edge、375px|${browser.stats.expected}项通过，失败${browser.stats.unexpected}项|artifacts/playwright-results.json|
|同源Java版Chrome、Edge、375px（10月28日历史记录）|${serverBrowser.stats.expected}项通过，失败${serverBrowser.stats.unexpected}项|artifacts/server-browser-results.json|
|真实HTTP/数据库接口|${api.checks.filter((c) => c.passed).length}项通过|artifacts/server-checks.json|
|新增历史/审计真实接口|${historyApi.checks.filter((c) => c.passed).length}项通过|artifacts/history-server-checks.json|
|依赖安全审计（10月28日历史记录）|最终npm审计0项已知漏洞|package-lock.json；不是完整安全审计|
|每日备份任务与保留|任务实际执行返回${backup.lastTaskResult}，保留${backup.validBackups}份|artifacts/backup-checks.json|
|归档前备份恢复|${restore.passed ? '通过' : '未通过'}，个人报名、附件和通知未复活|artifacts/restore-results.json|

## 性能与恢复实测（2026年10月28日历史结果）

单机Windows，${load.cpu}，内存约32GB，Node ${load.node}、Java25.0.2、MySQL8.4.9。服务端与压测端运行在同一台机器。公开读取使用提交后的内存投影，数据为少量演示活动；这些结果不能直接推断大量真实数据下的性能。

1000个虚拟用户持续600秒，每次读取后等待1秒，峰值在途请求${load.peakInflight}，共${load.requests}次请求，错误${load.errors}次，P95 ${load.p95Milliseconds.toFixed(2)}ms，最大${load.maxMilliseconds.toFixed(2)}ms。k6发行包因TLS连接中断未能取得，本次使用scripts/load-fallback.mjs执行，原k6脚本保留在scripts/load-test.js。未将替代结果写成k6结果。

在该查询负载下，另用10并发发起100次同一报名重试，P95 ${submission.p95Milliseconds.toFixed(2)}ms，1次成功、99次重复冲突，数据库只保留一条。没有测量1000名独立学生同时提交新报名的吞吐。

恢复演练从停止服务前记时，到恢复、启动、清理并验证完成，耗时${recovery.rtoSeconds.toFixed(2)}秒；使用的备份与演练开始相差${recovery.rpoSeconds.toFixed(2)}秒。已验证七份保留和每日任务配置，尚未观察连续多日运行。

## 尚待完成的人工与环境检查

- 45条功能场景已经建档，但未冒充全部逐条人工验收通过；组员仍需认领并复核复杂表单、导入异常、批量操作及完整配置组合。
- 只检查本机Chrome156、Edge156与375px视口，尚未检查前一个大版本；未开展完整键盘/无障碍审计及数据库断连、磁盘满等故障注入。
- 文件类型与大小的实现和部分真实请求已检查；所有格式及20MB两侧边界仍需补齐。
- 没有真实学生、负责人试用，不能写成完成用户验证。五人组的责任认领与同行复核仍需实际成员执行。
- 后端使用单进程、JSON正文业务表和全局写事务锁，适合当前课程验证；写入扩展性未据本次公开查询压测证明。

## 版本与运行

接口契约在docs/openapi.json；本次补充规则在docs/业务规则.md。Java可执行JAR由scripts/package-server.ps1生成，默认交互版仍可通过npm run dev独立启动。数据库凭据、文件、备份与工具下载不纳入版本控制。制作过程中发现的备份参数错误已修正，项目数据库凭据已轮换。
`
fs.writeFileSync(
  path.join(root, 'docs/验收记录.md'),
  summary.replaceAll('src/domain/__tests__', '`src/domain/__tests__`'),
)
console.log('已生成验收记录及20条非功能需求状态，保留未验收项。')
