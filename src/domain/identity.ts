import type { PublicUser, State, User, Application } from './types'

export function verified(u?: Partial<User>): boolean {
  return (
    !!u &&
    u.accountStatus === 'active' &&
    u.bindingStatus === 'bound' &&
    !!u.emailVerifiedAt &&
    ['demo', 'local-mail', 'campus-email', 'school'].includes(u.identitySource || '')
  )
}
export function businessUser(u?: Partial<User>): boolean {
  return (
    verified(u) ||
    !!(
      u?.accountStatus === 'active' &&
      u.identitySource === 'bootstrap' &&
      u.roles?.includes('admin')
    )
  )
}
export function compatible(a: User, b: User): boolean {
  const formal = ['campus-email', 'school']
  return (
    verified(a) &&
    verified(b) &&
    (a.identitySource === b.identitySource ||
      (formal.includes(a.identitySource || '') && formal.includes(b.identitySource || '')))
  )
}
export function linked(r: Application, userId?: string): boolean {
  return !!userId && !!r.memberUserIds?.includes(userId)
}
export function publicUser(u: User, own = false): PublicUser {
  const {
    id,
    name,
    studentNo,
    roles,
    orgIds,
    accountStatus,
    bindingStatus,
    identitySource,
    emailVerifiedAt,
  } = u
  return {
    id,
    name,
    studentNo,
    roles: [...roles],
    orgIds: [...orgIds],
    accountStatus,
    bindingStatus,
    identitySource,
    emailVerifiedAt,
    ...(own && u.email ? { maskedEmail: u.email.replace(/^(.).*(@.*)$/, '$1***$2') } : {}),
  }
}
// Only the isolated demo upgrade may associate existing demo members. Formal data is never inferred from a number.
export function initializeDemoIdentity(s: State) {
  s.identityMode = 'demo'
  s.users.forEach((u) => {
    u.accountStatus ??= 'active'
    u.bindingStatus ??= 'bound'
    u.identitySource ??= 'demo'
    u.emailVerifiedAt ??= '2026-10-28T00:00:00Z'
    u.sessionVersion ??= 0
    u.email ??= `${u.studentNo}@stu.neu.edu.cn`
  })
  s.applications.forEach((r) => {
    r.memberUserIds ??= s.users
      .filter((u) => r.memberNos.includes(u.studentNo) && verified(u))
      .map((u) => u.id)
  })
}
