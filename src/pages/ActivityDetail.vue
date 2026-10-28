<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { ArrowLeft, ArrowUpRight, CalendarDays, MapPin, Users } from 'lucide-vue-next'
import { usePlatform } from '@/stores/platform'
import { activityStatus, stageLabels } from '@/domain/types'
import RegistrationForm from '@/components/RegistrationForm.vue'
import { fileUrl } from '@/api/client'
const s = usePlatform()
const route = useRoute()
const open = ref(false)
const poster = ref('')
const a = computed(() => s.data?.activities.find((v) => v.id === route.params.id))
const org = computed(() => s.data?.organizations.find((v) => v.id === a.value?.orgId))
const html = computed(() =>
  DOMPurify.sanitize(new MarkdownIt({ html: false, linkify: true }).render(a.value?.body || '')),
)
const registered = computed(() =>
  s.data?.applications.some((r) => r.activityId === a.value?.id && r.status !== 'withdrawn'),
)
watch(
  () => a.value?.poster,
  async (value) => {
    if (poster.value) URL.revokeObjectURL(poster.value)
    poster.value = value?.startsWith('file:') ? await fileUrl(value.slice(5)).catch(() => '') : ''
  },
  { immediate: true },
)
onUnmounted(() => {
  if (poster.value) URL.revokeObjectURL(poster.value)
})
function apply() {
  if (!s.me) window.dispatchEvent(new Event('campus-login'))
  else open.value = true
}
</script>
<template>
  <div v-if="a" class="page-wrap">
    <RouterLink to="/" class="back-link"><ArrowLeft :size="17" />返回活动列表</RouterLink>
    <div class="detail-layout">
      <article class="panel detail-main">
        <div class="eyebrow">
          {{ org?.kind === 'club' ? '社团招新' : '竞赛信息' }} · {{ org?.name }}
        </div>
        <h1>{{ a.title }}</h1>
        <div class="card-tags">
          <span>{{ org?.campus }}校区</span><span>{{ org?.stars }} 星</span
          ><span>{{ a.team ? '团队报名' : '个人报名' }}</span
          ><el-tag type="success">{{ activityStatus(a, s.now) }}</el-tag>
        </div>
        <img v-if="poster" :src="poster" :alt="a.title + '活动海报'" class="poster" />
        <div class="markdown" v-html="html" />
      </article>
      <aside>
        <div class="panel sticky">
          <h2>报名信息</h2>
          <div class="detail-fact">
            <CalendarDays :size="19" />
            <div>
              <b>报名时间</b>
              <p>
                {{ new Date(a.start).toLocaleString('zh-CN') }}<br />至
                {{ new Date(a.end).toLocaleString('zh-CN') }}
              </p>
            </div>
          </div>
          <div class="detail-fact">
            <MapPin :size="19" />
            <div>
              <b>所属组织</b>
              <p>{{ org?.name }} · {{ org?.campus }}</p>
            </div>
          </div>
          <div class="detail-fact">
            <Users :size="19" />
            <div>
              <b>报名与审核</b>
              <p>
                {{
                  a.external
                    ? '外部官方渠道'
                    : a.team
                      ? `${a.minTeam}—${a.maxTeam}人 / 队`
                      : '个人报名'
                }}<br />{{ a.rolling ? '报名期间滚动审核' : '截止后统一审核' }}
              </p>
            </div>
          </div>
          <template v-if="a.external"
            ><el-alert
              title="将前往平台外的官方渠道，请核对当届通知。"
              type="info"
              :closable="false" />
            <p class="external-guide">{{ a.externalGuide }}</p>
            <a
              v-if="/https?:\/\/[^\s]+/.test(a.externalGuide)"
              class="button dark full"
              :href="a.externalGuide.match(/https?:\/\/[^\s]+/)?.[0]"
              target="_blank"
              rel="noopener noreferrer"
              >查看外部报名渠道 <ArrowUpRight :size="16" /></a></template
          ><template v-else
            ><RouterLink v-if="registered" to="/my" class="button dark full"
              >已报名，查看进度</RouterLink
            ><el-button
              v-else
              type="primary"
              class="full"
              size="large"
              :disabled="activityStatus(a, s.now) !== '报名中'"
              @click="apply"
              >{{ activityStatus(a, s.now) === '报名中' ? '我要报名' : '当前不可报名' }}</el-button
            >
            <p class="small muted">报名与结果通知均可在“我的参与”和站内信查看。</p></template
          >
        </div>
        <div class="panel process-panel">
          <h3>参与流程</h3>
          <ol>
            <li>提交报名</li>
            <li v-for="st in a.stages.filter((st) => st.enabled)" :key="st.key">
              {{ stageLabels[st.key] }}{{ st.automatic ? ' · 默认通过' : '' }}
            </li>
            <li>查看录取结果</li>
          </ol>
        </div>
      </aside>
    </div>
    <el-dialog v-model="open" title="填写报名信息" width="600px" class="responsive-dialog"
      ><RegistrationForm :activity="a" @saved="open = false"
    /></el-dialog>
  </div>
  <el-empty v-else description="活动不存在、未公开或已下架" />
</template>
