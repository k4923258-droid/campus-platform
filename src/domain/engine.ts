import { captureApplications, applicationFiles, posterHistoryFiles } from './history'
import { activityStatus } from './types'
import { hashPassword } from './seed'
import {
  stageLabels,
  type Activity,
  type Application,
  type State,
  type User,
  type Snapshot,
} from './types'
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message)
  }
}
export function ensure(ok: unknown, text: string, status = 422): asserts ok {
  if (!ok) throw new DomainError(text, status)
}
const uid = () => crypto.randomUUID()
export const clock = (s: State) => new Date(s.now || Date.now())
const stamp = (s: State) => clock(s).toISOString()
export const isAdmin = (u?: User) => !!u?.roles.includes('admin')
export const manages = (u: User | undefined, a: Activity) =>
  isAdmin(u) || !!u?.orgIds.includes(a.orgId)
const members = (s: State, r: Application) =>
  s.users.filter((u) => r.memberNos.includes(u.studentNo))
function notify(s: State, ids: string[], text: string, activityId?: string) {
  ids.forEach((userId) =>
    s.notices.unshift({ id: uid(), userId, text, activityId, read: false, at: stamp(s) }),
  )
}
function appNotice(s: State, r: Application, text: string) {
  notify(
    s,
    members(s, r).map((u) => u.id),
    text,
    r.activityId,
  )
}
function log(s: State, u: User, action: string, detail = '', activityId?: string) {
  s.audits.unshift({ id: uid(), actorId: u.id, action, detail, activityId, at: stamp(s) })
}
export function advance(s: State, a: Activity, r: Application) {
  if (a.team && r.memberNos.length < a.minTeam) {
    r.status = 'waiting'
    return
  }
  while (r.stageIndex < a.stages.length) {
    const stage = a.stages[r.stageIndex]!
    if (!stage.enabled || stage.automatic) {
      if (stage.enabled) {
        r.reviews.push({
          at: stamp(s),
          actorId: 'system',
          stage: stage.key,
          version: r.version,
          passed: true,
          note: '默认通过',
          committed: true,
        })
        r.history.push(`${stamp(s)} ${stageLabels[stage.key]}默认通过`)
        appNotice(s, r, `${a.title}：${stageLabels[stage.key]}默认通过。`)
      }
      r.stageIndex++
      continue
    }
    r.status = stage.key
    return
  }
  r.status = 'eligible'
}
export function tick(s: State) {
  const before = structuredClone(s.applications)
  for (const a of s.activities) {
    if (!a.published || a.archived || a.removed || a.closedAt || a.resultPublished) continue
    for (const r of s.applications.filter(
      (r) => r.activityId === a.id && r.status !== 'withdrawn',
    )) {
      if (
        a.team &&
        r.memberNos.length < a.minTeam &&
        clock(s) >= new Date(a.end) &&
        !['admitted', 'unselected', 'rejected'].includes(r.status)
      ) {
        r.status = 'rejected'
        r.slotId = undefined
        r.history.push(`${stamp(s)} 截止时团队人数不足`)
        appNotice(s, r, `${a.title}：截止时团队人数不足，未通过。`)
      } else if (r.status === 'waiting' && (a.rolling || clock(s) >= new Date(a.end)))
        advance(s, a, r)
    }
  }
  for (const a of s.activities) {
    if (!a.closedAt || a.archived) continue
    const semester = s.semesters
      .filter((t) => new Date(t.start) > new Date(a.closedAt!))
      .sort((x, y) => x.start.localeCompare(y.start))[0]
    if (
      semester &&
      clock(s).getTime() >= new Date(semester.end + 'T23:59:59+08:00').getTime() + 1000
    )
      archive(s, a)
  }
  captureApplications(s, before, 'system', 'tick')
}
export function snapshot(s: State, userId?: string): Snapshot {
  const u = s.users.find((u) => u.id === userId)
  const joined = new Set(
    s.applications.filter((r) => u && r.memberNos.includes(u.studentNo)).map((r) => r.activityId),
  )
  const activities = s.activities.filter(
    (a) => manages(u, a) || joined.has(a.id) || (a.published && !a.removed && !a.archived),
  )
  const applications = s.applications.filter((r) => {
    const a = s.activities.find((a) => a.id === r.activityId)!
    return manages(u, a) || (!!u && r.memberNos.includes(u.studentNo))
  })
  const relevantIds = new Set([
    u?.id,
    ...applications.flatMap((r) => [r.captainId, ...members(s, r).map((m) => m.id)]),
    ...(isAdmin(u) ? s.users.map((u) => u.id) : []),
  ])
  const readableFiles = new Set<string>()
  applications.forEach((r) =>
    applicationFiles(
      r,
      s.activities.find((a) => a.id === r.activityId)!,
      manages(
        u,
        s.activities.find((a) => a.id === r.activityId)!,
      ),
    ).forEach((id) => readableFiles.add(id)),
  )
  activities.forEach((a) => {
    if (a.poster.startsWith('file:')) readableFiles.add(a.poster.slice(5))
  })
  const publicUser = ({ passwordHash: _password, ...rest }: User) => rest
  return {
    ...structuredClone(s),
    users: s.users.filter((v) => relevantIds.has(v.id)).map(publicUser),
    me: u ? publicUser(u) : undefined,
    activities: structuredClone(activities).map((a) => {
      a.lifecycleStatus = activityStatus(a, clock(s), s.applications)
      if (!manages(u, a)) {
        delete a.resultHistory
        delete a.changeHistory
      }
      return a
    }),
    applications: structuredClone(applications).map((r) => {
      if (
        !manages(
          u,
          s.activities.find((a) => a.id === r.activityId)!,
        )
      ) {
        r.reviews = r.reviews.filter((v) => v.committed)
        delete r.versions
      }
      return r
    }),
    organizations: structuredClone(s.organizations),
    slots: s.slots.filter((v) => activities.some((a) => a.id === v.activityId)),
    grants: s.grants.filter((v) => isAdmin(u) || v.userId === u?.id),
    notices: s.notices.filter((v) => v.userId === u?.id),
    audits: s.audits.filter(
      (v) =>
        isAdmin(u) ||
        (v.activityId && activities.some((a) => a.id === v.activityId && manages(u, a))),
    ),
    attachments: s.attachments
      .filter((f) => f.ownerId === u?.id || readableFiles.has(f.id))
      .map(({ data: _data, ...f }) => f),
  }
}
function verifyFields(s: State, a: Activity, answers: Record<string, unknown>, u: User) {
  for (const f of a.fields) {
    const value = answers[f.id]
    ensure(
      !f.required ||
        (value !== undefined &&
          value !== null &&
          value !== '' &&
          (!Array.isArray(value) || value.length)),
      `请填写${f.label}`,
    )
    if (value === undefined || value === '' || value === null) continue
    if (f.type === 'number')
      ensure(typeof value === 'number' && Number.isFinite(value), `${f.label}必须是数字`)
    if (f.type === 'radio') ensure(f.options.includes(String(value)), `${f.label}选项无效`)
    if (f.type === 'checkbox')
      ensure(
        Array.isArray(value) && value.every((v) => f.options.includes(v)),
        `${f.label}选项无效`,
      )
    if (f.type === 'date')
      ensure(
        /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Number.isFinite(Date.parse(String(value))),
        `${f.label}日期无效`,
      )
    if (f.type === 'file')
      ensure(
        s.attachments.some((v) => 'file:' + v.id === value && v.ownerId === u.id),
        `${f.label}文件无效，请重新上传`,
      )
    ensure(JSON.stringify(value).length < 100000, `${f.label}内容过长`)
  }
}
function writable(s: State, a: Activity) {
  ensure(!a.archived && !a.closedAt && !a.removed, '活动已结项、归档或下架，无法操作', 409)
}
function within(s: State, a: Activity) {
  writable(s, a)
  ensure(a.published && !a.external && !a.resultPublished, '活动未开放报名', 409)
  ensure(clock(s) >= new Date(a.start) && clock(s) < new Date(a.end), '当前不在报名时间内', 409)
}
function current(s: State, p: any) {
  const r = s.applications.find((v) => v.id === p.id)
  ensure(r, '报名不存在', 404)
  const a = s.activities.find((v) => v.id === r.activityId)!
  return { r, a }
}
function manage(u: User, a: Activity) {
  ensure(manages(u, a), '没有该组织的管理权限', 403)
}
function captain(u: User, r: Application) {
  ensure(r.captainId === u.id, '仅队长或本人可执行此操作', 403)
}
export async function execute(
  s: State,
  userId: string | undefined,
  action: string,
  p: any = {},
): Promise<unknown> {
  tick(s)
  if (action === 'register') {
    ensure(
      /^\d{6,20}$/.test(p.studentNo) && String(p.name).trim() && String(p.password).length >= 8,
      '请填写姓名、6—20位学号及至少8位密码',
    )
    ensure(!s.users.some((u) => u.studentNo === p.studentNo), '该学号已注册', 409)
    const u: User = {
      id: uid(),
      name: p.name.trim(),
      studentNo: p.studentNo,
      passwordHash: await hashPassword(p.password),
      roles: ['student'],
      orgIds: [],
    }
    s.users.push(u)
    log(s, u, '注册')
    return { id: u.id }
  }
  const u = s.users.find((v) => v.id === userId)
  ensure(u, '请先登录', 401)
  const beforeApplications = structuredClone(s.applications)
  const beforeActivities = structuredClone(s.activities)
  let activityId: string | undefined
  switch (action) {
    case 'activity.save': {
      const old = s.activities.find((v) => v.id === p.id)
      const org = s.organizations.find((v) => v.id === p.orgId && v.enabled)
      ensure(org, '请选择启用的组织')
      ensure(isAdmin(u) || u.orgIds.includes(org.id), '没有该组织的管理权限', 403)
      if (old) {
        manage(u, old)
        writable(s, old)
      }
      ensure(
        p.title?.trim() &&
          Number.isFinite(Date.parse(p.start)) &&
          Number.isFinite(Date.parse(p.end)) &&
          Date.parse(p.start) < Date.parse(p.end),
        '请填写标题及正确的报名起止时间',
      )
      ensure(!p.external || p.externalGuide?.trim(), '关闭平台报名时须提供外部报名指引')
      ensure(
        !p.team ||
          (Number.isInteger(p.minTeam) &&
            p.minTeam >= 2 &&
            Number.isInteger(p.maxTeam) &&
            p.maxTeam >= p.minTeam),
        '团队人数范围无效',
      )
      ensure(
        Array.isArray(p.fields) && new Set(p.fields.map((v: any) => v.id)).size === p.fields.length,
        '字段编号须唯一',
      )
      for (const f of p.fields)
        ensure(
          f.id &&
            f.label?.trim() &&
            ['text', 'textarea', 'number', 'radio', 'checkbox', 'date', 'file'].includes(f.type) &&
            (!['radio', 'checkbox'].includes(f.type) || f.options?.length),
          '字段名称、类型或选项不完整',
        )
      ensure(
        p.stages?.length === 3 &&
          p.stages.every(
            (v: any, i: number) =>
              v.key === ['initial', 'written', 'interview'][i] &&
              ['pass', 'score'].includes(v.mode) &&
              Number.isInteger(v.threshold) &&
              v.threshold >= 0 &&
              v.threshold <= 100,
          ),
        '审核顺序或合格线无效',
      )
      const locked = old && s.applications.some((r) => r.activityId === old.id)
      if (locked)
        for (const k of [
          'orgId',
          'external',
          'team',
          'minTeam',
          'maxTeam',
          'fields',
          'stages',
          'rolling',
        ])
          ensure(
            JSON.stringify((old as any)[k]) === JSON.stringify(p[k]),
            '已有报名，不能修改报名方式、表单或审核规则',
            409,
          )
      if (p.poster)
        ensure(
          s.attachments.some(
            (f) =>
              'file:' + f.id === p.poster &&
              (f.ownerId === u.id || old?.poster === p.poster) &&
              f.mime.startsWith('image/'),
          ),
          '海报必须是本人上传的图片',
        )
      const allowed = [
        'orgId',
        'title',
        'body',
        'poster',
        'start',
        'end',
        'published',
        'external',
        'externalGuide',
        'team',
        'minTeam',
        'maxTeam',
        'rolling',
        'fields',
        'stages',
        'softGrade',
        'softMaterial',
      ]
      const value = Object.fromEntries(allowed.map((k) => [k, p[k]]))
      const a = {
        ...old,
        ...value,
        id: old?.id || uid(),
        removed: old?.removed || false,
        resultPublished: old?.resultPublished || false,
        resultVersion: old?.resultVersion || 0,
      } as Activity
      if (a.published && !a.publishedAt) a.publishedAt = stamp(s)
      if (old) s.activities[s.activities.indexOf(old)] = a
      else s.activities.push(a)
      if (locked)
        notify(
          s,
          [
            ...new Set(
              s.applications
                .filter((r) => r.activityId === a.id)
                .flatMap((r) => members(s, r).map((v) => v.id)),
            ),
          ],
          `${a.title}：公告或截止时间已更新，请查看。`,
          a.id,
        )
      activityId = a.id
      break
    }
    case 'application.save': {
      const a = s.activities.find((v) => v.id === p.activityId)
      ensure(a, '活动不存在', 404)
      within(s, a)
      ensure(u.roles.includes('student'), '需要学生身份', 403)
      const old = p.id
        ? s.applications.find((v) => v.id === p.id && v.activityId === a.id)
        : undefined
      if (p.id) ensure(old, '报名不存在', 404)
      if (old) {
        captain(u, old)
        ensure(old.status !== 'withdrawn', '请重新报名', 409)
        ensure(p.version === old.version, '报名已更新，请刷新后重试', 409)
      }
      const memberNos = a.team
        ? [
            u.studentNo,
            ...(p.memberNos || [])
              .map((v: string) => v.trim())
              .filter((v: string) => v && v !== u.studentNo),
          ]
        : [u.studentNo]
      ensure(
        new Set(memberNos).size === memberNos.length &&
          memberNos.every((v: string) => /^\d{6,20}$/.test(v)),
        '队员学号重复或格式不正确',
      )
      ensure(
        !a.team || (memberNos.length >= a.minTeam && memberNos.length <= a.maxTeam),
        `团队须有${a.minTeam}—${a.maxTeam}人（含队长）`,
      )
      ensure(
        !s.applications.some(
          (r) =>
            r.id !== old?.id &&
            r.activityId === a.id &&
            r.status !== 'withdrawn' &&
            memberNos.some((n: string) => r.memberNos.includes(n)),
        ),
        '学生已在本活动报名或属于其他团队',
        409,
      )
      verifyFields(s, a, p.answers || {}, u)
      const warnings: string[] = []
      const gradeKey =
        a.fields.find((f) => f.id === 'grade' || f.label.trim() === '年级')?.id || 'grade'
      if (a.softGrade && !a.softGrade.split(/[,，]/).includes(String(p.answers?.[gradeKey])))
        warnings.push('年级与建议条件不一致')
      const material = p.answers?.[a.softMaterial]
      if (
        a.softMaterial &&
        (material === undefined ||
          material === null ||
          material === '' ||
          (Array.isArray(material) && !material.length))
      )
        warnings.push('建议补充材料')
      ensure(
        !warnings.length || p.confirmSoft,
        warnings.join('；') + '。如仍要提交，请确认软提示。',
      )
      const r: Application = {
        id: old?.id || uid(),
        activityId: a.id,
        captainId: u.id,
        memberNos,
        answers: p.answers,
        version: (old?.version || 0) + 1,
        stageIndex: 0,
        status: 'waiting',
        reviews: [],
        createdAt: old?.createdAt || stamp(s),
        updatedAt: stamp(s),
        history: [...(old?.history || []), `${stamp(s)} ${old ? '修改并重新审核' : '提交报名'}`],
      }
      if (old) s.applications[s.applications.indexOf(old)] = r
      else s.applications.push(r)
      if (a.rolling) advance(s, a, r)
      appNotice(
        s,
        r,
        `${a.title}：${old ? '报名已修改，原审核结论失效并重新审核' : '报名成功'}（v${r.version}）。`,
      )
      activityId = a.id
      break
    }
    case 'application.withdraw':
    case 'application.exit': {
      const { a, r } = current(s, p)
      within(s, a)
      if (action.endsWith('withdraw')) {
        captain(u, r)
        r.status = 'withdrawn'
        appNotice(s, r, `${a.title}：报名已撤回。`)
      } else {
        ensure(r.captainId !== u.id && r.memberNos.includes(u.studentNo), '仅非队长成员可退出', 403)
        ensure(r.status !== 'withdrawn', '报名已撤回', 409)
        r.memberNos = r.memberNos.filter((n) => n !== u.studentNo)
        notify(s, [u.id], `${a.title}：你已退出团队。`, a.id)
        appNotice(s, r, `${u.name}退出团队，请队长核对人数并补齐。`)
        r.version++
        r.reviews = []
        r.stageIndex = 0
        r.status = 'waiting'
        if (a.rolling) advance(s, a, r)
      }
      r.slotId = undefined
      r.updatedAt = stamp(s)
      r.history.push(`${stamp(s)} ${action}`)
      activityId = a.id
      break
    }
    case 'review.save': {
      const { a, r } = current(s, p)
      manage(u, a)
      writable(s, a)
      ensure(p.version === r.version, '报名已更新，请刷新', 409)
      ensure(!a.team || r.memberNos.length >= a.minTeam, '团队人数不足，补齐后才能继续', 409)
      const stage = a.stages[r.stageIndex]
      ensure(stage && r.status === stage.key, '当前没有可审核的环节', 409)
      ensure(!p.stage || p.stage === stage.key, '环节已变更，请刷新', 409)
      if (stage.mode === 'score')
        ensure(Number.isInteger(p.score) && p.score >= 0 && p.score <= 100, '分数须为0—100整数')
      const passed = stage.mode === 'score' ? p.score >= stage.threshold : !!p.passed
      r.reviews = r.reviews.filter(
        (v) => !(v.stage === stage.key && v.version === r.version && !v.committed),
      )
      r.reviews.push({
        actorId: u.id,
        at: stamp(s),
        stage: stage.key,
        version: r.version,
        score: stage.mode === 'score' ? p.score : undefined,
        passed,
        note: p.note || '',
        committed: !!p.commit,
      })
      if (p.commit) {
        if (passed) {
          r.stageIndex++
          advance(s, a, r)
        } else {
          r.status = 'rejected'
          r.slotId = undefined
        }
        r.history.push(`${stamp(s)} ${stageLabels[stage.key]}${passed ? '通过' : '未通过'}`)
        appNotice(s, r, `${a.title}：${stageLabels[stage.key]}${passed ? '通过' : '未通过'}。`)
      }
      r.updatedAt = stamp(s)
      activityId = a.id
      break
    }
    case 'slot.save': {
      const a = s.activities.find((v) => v.id === p.activityId)
      ensure(a, '活动不存在', 404)
      manage(u, a)
      writable(s, a)
      ensure(
        Date.parse(p.start) < Date.parse(p.end) &&
          p.place?.trim() &&
          Number.isInteger(p.capacity) &&
          p.capacity > 0,
        '请填写正确的时间、地点和容量',
      )
      const old = s.slots.find((v) => v.id === p.id)
      if (old) ensure(old.activityId === a.id, '时段不属于此活动', 403)
      const affected = s.applications.filter((r) => r.slotId === old?.id && old)
      ensure(!affected.length || p.reason?.trim(), '已有预约，变更或取消须填写原因')
      affected.forEach((r) => {
        r.slotId = undefined
        appNotice(s, r, `${a.title}：原面试安排已变更，请重选。原因：${p.reason}`)
      })
      const slot = {
        id: old?.id || uid(),
        activityId: a.id,
        start: p.start,
        end: p.end,
        place: p.place,
        capacity: p.capacity,
        cancelled: !!p.cancelled,
      }
      if (old) s.slots[s.slots.indexOf(old)] = slot
      else s.slots.push(slot)
      activityId = a.id
      break
    }
    case 'slot.book': {
      const { a, r } = current(s, p)
      captain(u, r)
      writable(s, a)
      ensure(r.status === 'interview', '仅面试中的报名可选时段', 409)
      ensure(!a.team || r.memberNos.length >= a.minTeam, '团队人数不足', 409)
      const slot = s.slots.find((v) => v.id === p.slotId && v.activityId === a.id && !v.cancelled)
      ensure(slot, '时段不存在或已取消', 404)
      ensure(clock(s) < new Date(slot.start), '该时段已开始', 409)
      const old = s.slots.find((v) => v.id === r.slotId)
      ensure(!old || clock(s) < new Date(old.start), '原时段已开始，不可改选', 409)
      ensure(
        s.applications.filter((v) => v.id !== r.id && v.slotId === slot.id).length < slot.capacity,
        '时段已满，请选择其他时段',
        409,
      )
      r.slotId = slot.id
      r.updatedAt = stamp(s)
      appNotice(s, r, `${a.title}：已预约 ${slot.start}，${slot.place}。`)
      activityId = a.id
      break
    }
    case 'result.publish':
    case 'result.withdraw': {
      const a = s.activities.find((v) => v.id === p.activityId)
      ensure(a, '活动不存在', 404)
      manage(u, a)
      writable(s, a)
      if (action.endsWith('withdraw')) {
        ensure(a.resultPublished, '尚未发布结果', 409)
        ensure(p.reason?.trim(), '撤回结果须填写原因')
        const publication = a.resultHistory?.find((v) => v.version === a.resultVersion)
        if (publication)
          Object.assign(publication, { withdrawnAt: stamp(s), withdrawnBy: u.id, reason: p.reason })
        a.resultPublished = false
        s.applications
          .filter((r) => r.activityId === a.id && ['admitted', 'unselected'].includes(r.status))
          .forEach((r) => {
            r.status = 'eligible'
            appNotice(s, r, `${a.title}：结果已撤回更正。原因：${p.reason}`)
          })
      } else {
        ensure(!a.resultPublished, '结果已发布，请先撤回', 409)
        ensure(clock(s) >= new Date(a.end), '请在报名截止后发布结果', 409)
        const rows = s.applications.filter(
          (r) => r.activityId === a.id && !['withdrawn', 'rejected'].includes(r.status),
        )
        ensure(
          rows.every((r) => r.status === 'eligible'),
          '还有未完成的审核',
          409,
        )
        ensure(
          (p.admittedIds || []).every((id: string) => rows.some((r) => r.id === id)),
          '录取名单包含无效记录',
        )
        rows.forEach((r) => {
          r.status = p.admittedIds.includes(r.id) ? 'admitted' : 'unselected'
          appNotice(
            s,
            r,
            `${a.title}：结果已发布，${r.status === 'admitted' ? '已录取' : '未录取'}。`,
          )
        })
        a.resultPublished = true
        a.resultVersion++
        a.resultHistory = [
          ...(a.resultHistory || []),
          {
            version: a.resultVersion,
            at: stamp(s),
            actorId: u.id,
            admittedIds: rows.filter((r) => r.status === 'admitted').map((r) => r.id),
            unselectedIds: rows.filter((r) => r.status === 'unselected').map((r) => r.id),
          },
        ]
      }
      activityId = a.id
      break
    }
    case 'notice.send': {
      const a = s.activities.find((v) => v.id === p.activityId)
      ensure(a, '活动不存在', 404)
      manage(u, a)
      writable(s, a)
      ensure(p.text?.trim(), '请输入通知内容')
      const rows = s.applications.filter(
        (r) =>
          r.activityId === a.id && r.status !== 'withdrawn' && (!p.status || r.status === p.status),
      )
      notify(s, [...new Set(rows.flatMap((r) => members(s, r).map((v) => v.id)))], p.text, a.id)
      activityId = a.id
      break
    }
    case 'notice.read': {
      const n = s.notices.find((v) => v.id === p.id && v.userId === u.id)
      ensure(n, '通知不存在', 404)
      n.read = true
      break
    }
    case 'grant.apply': {
      ensure(u.roles.includes('student'), '需要学生身份', 403)
      ensure(
        s.organizations.some((v) => v.id === p.orgId && v.enabled) && p.reason?.trim(),
        '请选择组织并填写理由',
      )
      ensure(
        !u.orgIds.includes(p.orgId) &&
          !s.grants.some((v) => v.userId === u.id && v.orgId === p.orgId && v.status === 'pending'),
        '已授权或存在待处理申请',
        409,
      )
      s.grants.push({
        id: uid(),
        userId: u.id,
        orgId: p.orgId,
        reason: p.reason,
        status: 'pending',
      })
      break
    }
    case 'grant.decide': {
      ensure(isAdmin(u), '需要管理员权限', 403)
      const g = s.grants.find((v) => v.id === p.id)
      ensure(g && g.status === 'pending', '申请不存在或已处理', 409)
      ensure(p.approved || p.reason?.trim(), '驳回须填写理由')
      g.status = p.approved ? 'approved' : 'rejected'
      g.decision = p.reason || ''
      const applicant = s.users.find((v) => v.id === g.userId)!
      if (p.approved) {
        applicant.orgIds = [...new Set([...applicant.orgIds, g.orgId])]
        if (!applicant.roles.includes('manager')) applicant.roles.push('manager')
      }
      notify(s, [g.userId], `负责人申请${p.approved ? '已通过' : '被驳回：' + p.reason}`)
      break
    }
    case 'organization.save': {
      ensure(isAdmin(u), '需要管理员权限', 403)
      ensure(
        p.name?.trim() &&
          ['club', 'contest'].includes(p.kind) &&
          p.campus?.trim() &&
          Number.isInteger(p.stars) &&
          p.stars >= 1 &&
          p.stars <= (p.kind === 'club' ? 5 : 7),
        '目录名称、校区或星级无效',
      )
      ensure(
        !s.organizations.some(
          (v) => v.id !== p.id && v.kind === p.kind && v.name === p.name.trim(),
        ),
        '目录名称重复',
        409,
      )
      const old = s.organizations.find((v) => v.id === p.id)
      const org = {
        id: old?.id || uid(),
        name: p.name.trim(),
        kind: p.kind,
        campus: p.campus,
        stars: p.stars,
        enabled: p.enabled !== false,
      }
      if (old) s.organizations[s.organizations.indexOf(old)] = org
      else s.organizations.push(org)
      break
    }
    case 'activity.remove': {
      ensure(isAdmin(u), '需要管理员权限', 403)
      const a = s.activities.find((v) => v.id === p.activityId)
      ensure(a && !a.archived, '活动不存在或已归档', 404)
      ensure(p.reason?.trim(), '下架须填写原因')
      a.removed = true
      notify(
        s,
        s.users.filter((v) => v.orgIds.includes(a.orgId)).map((v) => v.id),
        `${a.title}已下架：${p.reason}`,
        a.id,
      )
      activityId = a.id
      break
    }
    case 'activity.close': {
      const a = s.activities.find((v) => v.id === p.activityId)
      ensure(a, '活动不存在', 404)
      manage(u, a)
      ensure(!a.archived && !a.closedAt, '活动已结项或归档', 409)
      ensure(a.resultPublished || a.external || a.removed, '请先完成结果发布', 409)
      a.closedAt = stamp(s)
      activityId = a.id
      break
    }
    case 'activity.archive': {
      ensure(isAdmin(u), '需要管理员权限', 403)
      const a = s.activities.find((v) => v.id === p.activityId)
      ensure(a?.closedAt && !a.archived, '活动需先结项且未归档', 409)
      ensure(p.confirm === a.title, '请完整输入活动标题以确认不可恢复的归档')
      archive(s, a)
      activityId = a.id
      break
    }
    case 'semester.save': {
      ensure(isAdmin(u), '需要管理员权限', 403)
      ensure(p.name && Date.parse(p.start) < Date.parse(p.end), '学期名称或日期不正确')
      ensure(
        !s.semesters.some(
          (v) =>
            v.id !== p.id &&
            Date.parse(p.start) <= Date.parse(v.end) &&
            Date.parse(p.end) >= Date.parse(v.start),
        ),
        '学期日期不能重叠',
      )
      const old = s.semesters.find((v) => v.id === p.id)
      const semester = { id: old?.id || uid(), name: p.name, start: p.start, end: p.end }
      if (old) s.semesters[s.semesters.indexOf(old)] = semester
      else s.semesters.push(semester)
      break
    }
    case 'demo.time':
      ensure(Number.isFinite(Date.parse(p.now)), '时间无效')
      ensure(isAdmin(u), '需要管理员权限', 403)
      s.now = new Date(p.now).toISOString()
      tick(s)
      break
    default:
      throw new DomainError('未知操作', 404)
  }
  captureApplications(s, beforeApplications, u.id, action)
  const a = s.activities.find((v) => v.id === activityId)
  const oldActivity = beforeActivities.find((v) => v.id === activityId)
  if (action === 'activity.save' && a && oldActivity) {
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    for (const key of ['title', 'body', 'poster', 'start', 'end'] as const)
      if (a[key] !== oldActivity[key]) changes[key] = { before: oldActivity[key], after: a[key] }
    if (Object.keys(changes).length)
      a.changeHistory = [...(a.changeHistory || []), { at: stamp(s), actorId: u.id, changes }]
  }
  log(
    s,
    u,
    action,
    ['activity.archive'].includes(action) ? '仅保留汇总' : p.reason || '',
    activityId,
  )
  const audit = s.audits[0]!
  if (action === 'review.save') {
    const before = beforeApplications.find((r) => r.id === p.id)!
    const after = s.applications.find((r) => r.id === p.id)!
    const conclusion = after.reviews.find(
      (v) => v.stage === before.status && v.version === after.version,
    )
    audit.context = {
      applicationId: p.id,
      version: after.version,
      stage: before.status,
      beforeStatus: before.status,
      afterStatus: after.status,
      ...conclusion,
    }
    audit.detail = JSON.stringify(audit.context)
  } else if (
    action === 'activity.save' &&
    a &&
    (a.changeHistory?.length || 0) > (oldActivity?.changeHistory?.length || 0)
  ) {
    audit.context = { changes: a.changeHistory![a.changeHistory!.length - 1]!.changes }
    audit.detail = JSON.stringify(audit.context)
  }
  tick(s)
  return { ok: true }
}
export function archive(s: State, a: Activity) {
  const rows = s.applications.filter((r) => r.activityId === a.id)
  a.summary = {
    total: rows.length,
    admitted: rows.filter((r) => r.status === 'admitted').length,
    failed: rows.filter((r) => ['rejected', 'unselected'].includes(r.status)).length,
  }
  const deletedFiles = new Set([
    ...rows.flatMap((r) => applicationFiles(r, a)),
    ...posterHistoryFiles(a),
  ])
  s.applications = s.applications.filter((r) => r.activityId !== a.id)
  s.slots = s.slots.filter((v) => v.activityId !== a.id)
  s.notices = s.notices.filter((v) => v.activityId !== a.id)
  s.audits = s.audits.filter((v) => v.activityId !== a.id)
  a.resultHistory = []
  a.changeHistory = []
  const stillUsed = new Set([
    ...s.applications.flatMap((r) =>
      applicationFiles(
        r,
        s.activities.find((a) => a.id === r.activityId)!,
      ),
    ),
    ...s.activities.flatMap(posterHistoryFiles),
  ])
  s.attachments = s.attachments.filter(
    (f) =>
      !deletedFiles.has(f.id) ||
      stillUsed.has(f.id) ||
      s.activities.some((v) => v.poster === 'file:' + f.id),
  )
  a.archived = true
}
