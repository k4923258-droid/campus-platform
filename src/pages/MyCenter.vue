<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowUpRight, ClipboardList, CheckCircle2, Clock3 } from 'lucide-vue-next'
import { usePlatform } from '@/stores/platform'
import { statusLabels, stageLabels, type Application } from '@/domain/types'
import RegistrationForm from '@/components/RegistrationForm.vue'
import { fileUrl } from '@/api/client'
function login() {
  window.dispatchEvent(new Event('campus-login'))
}
const s = usePlatform()
const selected = ref<Application>()
const edit = ref(false)
const slotOpen = ref(false)
const grantOpen = ref(false)
const reason = ref('')
const orgId = ref('')
const tab = ref('applications')
const rows = computed(
  () => s.data?.applications.filter((r) => r.memberNos.includes(s.me?.studentNo || '')) || [],
)
const activity = (r: Application) => s.data!.activities.find((a) => a.id === r.activityId)!
const slots = computed(
  () =>
    s.data?.slots.filter(
      (slot) => slot.activityId === selected.value?.activityId && !slot.cancelled,
    ) || [],
)
async function act(action: string, p: any) {
  try {
    await s.act(action, p)
    ElMessage.success('操作成功')
    slotOpen.value = false
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
async function leave(r: Application) {
  try {
    const action = r.captainId === s.me?.id ? 'application.withdraw' : 'application.exit'
    await ElMessageBox.confirm(
      action.endsWith('withdraw')
        ? '将撤回本人或整队报名并释放预约，是否继续？'
        : '退出后立即释放你的学号占用，并通知队长。是否继续？',
      '确认操作',
    )
    await act(action, { id: r.id })
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message)
  }
}
async function applyGrant() {
  try {
    await s.act('grant.apply', { orgId: orgId.value, reason: reason.value })
    grantOpen.value = false
    ElMessage.success('申请已提交')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
async function attachment(value: unknown) {
  try {
    window.open(await fileUrl(String(value).slice(5)), '_blank', 'noopener')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
</script>
<template>
  <div v-if="s.me" class="page-wrap">
    <div class="section-heading">
      <div>
        <span class="eyebrow">学生中心</span>
        <h1>我的报名</h1>
        <p class="muted">查看报名信息、审核进度与面试安排。</p>
      </div>
      <el-button @click="grantOpen = true">申请负责人资格 <ArrowUpRight :size="15" /></el-button>
    </div>
    <div class="metric-grid">
      <div class="metric">
        <ClipboardList /><b>{{ rows.filter((r) => r.status !== 'withdrawn').length }}</b
        ><span>参与活动</span>
      </div>
      <div class="metric">
        <Clock3 /><b>{{
          rows.filter(
            (r) => !['admitted', 'unselected', 'rejected', 'withdrawn'].includes(r.status),
          ).length
        }}</b
        ><span>进行中</span>
      </div>
      <div class="metric">
        <CheckCircle2 /><b>{{ rows.filter((r) => r.status === 'admitted').length }}</b
        ><span>已录取</span>
      </div>
    </div>
    <el-tabs v-model="tab"
      ><el-tab-pane label="我的报名" name="applications"
        ><el-empty v-if="!rows.length" description="还没有报名，去发现你的下一个兴趣吧" />
        <article v-for="r in rows" :key="r.id" class="panel application-card">
          <div class="application-head">
            <div>
              <span class="eyebrow"
                >{{ s.data?.organizations.find((o) => o.id === activity(r).orgId)?.name }} · 报名
                v{{ r.version }}</span
              >
              <h2>{{ activity(r).title }}</h2>
              <span class="small muted"
                >提交 {{ new Date(r.createdAt).toLocaleString() }} / 更新
                {{ new Date(r.updatedAt).toLocaleString() }}</span
              >
            </div>
            <el-tag
              :type="
                r.status === 'admitted' ? 'success' : r.status === 'rejected' ? 'danger' : 'info'
              "
              >{{ statusLabels[r.status] }}</el-tag
            >
          </div>
          <p v-if="activity(r).team">
            团队学号：{{ r.memberNos.join('、') }}
            <el-tag v-if="r.memberNos.length < activity(r).minTeam" type="danger"
              >人数不足，请队长补齐</el-tag
            >
          </p>
          <p v-if="r.slotId">
            面试安排：{{ s.data?.slots.find((v) => v.id === r.slotId)?.start }} /
            {{ s.data?.slots.find((v) => v.id === r.slotId)?.place }}
          </p>
          <el-collapse
            ><el-collapse-item title="报名详情、审核记录与时间线"
              ><dl class="answer-list">
                <template v-for="f in activity(r).fields" :key="f.id"
                  ><dt>{{ f.label }}</dt>
                  <dd>
                    <el-button
                      v-if="String(r.answers[f.id]).startsWith('file:')"
                      link
                      @click="attachment(r.answers[f.id])"
                      >查看附件</el-button
                    ><span v-else>{{
                      Array.isArray(r.answers[f.id])
                        ? (r.answers[f.id] as string[]).join('、')
                        : r.answers[f.id] || '未填写'
                    }}</span>
                  </dd></template
                >
              </dl>
              <p v-for="(review, i) in r.reviews.filter((v) => v.committed)" :key="i">
                {{ stageLabels[review.stage] }}：{{ review.passed ? '通过' : '未通过' }}
                {{ review.score !== undefined ? ' / ' + review.score + '分' : '' }}
                {{ review.note }}
              </p>
              <p v-for="(h, i) in r.history" :key="i" class="small muted">
                {{ h }}
              </p></el-collapse-item
            ></el-collapse
          >
          <div class="row-actions">
            <RouterLink :to="'/activities/' + r.activityId" class="text-button"
              >活动详情 ↗</RouterLink
            ><el-button
              v-if="
                r.captainId === s.me.id &&
                r.status !== 'withdrawn' &&
                s.now < new Date(activity(r).end) &&
                !activity(r).resultPublished
              "
              @click="
                () => {
                  selected = r
                  edit = true
                }
              "
              >修改报名</el-button
            ><el-button
              v-if="
                r.status !== 'withdrawn' &&
                s.now < new Date(activity(r).end) &&
                !activity(r).resultPublished
              "
              @click="leave(r)"
              >{{ r.captainId === s.me.id ? '撤回报名' : '退出团队' }}</el-button
            ><el-button
              v-if="r.status === 'interview' && r.captainId === s.me.id"
              type="primary"
              @click="
                () => {
                  selected = r
                  slotOpen = true
                }
              "
              >{{ r.slotId ? '改选面试时段' : '选择面试时段' }}</el-button
            >
          </div>
        </article></el-tab-pane
      ><el-tab-pane label="负责人资格申请" name="grants"
        ><el-table :data="s.data?.grants"
          ><el-table-column label="组织"
            ><template #default="{ row }">{{
              s.data?.organizations.find((o) => o.id === row.orgId)?.name
            }}</template></el-table-column
          ><el-table-column prop="reason" label="申请理由" /><el-table-column label="状态"
            ><template #default="{ row }">{{
              { pending: '待处理', approved: '已通过', rejected: '已驳回' }[row.status as string]
            }}</template></el-table-column
          ><el-table-column prop="decision" label="处理说明" /></el-table></el-tab-pane
    ></el-tabs>
    <el-dialog v-model="edit" title="修改报名" width="600px" class="responsive-dialog"
      ><RegistrationForm
        v-if="selected"
        :key="selected.id + selected.version"
        :activity="activity(selected)"
        :existing="selected"
        @saved="edit = false" /></el-dialog
    ><el-dialog v-model="slotOpen" title="选择面试时段" width="640px" class="responsive-dialog"
      ><p class="muted">团队仅由队长选择，全队共用一个名额。时段开始前可以改选。</p>
      <el-empty v-if="!slots.length" description="负责人尚未配置可选时段" />
      <div v-for="slot in slots" :key="slot.id" class="slot-row">
        <div>
          <b
            >{{ new Date(slot.start).toLocaleString() }} —
            {{ new Date(slot.end).toLocaleTimeString() }}</b
          >
          <p>{{ slot.place }} · 已约 {{ (slot as any).booked || 0 }} / {{ slot.capacity }}</p>
        </div>
        <el-button
          :disabled="s.now >= new Date(slot.start)"
          @click="act('slot.book', { id: selected?.id, slotId: slot.id })"
          >{{ selected?.slotId === slot.id ? '已选择' : '选择' }}</el-button
        >
      </div></el-dialog
    ><el-dialog v-model="grantOpen" title="申请负责人资格" width="480px" class="responsive-dialog"
      ><el-form label-position="top"
        ><el-form-item label="社团或竞赛"
          ><el-select v-model="orgId"
            ><el-option
              v-for="o in s.data?.organizations.filter((o) => o.enabled)"
              :key="o.id"
              :label="o.name"
              :value="o.id" /></el-select></el-form-item
        ><el-form-item label="申请理由"
          ><el-input v-model="reason" type="textarea" :rows="4" /></el-form-item
        ><el-button type="primary" @click="applyGrant">提交申请</el-button></el-form
      ></el-dialog
    >
  </div>
  <el-empty v-else description="登录后查看自己的报名与进度"
    ><el-button type="primary" @click="login">登录账号</el-button></el-empty
  >
</template>
