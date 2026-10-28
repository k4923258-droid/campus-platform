import type { State } from './types'
export const legacyDemoCopy: Record<string, { title: string; body: string }> = {
  'photo-fall': {
    title: '用镜头，记录校园的另一面',
    body: '## 光影摄影协会 · 秋季招新\n\n在校园漫步，用影像表达。无论你用手机还是相机，都欢迎加入。\n\n### 我们一起做什么\n- 校园摄影与作品分享\n- 摄影基础工作坊\n- 每月一次的城市采风\n\n报名后依次进行初审、作品交流与面试。',
  },
  'choir-fall': {
    title: '让你的声音，成为和声的一部分',
    body: '## 校园合唱团秋季招新\n\n喜欢音乐就来试试。无需专业基础，统一在报名截止后开始审核。',
  },
  'innovation-team': {
    title: '创新实践挑战赛 · 寻找解决问题的人',
    body: '## 从一个想法，到一个作品\n\n以2—4人团队参加校园创新实践挑战赛。队长代表团队提交材料、选择面试时间。\n\n本页面及账号均为课程演示数据。',
  },
  'math-external': {
    title: '数学建模竞赛 · 参赛信息与报名指引',
    body: '## 了解数学建模\n\n在真实问题中应用数学。报名时间、资格与费用以官方通知为准。平台仅提供信息指引，不代收报名材料。',
  },
}
export function migrateDemoCopy(saved: State, defaults: State) {
  for (const current of saved.activities) {
    const old = legacyDemoCopy[current.id]
    const updated = defaults.activities.find((a) => a.id === current.id)
    if (!old || !updated) continue
    if (current.title === old.title) current.title = updated.title
    if (current.body === old.body) current.body = updated.body
  }
}
