export type Role = 'student' | 'manager' | 'admin'
export type StageKey = 'initial' | 'written' | 'interview'
export type FieldType = 'text' | 'textarea' | 'number' | 'radio' | 'checkbox' | 'date' | 'file'
export interface User {
  id: string
  name: string
  studentNo: string
  passwordHash: string
  roles: Role[]
  orgIds: string[]
}
export interface Organization {
  id: string
  name: string
  kind: 'club' | 'contest'
  campus: string
  stars: number
  enabled: boolean
}
export interface FormField {
  id: string
  label: string
  type: FieldType
  required: boolean
  options: string[]
}
export interface Stage {
  key: StageKey
  enabled: boolean
  automatic: boolean
  mode: 'pass' | 'score'
  threshold: number
}
export interface Activity {
  lifecycleStatus?: string
  changeHistory?: {
    at: string
    actorId: string
    changes: Record<string, { before: unknown; after: unknown }>
  }[]
  resultHistory?: {
    version: number
    at: string
    actorId: string
    admittedIds: string[]
    unselectedIds: string[]
    withdrawnAt?: string
    withdrawnBy?: string
    reason?: string
  }[]
  publishedAt?: string
  id: string
  orgId: string
  title: string
  body: string
  poster: string
  start: string
  end: string
  published: boolean
  removed: boolean
  external: boolean
  externalGuide: string
  team: boolean
  minTeam: number
  maxTeam: number
  rolling: boolean
  fields: FormField[]
  stages: Stage[]
  softGrade: string
  softMaterial: string
  resultPublished: boolean
  resultVersion: number
  closedAt?: string
  archived?: boolean
  summary?: { total: number; admitted: number; failed: number }
}
export interface Review {
  actorId?: string
  at?: string
  stage: StageKey
  version: number
  score?: number
  passed: boolean
  note: string
  committed: boolean
}
export interface Application {
  versions?: Omit<Application, 'versions' | 'statusEvents' | 'history'>[]
  statusEvents?: {
    at: string
    actorId: string
    action: string
    version: number
    from: string
    to: string
  }[]
  id: string
  activityId: string
  captainId: string
  memberNos: string[]
  answers: Record<string, unknown>
  version: number
  stageIndex: number
  status: string
  reviews: Review[]
  slotId?: string
  createdAt: string
  updatedAt: string
  history: string[]
}
export interface Slot {
  id: string
  activityId: string
  start: string
  end: string
  place: string
  capacity: number
  cancelled: boolean
}
export interface Notice {
  id: string
  userId: string
  activityId?: string
  text: string
  read: boolean
  at: string
}
export interface GrantRequest {
  id: string
  userId: string
  orgId: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  decision?: string
}
export interface Audit {
  context?: Record<string, unknown>
  id: string
  actorId: string
  action: string
  activityId?: string
  at: string
  detail: string
}
export interface Attachment {
  id: string
  ownerId: string
  name: string
  size: number
  mime: string
  data: string
}
export interface Semester {
  id: string
  name: string
  start: string
  end: string
}
export interface State {
  schema: number
  now?: string
  users: User[]
  organizations: Organization[]
  activities: Activity[]
  applications: Application[]
  slots: Slot[]
  notices: Notice[]
  grants: GrantRequest[]
  audits: Audit[]
  attachments: Attachment[]
  semesters: Semester[]
}
export type PublicUser = Omit<User, 'passwordHash'>
export interface Snapshot extends Omit<State, 'users' | 'attachments'> {
  users: PublicUser[]
  me?: PublicUser
  attachments: Omit<Attachment, 'data'>[]
}
export const stageLabels: Record<StageKey, string> = {
  initial: '初审',
  written: '笔试',
  interview: '面试',
}
export const statusLabels: Record<string, string> = {
  waiting: '待审核',
  initial: '初审中',
  written: '笔试中',
  interview: '面试中',
  eligible: '待录取',
  admitted: '已录取',
  rejected: '未通过',
  unselected: '未录取',
  withdrawn: '已撤回',
}
export function activityStatus(a: Activity, now = new Date(), applications?: Application[]) {
  if (a.archived) return '已归档'
  if (a.removed) return '已下架'
  if (!a.published) return '草稿'
  if (a.closedAt || a.resultPublished) return '已结束'
  if (now < new Date(a.start)) return '待开始'
  if (now < new Date(a.end)) return '报名中'
  if (applications && !a.external) {
    const rows = applications.filter((r) => r.activityId === a.id && r.status !== 'withdrawn')
    if (rows.some((r) => ['waiting', 'initial', 'written', 'interview'].includes(r.status)))
      return '审核中'
    if (rows.length) return '待发布结果'
  }
  if (!applications && ['审核中', '待发布结果'].includes(a.lifecycleStatus || ''))
    return a.lifecycleStatus!
  return '已截止'
}
export function defaultStages(): Stage[] {
  return (['initial', 'written', 'interview'] as StageKey[]).map((key) => ({
    key,
    enabled: true,
    automatic: false,
    mode: 'pass',
    threshold: 60,
  }))
}
