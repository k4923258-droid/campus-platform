<script setup lang="ts">
import { reviewCounts } from '@/domain/history'
import { downloadRedacted } from '@/domain/redact'
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Download, Send } from 'lucide-vue-next'
import { writeTable } from '@/api/spreadsheet'
import { usePlatform } from '@/stores/platform'
import {
  activityStatus,
  statusLabels,
  stageLabels,
  type Activity,
  type Application,
  type Slot,
} from '@/domain/types'
import ActivityEditor from '@/components/ActivityEditor.vue'
import { fileUrl } from '@/api/client'
const s = usePlatform()
const activityId = ref('')
const editor = ref(false)
const editing = ref<Activity>()
const tab = ref('applications')
const status = ref('')
const selected = ref<Application[]>([])
const batchOpen = ref(false),
  batchBusy = ref(false)
const batchPassed = ref(true),
  batchScore = ref(60),
  batchNote = ref('')
const batchResults = ref<{ id: string; ok: boolean; message: string }[]>([])
const batchTasks = ref<{ id: string; version: number; stage: string }[]>([])
const batchMode = ref('pass')
const review = ref<Application>()
const reviewOpen = ref(false)
const score = ref(60)
const passed = ref(true)
const note = ref('')
const slotOpen = ref(false)
const slot = ref<any>({})
const admitted = ref<string[]>([])
const activities = computed(() =>
  s.data!.activities.filter((a) => s.admin || s.me?.orgIds.includes(a.orgId)),
)
const a = computed(
  () => activities.value.find((a) => a.id === activityId.value) || activities.value[0],
)
const rows = computed(() => s.data!.applications.filter((r) => r.activityId === a.value?.id))
const filtered = computed(() =>
  rows.value.filter((r) => !status.value || r.status === status.value),
)
const slots = computed(() => s.data!.slots.filter((v) => v.activityId === a.value?.id))
const stage = computed(() => a.value?.stages[review.value?.stageIndex || 0])
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
function openReview(r: Application) {
  review.value = r
  const draft = r.reviews.find((v) => v.stage === r.status && !v.committed)
  score.value = draft?.score ?? 60
  passed.value = draft?.passed ?? true
  note.value = draft?.note || ''
  reviewOpen.value = true
}
async function saveReview(commit: boolean) {
  if (
    await act('review.save', {
      id: review.value?.id,
      version: review.value?.version,
      stage: review.value?.status,
      score: score.value,
      passed: passed.value,
      note: note.value,
      commit,
    })
  )
    reviewOpen.value = false
}
function prepareBatch() {
  if (!selected.value.length) return ElMessage.warning('请先选择报名')
  if (
    new Set(selected.value.map((r) => r.status)).size !== 1 ||
    !['initial', 'written', 'interview'].includes(selected.value[0]!.status)
  )
    return ElMessage.warning('请选择同一人工审核环节的报名')
  batchResults.value = []
  batchTasks.value = selected.value.map((r) => ({ id: r.id, version: r.version, stage: r.status }))
  batchMode.value =
    a.value?.stages.find((st) => st.key === batchTasks.value[0]?.stage)?.mode || 'pass'
  batchOpen.value = true
}
async function batch() {
  if (batchBusy.value) return
  batchBusy.value = true
  const tasks = batchTasks.value.map((r) => ({ ...r }))
  try {
    batchResults.value = []
    for (const task of tasks) {
      try {
        await s.act('review.save', {
          ...task,
          passed: batchPassed.value,
          score: batchScore.value,
          note: batchNote.value,
          commit: true,
        })
        batchResults.value.push({ id: task.id, ok: true, message: '已确认并流转' })
      } catch (e) {
        batchResults.value.push({ id: task.id, ok: false, message: (e as Error).message })
      }
    }
    ElMessage.info('批量处理完成，请查看逐条结果；失败项未作修改')
  } finally {
    batchBusy.value = false
  }
}
function editSlot(v?: Slot) {
  slot.value = v
    ? { ...v, reason: '' }
    : {
        activityId: a.value?.id,
        start: '2026-11-01T14:00:00+08:00',
        end: '2026-11-01T14:30:00+08:00',
        place: '',
        capacity: 5,
        cancelled: false,
        reason: '',
      }
  slotOpen.value = true
}
async function publish() {
  try {
    await ElMessageBox.confirm('未勾选的待录取报名将标记为未录取，确认发布？', '发布录取')
    await act('result.publish', { activityId: a.value?.id, admittedIds: admitted.value })
  } catch {}
}
async function withReason(action: string) {
  try {
    const { value } = await ElMessageBox.prompt('请输入原因', '操作说明', {
      inputValidator: (v) => !!v?.trim() || '原因不能为空',
    })
    await act(action, { activityId: a.value?.id, reason: value })
  } catch {}
}
async function send() {
  try {
    const { value } = await ElMessageBox.prompt(
      '通知将发送给当前活动和筛选环节的报名者',
      '批量站内信',
      { inputType: 'textarea', inputValidator: (v) => !!v?.trim() || '请输入内容' },
    )
    await act('notice.send', { activityId: a.value?.id, status: status.value, text: value })
  } catch {}
}
async function exported(format: 'csv' | 'xlsx') {
  const clean = (v: unknown) => {
    const t = String(v ?? '')
    return /^[=+\-@\t\r]/.test(t) ? "'" + t : t
  }
  const records = rows.value.map((r) => ({
    活动: a.value!.title,
    队长: s.data?.users.find((u) => u.id === r.captainId)?.name,
    团队学号: r.memberNos.join(';'),
    版本: r.version,
    状态: statusLabels[r.status],
    ...Object.fromEntries(a.value!.fields.map((f) => [f.label, clean(r.answers[f.id])])),
  }))
  await writeTable(records, '报名与录取名单', format)
}
async function attachment(v: unknown) {
  try {
    window.open(await fileUrl(String(v).slice(5)), '_blank', 'noopener')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
function create() {
  editing.value = undefined
  editor.value = true
}
</script>
<template>
  <div v-if="s.manager" class="page-wrap">
    <div class="section-heading">
      <div>
        <span class="eyebrow">负责人工作台</span>
        <h1>活动管理</h1>
        <p class="muted">发布活动，配置报名与审核流程，处理面试和录取。</p>
      </div>
      <el-button type="primary" @click="create"><Plus :size="16" /> 新建活动</el-button>
    </div>
    <div class="workspace-layout">
      <aside class="panel workspace-nav">
        <h3>我管理的活动</h3>
        <button
          v-for="v in activities"
          :key="v.id"
          :class="{ active: a?.id === v.id }"
          @click="
            () => {
              activityId = v.id
              admitted = []
              selected = []
            }
          "
        >
          <span>{{ v.title }}</span
          ><small>{{ activityStatus(v, s.now) }}</small></button
        ><el-empty v-if="!activities.length" description="尚未发布活动" />
      </aside>
      <section v-if="a">
        <div class="panel">
          <div class="application-head">
            <div>
              <span class="eyebrow">{{
                s.data?.organizations.find((o) => o.id === a?.orgId)?.name
              }}</span>
              <h2>{{ a.title }}</h2>
            </div>
            <el-tag>{{ activityStatus(a, s.now) }}</el-tag>
          </div>
          <div class="row-actions">
            <el-button
              :disabled="a.archived || !!a.closedAt || a.removed"
              @click="
                () => {
                  editing = a
                  editor = true
                }
              "
              >编辑配置</el-button
            ><RouterLink :to="'/activities/' + a.id" class="text-button">查看活动 ↗</RouterLink
            ><el-button @click="send" :disabled="a.archived || !!a.closedAt"
              ><Send :size="14" />发送通知</el-button
            ><el-dropdown
              ><el-button><Download :size="14" /> 导出名单</el-button
              ><template #dropdown
                ><el-dropdown-menu
                  ><el-dropdown-item @click="exported('xlsx')">XLSX</el-dropdown-item
                  ><el-dropdown-item @click="exported('csv')"
                    >CSV</el-dropdown-item
                  ></el-dropdown-menu
                ></template
              ></el-dropdown
            ><el-button
              :disabled="(!a.resultPublished && !a.external && !a.removed) || !!a.closedAt"
              @click="act('activity.close', { activityId: a.id })"
              >活动结项</el-button
            >
          </div>
        </div>
        <div class="metric-grid">
          <div v-for="st in a.stages.filter((st) => st.enabled)" :key="st.key" class="metric">
            <span>{{ stageLabels[st.key] }} · 总人数</span
            ><b>{{ reviewCounts(a, rows, st.key).total }}</b>
            <small
              >待处理 {{ reviewCounts(a, rows, st.key).pending }} / 通过
              {{ reviewCounts(a, rows, st.key).passed }} / 未通过
              {{ reviewCounts(a, rows, st.key).failed }}</small
            >
            <small v-if="a.team"
              >按成员人数统计，共 {{ reviewCounts(a, rows, st.key).teams }} 队</small
            >
          </div>
        </div>
        <div class="panel">
          <el-tabs v-model="tab"
            ><el-tab-pane label="报名审核" name="applications"
              ><div class="row-actions">
                <el-select v-model="status" clearable placeholder="全部环节" style="width: 160px"
                  ><el-option
                    v-for="(label, key) in statusLabels"
                    :key="key"
                    :label="label"
                    :value="key" /></el-select
                ><el-button @click="prepareBatch">批量审核本环节</el-button
                ><span class="muted">共 {{ filtered.length }} 条</span>
              </div>
              <el-table :data="filtered" @selection-change="selected = $event"
                ><el-table-column type="selection" width="44" /><el-table-column
                  label="报名人 / 团队"
                  min-width="140"
                  ><template #default="{ row }"
                    >{{ s.data?.users.find((u) => u.id === row.captainId)?.name
                    }}<small class="block">{{ row.memberNos.join('、') }}</small></template
                  ></el-table-column
                ><el-table-column label="状态" width="115"
                  ><template #default="{ row }"
                    ><el-tag>{{ statusLabels[row.status] }}</el-tag></template
                  ></el-table-column
                ><el-table-column prop="version" label="版本" width="60" /><el-table-column
                  label="操作"
                  width="120"
                  ><template #default="{ row }"
                    ><el-button link type="primary" @click="openReview(row)"
                      >查看 / 审核</el-button
                    ></template
                  ></el-table-column
                ></el-table
              ></el-tab-pane
            ><el-tab-pane label="面试时段" name="slots"
              ><el-button @click="editSlot()">＋ 新增时段</el-button>
              <div v-for="v in slots" :key="v.id" class="slot-row">
                <div>
                  <b>{{ new Date(v.start).toLocaleString() }}</b>
                  <p>
                    {{ v.place }} · 已约 {{ (v as any).booked || 0 }} / {{ v.capacity }}
                    {{ v.cancelled ? '（已取消）' : '' }}
                  </p>
                </div>
                <el-button @click="editSlot(v)">编辑 / 取消</el-button>
              </div></el-tab-pane
            ><el-tab-pane label="录取结果" name="results"
              ><el-alert
                title="报名截止、所有有效报名完成审核后才能发布；未选中者标为未录取。"
                :closable="false"
                type="info"
              />
              <el-collapse
                ><el-collapse-item title="历次发布名单与更正记录"
                  ><div v-for="pub in a.resultHistory || []" :key="pub.version">
                    <p>第{{ pub.version }}版 · {{ pub.at }} · 操作人 {{ pub.actorId }}</p>
                    <p>
                      录取：{{ pub.admittedIds.join('、') || '无' }}；未录取：{{
                        pub.unselectedIds.join('、') || '无'
                      }}
                    </p>
                    <p v-if="pub.withdrawnAt">
                      撤回：{{ pub.withdrawnAt }} / {{ pub.withdrawnBy }} / {{ pub.reason }}
                    </p>
                  </div></el-collapse-item
                ></el-collapse
              >
              <p>发布版本：{{ a.resultVersion }} · {{ a.resultPublished ? '已发布' : '未发布' }}</p>
              <el-checkbox-group v-model="admitted"
                ><div
                  v-for="r in rows.filter((r) =>
                    ['eligible', 'admitted', 'unselected'].includes(r.status),
                  )"
                  :key="r.id"
                >
                  <el-checkbox :value="r.id" :disabled="a.resultPublished"
                    >{{ s.data?.users.find((u) => u.id === r.captainId)?.name }} /
                    {{ r.memberNos.join('、') }} · {{ statusLabels[r.status] }}</el-checkbox
                  >
                </div></el-checkbox-group
              >
              <div class="row-actions">
                <el-button v-if="!a.resultPublished" type="primary" @click="publish"
                  >发布录取结果</el-button
                ><el-button v-else @click="withReason('result.withdraw')">撤回并更正结果</el-button>
              </div></el-tab-pane
            ><el-tab-pane label="变更与审计" name="audit"
              ><el-button
                @click="downloadRedacted(s.data?.audits.filter((v) => v.activityId === a?.id))"
                >导出脱敏排查日志</el-button
              >
              <el-collapse
                ><el-collapse-item title="公告与时间变更明细"
                  ><div v-for="(change, i) in a.changeHistory || []" :key="i">
                    <p>{{ change.at }} · {{ change.actorId }}</p>
                    <p v-for="(delta, key) in change.changes" :key="key">
                      {{ key }}：{{ delta.before }} → {{ delta.after }}
                    </p>
                  </div></el-collapse-item
                ></el-collapse
              >
              <el-table :data="s.data?.audits.filter((v) => v.activityId === a?.id)"
                ><el-table-column prop="at" label="时间" min-width="180" /><el-table-column
                  prop="action"
                  label="操作"
                  min-width="180" /><el-table-column
                  prop="detail"
                  label="说明" /></el-table></el-tab-pane
          ></el-tabs>
        </div>
      </section>
    </div>
    <el-dialog
      v-model="batchOpen"
      title="批量审核"
      width="600px"
      class="responsive-dialog"
      :close-on-click-modal="!batchBusy"
      :close-on-press-escape="!batchBusy"
      :show-close="!batchBusy"
    >
      <p>对所选同环节报名逐条确认，每条独立提交，失败项可修正后重选。</p>
      <el-input-number
        v-if="batchMode === 'score'"
        v-model="batchScore"
        :min="0"
        :max="100"
        :step="1"
        step-strictly
        :disabled="batchBusy || !!batchResults.length"
        aria-label="批量分数"
      />
      <el-radio-group v-else v-model="batchPassed" :disabled="batchBusy || !!batchResults.length"
        ><el-radio :value="true">通过</el-radio
        ><el-radio :value="false">不通过</el-radio></el-radio-group
      >
      <el-input
        v-model="batchNote"
        placeholder="审核备注"
        :disabled="batchBusy || !!batchResults.length"
      />
      <el-button
        type="primary"
        :loading="batchBusy"
        :disabled="!!batchResults.length"
        @click="batch"
        >确认提交所选 {{ batchTasks.length }} 条</el-button
      >
      <p v-for="v in batchResults" :key="v.id">
        {{ v.id }} · {{ v.ok ? '成功' : '失败' }}：{{ v.message }}
      </p>
    </el-dialog>
    <el-dialog
      v-model="editor"
      :title="editing ? '活动配置' : '创建新活动'"
      width="900px"
      class="responsive-dialog"
      ><ActivityEditor
        v-if="editor"
        :key="editing?.id || 'new'"
        :activity="editing"
        @saved="editor = false" /></el-dialog
    ><el-dialog
      v-model="reviewOpen"
      title="报名详情与环节审核"
      width="640px"
      class="responsive-dialog"
      ><template v-if="review"
        ><p>版本 v{{ review.version }} · {{ statusLabels[review.status] }}</p>
        <p v-for="f in a?.fields" :key="f.id">
          <b>{{ f.label }}：</b
          ><el-button
            v-if="String(review.answers[f.id]).startsWith('file:')"
            link
            @click="attachment(review.answers[f.id])"
            >查看附件</el-button
          ><span v-else>{{ review.answers[f.id] }}</span>
        </p>
        <p v-for="(r, i) in review.reviews" :key="i">
          {{ stageLabels[r.stage] }}：{{ r.committed ? '已确认' : '草稿' }} /
          {{ r.passed ? '通过' : '未通过' }} {{ r.score !== undefined ? r.score + '分' : '' }}
          {{ r.note }} · {{ r.at }} · {{ r.actorId }}
        </p>
        <el-collapse
          ><el-collapse-item title="旧版报名与已失效的审核结论"
            ><div v-for="v in review.versions || []" :key="v.version">
              <h4>版本 {{ v.version }} · {{ v.updatedAt }} · {{ v.memberNos.join('、') }}</h4>
              <p v-for="(value, key) in v.answers" :key="key">
                {{ key }}：<el-button
                  v-if="String(value).startsWith('file:')"
                  link
                  @click="attachment(value)"
                  >查看旧版附件</el-button
                ><span v-else>{{ value }}</span>
              </p>
              <p v-for="(conclusion, i) in v.reviews" :key="i">
                {{ stageLabels[conclusion.stage] }} / {{ conclusion.committed ? '正式' : '草稿' }} /
                {{ conclusion.passed ? '通过' : '未通过' }} / {{ conclusion.score }} /
                {{ conclusion.note }} / {{ conclusion.at }} / {{ conclusion.actorId }}
              </p>
            </div></el-collapse-item
          ></el-collapse
        >
        <el-divider /><template v-if="['initial', 'written', 'interview'].includes(review.status)"
          ><el-form label-position="top"
            ><el-form-item
              :label="
                stage?.mode === 'score' ? '分数（合格线 ' + stage.threshold + '）' : '审核结论'
              "
              ><el-input-number
                v-if="stage?.mode === 'score'"
                v-model="score"
                :min="0"
                :max="100"
                :step="1"
                step-strictly
              /><el-radio-group v-else v-model="passed"
                ><el-radio :value="true">通过</el-radio
                ><el-radio :value="false">不通过</el-radio></el-radio-group
              ></el-form-item
            ><el-form-item label="备注"
              ><el-input v-model="note" type="textarea" /></el-form-item></el-form
          ><el-button @click="saveReview(false)">保存评分草稿</el-button
          ><el-button type="primary" @click="saveReview(true)">确认并流转</el-button></template
        ></template
      ></el-dialog
    ><el-dialog v-model="slotOpen" title="面试时段配置" width="540px" class="responsive-dialog"
      ><el-form label-position="top"
        ><el-form-item label="开始时间"
          ><el-date-picker
            v-model="slot.start"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item
        ><el-form-item label="结束时间"
          ><el-date-picker
            v-model="slot.end"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item
        ><el-form-item label="地点或线上说明"><el-input v-model="slot.place" /></el-form-item
        ><el-form-item label="容量（队伍数 / 个人数）"
          ><el-input-number
            v-model="slot.capacity"
            :min="1"
            :step="1"
            step-strictly /></el-form-item
        ><el-form-item v-if="slot.id" label="变更原因（已有预约时必填）"
          ><el-input v-model="slot.reason" /></el-form-item
        ><el-checkbox v-if="slot.id" v-model="slot.cancelled"
          >取消此时段，并通知重新选择</el-checkbox
        >
        <p />
        <el-button
          type="primary"
          @click="
            act('slot.save', slot).then((ok) => {
              if (ok) slotOpen = false
            })
          "
          >保存时段</el-button
        ></el-form
      ></el-dialog
    >
  </div>
  <el-empty v-else description="需要负责人或管理员身份" />
</template>
