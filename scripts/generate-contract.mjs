import { acceptanceCases } from './acceptance-cases.mjs'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const S = { type: 'string' },
  B = { type: 'boolean' },
  I = { type: 'integer' },
  strings = { type: 'array', items: S }
const object = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const field = object(
  {
    id: S,
    label: S,
    type: { enum: ['text', 'textarea', 'number', 'radio', 'checkbox', 'date', 'file'] },
    required: B,
    options: strings,
  },
  ['id', 'label', 'type', 'required', 'options'],
)
const stage = object(
  {
    key: { enum: ['initial', 'written', 'interview'] },
    enabled: B,
    automatic: B,
    mode: { enum: ['pass', 'score'] },
    threshold: { type: 'integer', minimum: 0, maximum: 100 },
  },
  ['key', 'enabled', 'automatic', 'mode', 'threshold'],
)
const activity = object(
  {
    id: S,
    orgId: S,
    title: S,
    body: S,
    poster: S,
    start: { type: 'string', format: 'date-time' },
    end: { type: 'string', format: 'date-time' },
    published: B,
    external: B,
    externalGuide: S,
    team: B,
    minTeam: I,
    maxTeam: I,
    rolling: B,
    fields: { type: 'array', items: field },
    stages: { type: 'array', minItems: 3, maxItems: 3, items: stage },
    softGrade: S,
    softMaterial: S,
  },
  [
    'orgId',
    'title',
    'body',
    'start',
    'end',
    'published',
    'external',
    'team',
    'minTeam',
    'maxTeam',
    'rolling',
    'fields',
    'stages',
  ],
)
// Read-only metadata may accompany activity.save when the UI edits an existing activity.
for (const [k, v] of Object.entries({
  publishedAt: S,
  removed: B,
  resultPublished: B,
  resultVersion: I,
  closedAt: S,
  archived: B,
  summary: { type: 'object' },
  lifecycleStatus: S,
  changeHistory: { type: 'array', items: { type: 'object' } },
  resultHistory: { type: 'array', items: { type: 'object' } },
}))
  activity.properties[k] = { ...v, readOnly: true }
const schemas = {
  register: object(
    { studentNo: S, name: S, password: { type: 'string', minLength: 8, maxLength: 128 } },
    ['studentNo', 'name', 'password'],
  ),
  'activity.save': activity,
  'application.save': object(
    {
      id: S,
      activityId: S,
      version: I,
      answers: { type: 'object', additionalProperties: true },
      memberNos: {
        ...strings,
        deprecated: true,
        description: '兼容输入；服务端只解析已核验账号，不作访问授权依据',
      },
      memberUserIds: strings,
      confirmSoft: B,
    },
    ['activityId', 'answers'],
  ),
  'application.withdraw': object({ id: S }, ['id']),
  'application.exit': object({ id: S }, ['id']),
  'review.save': object(
    {
      id: S,
      version: I,
      stage: S,
      score: { type: 'integer', minimum: 0, maximum: 100 },
      passed: B,
      note: S,
      commit: B,
    },
    ['id', 'version', 'commit'],
  ),
  'slot.save': object(
    {
      id: S,
      activityId: S,
      start: S,
      end: S,
      place: S,
      capacity: { type: 'integer', minimum: 1 },
      cancelled: B,
      reason: S,
      booked: I,
    },
    ['activityId', 'start', 'end', 'place', 'capacity'],
  ),
  'slot.book': object({ id: S, slotId: S }, ['id', 'slotId']),
  'result.publish': object({ activityId: S, admittedIds: strings }, ['activityId', 'admittedIds']),
  'result.withdraw': object({ activityId: S, reason: S }, ['activityId', 'reason']),
  'notice.send': object({ activityId: S, status: S, text: S }, ['activityId', 'text']),
  'notice.read': object({ id: S }, ['id']),
  'grant.apply': object({ orgId: S, reason: S }, ['orgId', 'reason']),
  'grant.decide': object({ id: S, approved: B, reason: S }, ['id', 'approved']),
  'organization.save': object(
    {
      id: S,
      name: S,
      kind: { enum: ['club', 'contest'] },
      campus: S,
      stars: { type: 'integer', minimum: 1, maximum: 7 },
      enabled: B,
    },
    ['name', 'kind', 'campus', 'stars'],
  ),
  'activity.remove': object({ activityId: S, reason: S }, ['activityId', 'reason']),
  'activity.close': object({ activityId: S }, ['activityId']),
  'activity.archive': object({ activityId: S, confirm: S }, ['activityId', 'confirm']),
  'semester.save': object({ id: S, name: S, start: S, end: S }, ['name', 'start', 'end']),
  'demo.time': object({ now: S }, ['now']),
}
const response = {
  200: { description: '成功；只返回当前角色与组织允许读取的数据' },
  401: { description: '未登录或会话失效' },
  403: { description: '没有权限或CSRF验证失败' },
  404: { description: '记录或操作不存在' },
  409: { description: '版本、状态、唯一性或容量冲突' },
  422: { description: '业务参数校验失败' },
  429: { description: '限流或验证码重发间隔未满足' },
  503: { description: '初始化、维护中或身份服务未配置' },
}
const paths = {
  '/snapshot': {
    get: { summary: '按角色与所属组织返回业务投影；不返回密码或附件二进制', responses: response },
  },
  '/csrf': {
    get: {
      summary: '领取CSRF Cookie和令牌，写操作携带X-XSRF-TOKEN',
      responses: { 200: { description: 'CSRF token' } },
    },
  },
  '/session': {
    post: {
      summary: '登录；服务器使用HttpOnly JSESSIONID，模拟模式返回30分钟token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: object({ studentNo: S, password: S }, ['studentNo', 'password']),
          },
        },
      },
      responses: response,
    },
    delete: { summary: '退出并使当前会话失效', responses: response },
  },
  '/files': {
    post: {
      summary: '上传20MB以内图片/PDF/ZIP；服务端校验扩展名、声明MIME、实际内容与字节数',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: object(
              {
                name: S,
                mime: S,
                size: { type: 'integer', minimum: 1, maximum: 20971520 },
                data: { type: 'string', description: 'base64 data URL' },
              },
              ['name', 'mime', 'size', 'data'],
            ),
          },
        },
      },
      responses: response,
    },
  },
  '/files/{id}': {
    get: {
      summary: '受权限保护的文件下载',
      parameters: [{ name: 'id', in: 'path', required: true, schema: S }],
      responses: response,
    },
  },
  '/demo/reset': {
    post: {
      summary: '仅管理员且服务器显式启用课程演示时可恢复种子数据；归档清理记录不撤销',
      responses: response,
    },
  },
  '/health': {
    get: { summary: '服务状态', responses: { 200: { description: 'up或maintenance' } } },
  },
}
for (const [action, schema] of Object.entries(schemas))
  paths['/commands/' + action] = {
    post: {
      summary: action === 'demo.time' ? '仅浏览器模拟模式的时间推进' : action,
      requestBody: { required: true, content: { 'application/json': { schema } } },
      responses: response,
    },
  }
// v0.5 identity operations share the same cookie and CSRF contract as business writes.
const identityBody = (summary, schema) => ({
  summary,
  requestBody: { required: true, content: { 'application/json': { schema } } },
  responses: response,
})
const credentials = object(
  {
    challengeId: S,
    code: { type: 'string', pattern: '^[0-9]{6}$' },
    email: S,
    password: { type: 'string', minLength: 8, maxLength: 128 },
    name: S,
  },
  ['challengeId', 'code', 'password'],
)
paths['/session'].get = { summary: '查询会话及本人身份状态；无登录时me为null', responses: response }
paths['/auth/providers'] = {
  get: { summary: '可用认证方式、身份环境与邮箱域名；学校认证当前不可用', responses: response },
}
paths['/auth/email/challenges'] = {
  post: identityBody(
    '申请验证码：6位、5分钟、最多失败5次、重发60秒；不返回验证码',
    object(
      {
        email: S,
        purpose: { enum: ['register', 'password-reset', 'bind', 'email-change'] },
        password: S,
      },
      ['email', 'purpose'],
    ),
  ),
}
paths['/auth/register'] = {
  post: identityBody('核验校邮及可信映射后注册普通账号；待映射/冲突不激活', {
    ...credentials,
    required: ['challengeId', 'code', 'password', 'name'],
  }),
}
paths['/auth/password/reset'] = { post: identityBody('恢复密码并撤销全部既有会话', credentials) }
paths['/auth/identity/bind'] = {
  post: identityBody('已登录旧账号补核验，需当前密码，不自动授予历史管理权限', credentials),
}
paths['/auth/email/change'] = {
  post: identityBody('当前密码、新邮箱核验及原邮箱安全通知', credentials),
}
for (const route of ['/auth/login/neu', '/auth/callback/neu'])
  paths[route] = {
    get: { summary: '学校统一认证预留，当前返回503且不建立学校认证会话', responses: response },
  }
paths['/activities/{activityId}/team-members/resolve'] = {
  post: {
    ...identityBody(
      '按完整学号解析可加入的已核验用户，只返回必要字段',
      object({ studentNo: S }, ['studentNo']),
    ),
    parameters: [{ name: 'activityId', in: 'path', required: true, schema: S }],
  },
}
paths['/auth/identity-conflicts'] = {
  get: { summary: '管理员查看身份冲突申请', responses: response },
}
paths['/auth/identity-conflicts/{id}/resolve'] = {
  post: {
    ...identityBody(
      '管理员依据凭据处理身份冲突，明确报名迁移范围，原管理权限不转移',
      object({ reason: { type: 'string', minLength: 10 }, transferApplicationIds: strings }, [
        'reason',
      ]),
    ),
    parameters: [{ name: 'id', in: 'path', required: true, schema: S }],
  },
}
paths['/commands/register'].post = {
  deprecated: true,
  summary: '已关闭的旧注册入口，固定拒绝免验证建号',
  responses: { 403: { description: '请通过校园邮箱核验注册' } },
}
fs.writeFileSync(
  path.join(root, 'docs/openapi.json'),
  JSON.stringify(
    {
      openapi: '3.1.0',
      info: {
        title: '校园社团与竞赛平台接口',
        version: '0.5.0',
        description:
          '命令接口按业务操作命名；模拟版与Java版共用相同路径。服务端权限由业务层校验，前端按钮隐藏不构成授权。',
      },
      servers: [{ url: '/api/v1' }],
      paths,
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'JSESSIONID' } },
      },
    },
    null,
    2,
  ),
)
const groups = [
  [
    [1, 2, 3, 4, 5],
    '发现/详情',
    'UC-01',
    'GET snapshot',
    [
      '游客可浏览两个板块',
      '校区、星级、状态组合筛选',
      '关键词、发布时间/截止时间排序与分页',
      '详情展示公告、组织、海报、时间及报名指引',
      '到截止时间后新报名被拒绝',
    ],
  ],
  [
    [10, 11, 12, 13],
    '登录/个人中心/管理端',
    'UC-06',
    'session / grant.*',
    [
      '模拟注册登录后可报名',
      '跨组织与普通成员修改被拒绝',
      '学生选择组织并提交申请理由',
      '通过授予组织权限；驳回须理由且通知',
    ],
  ],
  [
    [20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
    '负责人活动配置',
    'UC-02',
    'activity.save',
    [
      '授权组织下创建草稿并发布',
      'Markdown、海报及有效起止时间',
      '七类字段可排序、必填与20MB限制',
      '软提示确认后仍可提交',
      '固定环节启用、停用与默认通过',
      '统一/滚动模式按时间触发',
      '草稿不流转，确认后锁定；分数边界正确',
      '关闭通道后展示外部链接或文字指引',
      '2—4人竞赛团队可由队长提交',
      '首条报名后结构锁定，公告变更有通知',
    ],
  ],
  [
    [30, 31, 32, 33, 34, 35],
    '报名表/我的报名',
    'UC-01',
    'application.*',
    [
      '表单、通道、时间及附件校验',
      '单人/队长/队员学号不重复占用',
      '修改递增版本并重审；仅队长编辑',
      '撤回整队/普通队员退出释放占用',
      '查看版本、当前环节和提交/更新时间',
      '重复点击与并发重试只保留一条',
    ],
  ],
  [
    [40, 41, 42, 43, 44],
    '负责人审核工作台',
    'UC-03',
    'review.save',
    [
      '按首个启用环节触发并跳过停用项',
      '查看最新表单及附件，保存评分草稿',
      '通过进入下一环节，不通过终止，全自动待录取',
      '同环节批量处理并留痕',
      '各环节待处理、通过和未通过数量正确',
    ],
  ],
  [
    [50, 51, 52, 53],
    '时段配置/我的报名',
    'UC-04',
    'slot.*',
    [
      '跨天时间、地点和容量配置',
      '仅面试状态队长预约，一队一名额；争抢最后名额无超额',
      '改选成功释放原名额，失败保留原预约',
      '已有预约的时段变更需原因且通知重新选择',
    ],
  ],
  [
    [60, 61, 62, 63, 64],
    '录取结果/站内信',
    'UC-05',
    'result.* / notice.*',
    [
      '待录取记录发布后未选中者标为未录取',
      '结果立即生效，不要求确认，可被多社团录取',
      '没有候补；撤回需理由，重新发布留痕',
      '提交、重审、环节、预约及录取均通知',
      '按活动/环节批量通知，已读状态可更新',
    ],
  ],
  [
    [80, 81, 82],
    '平台管理',
    'UC-06',
    'organization.save / activity.remove / snapshot',
    [
      '目录新增、修改、停用及导入逐行错误明细',
      '下架需原因，公开页隐藏并通知负责人',
      '全局数量包含归档汇总且不暴露个人',
    ],
  ],
  [
    [90, 91, 92],
    '全部页面/领域模型',
    'UC-01～06',
    'snapshot / commands',
    [
      '活动状态满足时间和管理条件',
      '报名状态与审核结果可追溯',
      '用户、组织、授权、报名、团队、环节、时段、结果、通知和审计均分开维护',
    ],
  ],
]
groups.push([
  [100, 101, 102, 103, 104, 105],
  '登录注册 / 账号核验 / 身份冲突管理',
  'UC-07～09、UC-14',
  '/auth/* / session',
  [
    '未配置学校认证返回不可用，不建立学校认证会话',
    '校邮白名单、6位验证码、用途、过期重放和限流',
    '可信映射与唯一约束后创建普通账号，旧入口拒绝',
    '明确邮箱验证、学号绑定、身份来源与账号状态',
    '冲突经管理员核验，明确迁移范围，不继承管理权限',
    '已绑定邮箱恢复密码并撤销全部会话，换绑须重新认证',
  ],
])
const rows = []
for (const [ids, page, uc, api, scenarios] of groups)
  ids.forEach((id, i) =>
    rows.push({
      id: 'REQ-F-' + String(id).padStart(3, '0'),
      uc: id <= 5 ? 'UC-10' : id === 13 ? 'UC-11' : id === 80 ? 'UC-12' : id === 81 ? 'UC-13' : uc,
      page,
      api,
      test: 'TC-F-' + String(id).padStart(3, '0'),
      scenario: scenarios[i],
    }),
  )
if (rows.length !== 51) throw Error('需求数量错误')
const head = '|需求|用例|页面|接口|检查编号|预期结果|验证状态|\n|---|---|---|---|---|---|---|\n'
const body = rows
  .map(
    (r) =>
      `|${r.id}|${r.uc}|${r.page}|${r.api}|${r.test}|${r.scenario}|见补充实现与复核记录；逐项人工执行结果见验收场景.json|`,
  )
  .join('\n')
fs.writeFileSync(
  path.join(root, 'docs/需求追踪表.md'),
  '# v0.5 功能需求追踪\n\n共51条。用例图编号覆盖UC-01～UC-14；实际身份、MySQL并发与浏览器结果见《v0.5实现与测试记录》。页面可交互不等于通过全部验收。\n\n' +
    head +
    body +
    '\n',
)
const casesPath = path.join(root, 'docs/验收场景.json')
const previousCases = fs.existsSync(casesPath) ? JSON.parse(fs.readFileSync(casesPath, 'utf8')) : []
fs.writeFileSync(
  casesPath,
  JSON.stringify(
    acceptanceCases(
      rows.map((r) => ({ 编号: r.test, 需求: r.id, 用例: r.uc })),
      previousCases,
    ),
    null,
    2,
  ),
)
console.log('已生成 v0.5 OpenAPI、51条需求追踪映射；保留既有验收结果。')
