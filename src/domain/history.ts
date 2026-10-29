import type { Activity, Application, State } from './types'

export function applicationRevision(r: Application) {
  const { versions: _versions, statusEvents: _events, history: _history, ...value } = r
  return structuredClone(value)
}
export function captureApplications(
  s: State,
  before: Application[],
  actorId: string,
  action: string,
) {
  const at = new Date(s.now || Date.now()).toISOString()
  for (const r of s.applications) {
    const old = before.find((v) => v.id === r.id)
    if (old && old.version !== r.version)
      r.versions = [...(old.versions || []), applicationRevision(old)]
    if (!old || old.status !== r.status || old.version !== r.version) {
      r.statusEvents = [
        ...(old?.statusEvents || []),
        { at, actorId, action, version: r.version, from: old?.status || '', to: r.status },
      ]
      r.updatedAt = at
    }
  }
}
export function fileReferences(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('file:') ? [value.slice(5)] : []
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(fileReferences)
}
export function applicationFiles(r: Application, a: Activity, history = true): string[] {
  const fields = a.fields.filter((f) => f.type === 'file')
  const records = [r, ...(history ? r.versions || [] : [])]
  return records.flatMap((v) => fields.flatMap((f) => fileReferences(v.answers[f.id])))
}
export function posterHistoryFiles(a: Activity): string[] {
  return (a.changeHistory || []).flatMap((v) => fileReferences(v.changes.poster))
}
export function reviewCounts(a: Activity, rows: Application[], stage: string) {
  const relevant = rows.filter(
    (r) =>
      r.status !== 'withdrawn' &&
      (r.status === stage || r.reviews.some((v) => v.stage === stage && v.committed)),
  )
  const weight = (r: Application) => (a.team ? r.memberNos.length : 1)
  return {
    total: relevant.reduce((n, r) => n + weight(r), 0),
    pending: relevant.filter((r) => r.status === stage).reduce((n, r) => n + weight(r), 0),
    passed: relevant
      .filter((r) => r.reviews.some((v) => v.stage === stage && v.committed && v.passed))
      .reduce((n, r) => n + weight(r), 0),
    failed: relevant
      .filter((r) => r.reviews.some((v) => v.stage === stage && v.committed && !v.passed))
      .reduce((n, r) => n + weight(r), 0),
    teams: relevant.length,
  }
}
export function isRegistered(rows: Application[], activityId: string, studentNo?: string) {
  return (
    !!studentNo &&
    rows.some(
      (r) =>
        r.activityId === activityId && r.status !== 'withdrawn' && r.memberNos.includes(studentNo),
    )
  )
}
export function slotFull(
  slot: { id: string; capacity: number; booked?: number },
  ownSlot?: string,
) {
  return ownSlot !== slot.id && (slot.booked || 0) >= slot.capacity
}
