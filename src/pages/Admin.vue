<script setup lang="ts">
import { downloadRedacted } from '@/domain/redact'
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { readTable, writeTable } from '@/api/spreadsheet'
import { usePlatform } from '@/stores/platform'
import { activityStatus } from '@/domain/types'
import { mockMode } from '@/api/client'
const s = usePlatform()
const grantStatus: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
}
const tab = ref('grants')
const orgOpen = ref(false)
const org = ref<any>({})
const semesterOpen = ref(false)
const semester = ref<any>({})
const errors = ref<string[]>([])
const time = ref('2026-11-11T10:00:00+08:00')
const importing = ref(false)
const totals = computed(() => ({
  activities: s.data?.activities.length,
  applications:
    s.data!.applications.length +
    s.data!.activities.reduce((sum, a) => sum + (a.summary?.total || 0), 0),
  admitted:
    s.data!.applications.filter((r) => r.status === 'admitted').length +
    s.data!.activities.reduce((sum, a) => sum + (a.summary?.admitted || 0), 0),
}))
async function act(action: string, p: any) {
  try {
    await s.act(action, p)
    ElMessage.success('操作成功')
    return true
  } catch (e) {
    ElMessage.error((e as Error).message)
    return false
  }
}
async function decide(id: string, approved: boolean) {
  let reason = ''
  if (!approved) {
    try {
      reason = (
        await ElMessageBox.prompt('请输入驳回理由', '负责人审批', {
          inputValidator: (v) => !!v?.trim() || '理由不能为空',
        })
      ).value
    } catch {
      return
    }
  }
  await act('grant.decide', { id, approved, reason })
}
function editOrg(value?: any) {
  org.value = value
    ? { ...value }
    : { name: '', kind: 'club', campus: '南湖', stars: 3, enabled: true }
  orgOpen.value = true
}
async function remove(id: string) {
  try {
    const { value } = await ElMessageBox.prompt('下架原因将发送给所属负责人', '下架活动', {
      inputValidator: (v) => !!v?.trim() || '原因不能为空',
    })
    await act('activity.remove', { activityId: id, reason: value })
  } catch {}
}
async function archive(a: any) {
  try {
    const count = s.data!.applications.filter((r) => r.activityId === a.id).length
    const { value } = await ElMessageBox.prompt(
      `将删除 ${count} 条个人报名、相关通知、审计敏感内容和附件，只保留汇总。请输入活动完整标题确认：${a.title}`,
      '不可恢复的归档',
      { inputValidator: (v) => v === a.title || '标题不一致' },
    )
    await act('activity.archive', { activityId: a.id, confirm: value })
  } catch {}
}
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  errors.value = []
  importing.value = true
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('目录文件不能超过5MB')
    const rows = await readTable(file)
    for (const [i, row] of rows.entries()) {
      try {
        await s.act('organization.save', {
          name: String(row.name || row.名称 || '').trim(),
          kind: row.kind || ({ 社团: 'club', 竞赛: 'contest' } as any)[row.类型] || '',
          campus: row.campus || row.校区 || '',
          stars: Number(row.stars || row.星级),
          enabled: true,
        })
      } catch (e) {
        errors.value.push(`第${i + 2}行：${(e as Error).message}`)
      }
    }
    ElMessage.success(
      `导入完成：成功${rows.length - errors.value.length}，失败${errors.value.length}`,
    )
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    importing.value = false
    ;(event.target as HTMLInputElement).value = ''
  }
}
async function template() {
  await writeTable(
    [{ name: '示例社团', kind: 'club', campus: '南湖', stars: 3 }],
    '目录导入模板',
    'xlsx',
  )
}
</script>
<template>
  <div v-if="s.admin" class="page-wrap">
    <span class="eyebrow">管理员</span>
    <h1>校园平台管理</h1>
    <p class="muted">组织授权、目录维护与数据生命周期。</p>
    <div class="metric-grid">
      <div class="metric">
        <span>活动总数</span><b>{{ totals.activities }}</b>
      </div>
      <div class="metric">
        <span>报名总数（含归档汇总）</span><b>{{ totals.applications }}</b>
      </div>
      <div class="metric">
        <span>录取总数</span><b>{{ totals.admitted }}</b>
      </div>
    </div>
    <section class="panel">
      <el-tabs v-model="tab"
        ><el-tab-pane label="负责人审批" name="grants"
          ><el-table :data="s.data?.grants"
            ><el-table-column label="申请人"
              ><template #default="{ row }">{{
                s.data?.users.find((u) => u.id === row.userId)?.name
              }}</template></el-table-column
            ><el-table-column label="组织"
              ><template #default="{ row }">{{
                s.data?.organizations.find((o) => o.id === row.orgId)?.name
              }}</template></el-table-column
            ><el-table-column prop="reason" label="理由" /><el-table-column label="状态"
              ><template #default="{ row }">{{
                grantStatus[row.status]
              }}</template></el-table-column
            ><el-table-column label="操作" width="160"
              ><template #default="{ row }"
                ><template v-if="row.status === 'pending'"
                  ><el-button link type="primary" @click="decide(row.id, true)">通过</el-button
                  ><el-button link type="danger" @click="decide(row.id, false)"
                    >驳回</el-button
                  ></template
                ></template
              ></el-table-column
            ></el-table
          ></el-tab-pane
        ><el-tab-pane label="社团与竞赛目录" name="organizations"
          ><div class="row-actions">
            <el-button type="primary" @click="editOrg()">新增目录项</el-button
            ><el-button @click="template">下载导入模板</el-button
            ><label class="upload-label"
              >{{ importing ? '导入中…' : '导入 XLSX / CSV'
              }}<input type="file" accept=".xlsx,.csv" :disabled="importing" @change="importFile"
            /></label>
          </div>
          <el-alert
            v-for="e in errors"
            :key="e"
            :title="e"
            type="error"
            :closable="false"
          /><el-table :data="s.data?.organizations"
            ><el-table-column prop="name" label="名称" min-width="180" /><el-table-column
              label="类型"
              ><template #default="{ row }">{{
                row.kind === 'club' ? '社团' : '竞赛'
              }}</template></el-table-column
            ><el-table-column prop="campus" label="校区" /><el-table-column
              prop="stars"
              label="星级"
            /><el-table-column label="状态"
              ><template #default="{ row }">{{
                row.enabled ? '启用' : '停用'
              }}</template></el-table-column
            ><el-table-column label="操作"
              ><template #default="{ row }"
                ><el-button link @click="editOrg(row)">编辑</el-button></template
              ></el-table-column
            ></el-table
          ></el-tab-pane
        ><el-tab-pane label="活动与归档" name="activities"
          ><el-table :data="s.data?.activities"
            ><el-table-column prop="title" label="活动" min-width="200" /><el-table-column
              label="状态"
              width="110"
              ><template #default="{ row }">{{
                activityStatus(row, s.now)
              }}</template></el-table-column
            ><el-table-column label="操作" min-width="170"
              ><template #default="{ row }"
                ><el-button
                  v-if="!row.removed && !row.archived"
                  link
                  type="danger"
                  @click="remove(row.id)"
                  >下架</el-button
                ><el-button v-if="row.closedAt && !row.archived" link @click="archive(row)"
                  >预览并归档</el-button
                ><span v-if="row.archived"
                  >仅保留汇总 {{ row.summary?.total }} 报名 / {{ row.summary?.admitted }} 录取</span
                ></template
              ></el-table-column
            ></el-table
          ></el-tab-pane
        ><el-tab-pane label="学期与演示时间" name="semesters"
          ><el-button
            @click="
              () => {
                semester = { name: '', start: '', end: '' }
                semesterOpen = true
              }
            "
            >新增学期</el-button
          ><el-table :data="s.data?.semesters"
            ><el-table-column prop="name" label="学期" /><el-table-column
              prop="start"
              label="开始"
            /><el-table-column prop="end" label="结束" /><el-table-column label="操作"
              ><template #default="{ row }"
                ><el-button
                  link
                  @click="
                    () => {
                      semester = { ...row }
                      semesterOpen = true
                    }
                  "
                  >编辑</el-button
                ></template
              ></el-table-column
            ></el-table
          >
          <div v-if="mockMode" class="panel soft-tip">
            <h3>演示时间推进</h3>
            <p>仅改变模拟环境时间，便于检查截止、统一审核与归档场景。</p>
            <el-date-picker
              v-model="time"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ssZ"
            /><el-button @click="act('demo.time', { now: time })">应用演示时间</el-button>
          </div></el-tab-pane
        ><el-tab-pane label="审计日志" name="audit"
          ><el-button @click="downloadRedacted(s.data?.audits)">导出脱敏排查日志</el-button
          ><el-table :data="s.data?.audits"
            ><el-table-column prop="at" label="时间" min-width="190" /><el-table-column
              prop="action"
              label="操作"
              min-width="170" /><el-table-column prop="actorId" label="操作人" /><el-table-column
              prop="detail"
              label="说明" /></el-table></el-tab-pane
      ></el-tabs>
    </section>
    <el-dialog v-model="orgOpen" title="目录项配置" width="500px" class="responsive-dialog"
      ><el-form label-position="top"
        ><el-form-item label="名称"><el-input v-model="org.name" /></el-form-item
        ><el-form-item label="类型"
          ><el-select v-model="org.kind"
            ><el-option label="社团" value="club" /><el-option
              label="竞赛"
              value="contest" /></el-select></el-form-item
        ><el-form-item label="校区"><el-input v-model="org.campus" /></el-form-item
        ><el-form-item label="星级"
          ><el-input-number
            v-model="org.stars"
            :min="1"
            :max="org.kind === 'club' ? 5 : 7"
            :step="1"
            step-strictly /></el-form-item
        ><el-checkbox v-model="org.enabled">启用（停用不删除历史活动）</el-checkbox>
        <p />
        <el-button
          type="primary"
          @click="
            act('organization.save', org).then((ok) => {
              if (ok) orgOpen = false
            })
          "
          >保存目录</el-button
        ></el-form
      ></el-dialog
    ><el-dialog v-model="semesterOpen" title="学期配置" width="480px" class="responsive-dialog"
      ><el-form label-position="top"
        ><el-form-item label="学期名称"><el-input v-model="semester.name" /></el-form-item
        ><el-form-item label="开始日期"
          ><el-date-picker v-model="semester.start" value-format="YYYY-MM-DD" /></el-form-item
        ><el-form-item label="结束日期"
          ><el-date-picker v-model="semester.end" value-format="YYYY-MM-DD" /></el-form-item
        ><el-button
          type="primary"
          @click="
            act('semester.save', semester).then((ok) => {
              if (ok) semesterOpen = false
            })
          "
          >保存学期</el-button
        ></el-form
      ></el-dialog
    >
  </div>
  <el-empty v-else description="需要管理员身份" />
</template>
