<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Search,
  ArrowRight,
  MapPin,
  SlidersHorizontal,
  X,
  Users,
  ClipboardList,
} from 'lucide-vue-next'
import { usePlatform } from '@/stores/platform'
import { activityStatus, type Activity } from '@/domain/types'
const s = usePlatform()
const kind = ref('club'),
  keyword = ref(''),
  campus = ref(''),
  status = ref(''),
  sort = ref('newest')
const stars = ref<number>(),
  page = ref(1),
  filtersOpen = ref(false)
const org = (a: Activity) => s.data!.organizations.find((o) => o.id === a.orgId)!
const all = computed(() =>
  s.data!.activities.filter((a) => a.published && !a.removed && !a.archived),
)
const board = computed(() => all.value.filter((a) => org(a).kind === kind.value))
const rows = computed(() =>
  board.value
    .filter(
      (a) =>
        (!campus.value || org(a).campus === campus.value) &&
        (!stars.value || org(a).stars === stars.value) &&
        (!status.value || activityStatus(a, s.now) === status.value) &&
        (!keyword.value ||
          (a.title + org(a).name).toLowerCase().includes(keyword.value.trim().toLowerCase())),
    )
    .sort((a, b) =>
      sort.value === 'deadline'
        ? Date.parse(a.end) - Date.parse(b.end)
        : Date.parse(b.publishedAt || b.start) - Date.parse(a.publishedAt || a.start),
    ),
)
const visible = computed(() => rows.value.slice((page.value - 1) * 8, page.value * 8))
const filtersCount = computed(
  () => Number(!!campus.value) + Number(!!stars.value) + Number(!!status.value),
)
const enrolled = computed(() =>
  s.data!.applications.filter(
    (r) => r.status !== 'withdrawn' && r.memberNos.includes(s.me?.studentNo || ''),
  ),
)
const unread = computed(() => s.data!.notices.filter((n) => !n.read).length)
watch([kind, keyword, campus, stars, status], () => {
  page.value = 1
})
watch(kind, () => {
  if (kind.value === 'club' && stars.value && stars.value > 5) stars.value = undefined
})
function resetFilters() {
  campus.value = ''
  stars.value = undefined
  status.value = ''
  keyword.value = ''
}
function summary(a: Activity) {
  const paragraph =
    a.body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !/^#{1,6}\s/.test(p) && !/^[-*]\s/.test(p)) || ''
  return paragraph
    .replace(/[#*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 105)
}
const date = (value: string) =>
  new Date(value)
    .toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    .replaceAll('/', '-')
const time = (value: string) =>
  new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const stateClass = (a: Activity) =>
  activityStatus(a, s.now) === '报名中'
    ? 'open'
    : activityStatus(a, s.now) === '待开始'
      ? 'upcoming'
      : 'closed'
</script>
<template>
  <div class="catalog-page">
    <div class="page-heading">
      <div>
        <h1>活动信息</h1>
        <p>查询社团招新与竞赛公告，查看报名时间和审核安排。</p>
      </div>
      <RouterLink to="/my" class="heading-link">查看我的报名 <ArrowRight :size="16" /></RouterLink>
    </div>
    <div class="catalog-tabs" aria-label="信息板块">
      <button
        :class="{ active: kind === 'club' }"
        :aria-pressed="kind === 'club'"
        @click="kind = 'club'"
      >
        <Users :size="17" />社团招新
        <span>{{ all.filter((a) => org(a).kind === 'club').length }}</span></button
      ><button
        :class="{ active: kind === 'contest' }"
        :aria-pressed="kind === 'contest'"
        @click="kind = 'contest'"
      >
        <ClipboardList :size="17" />竞赛信息
        <span>{{ all.filter((a) => org(a).kind === 'contest').length }}</span>
      </button>
    </div>
    <div class="catalog-layout">
      <aside class="catalog-sidebar" :class="{ 'filters-expanded': filtersOpen }">
        <div class="filter-heading">
          <h2><SlidersHorizontal :size="16" />筛选条件</h2>
          <button class="text-button" @click="resetFilters">重置</button>
        </div>
        <button
          class="mobile-filter-toggle"
          :aria-expanded="filtersOpen"
          @click="filtersOpen = !filtersOpen"
        >
          <SlidersHorizontal :size="16" />{{ filtersOpen ? '收起筛选' : '展开筛选'
          }}<span v-if="filtersCount">已选 {{ filtersCount }} 项</span>
        </button>
        <div class="filter-section" role="group" aria-label="校区筛选">
          <h3>校区</h3>
          <button :class="{ selected: !campus }" :aria-pressed="!campus" @click="campus = ''">
            全部校区<span>{{ board.length }}</span></button
          ><button
            v-for="c in ['南湖', '浑南', '两校区']"
            :key="c"
            :class="{ selected: campus === c }"
            :aria-pressed="campus === c"
            @click="campus = c"
          >
            {{ c === '两校区' ? '两校区均可' : c + '校区'
            }}<span>{{ board.filter((a) => org(a).campus === c).length }}</span>
          </button>
        </div>
        <div class="filter-section" role="group" aria-label="星级筛选">
          <h3>{{ kind === 'club' ? '社团星级' : '竞赛星级' }}</h3>
          <div class="star-options">
            <button :class="{ selected: !stars }" :aria-pressed="!stars" @click="stars = undefined">
              全部星级</button
            ><button
              v-for="n in kind === 'club' ? 5 : 7"
              :key="n"
              :class="{ selected: stars === n }"
              :aria-pressed="stars === n"
              @click="stars = n"
            >
              {{ n }} 星
            </button>
          </div>
        </div>
        <div class="filter-section" role="group" aria-label="活动状态筛选">
          <h3>活动状态</h3>
          <button :class="{ selected: !status }" :aria-pressed="!status" @click="status = ''">
            全部状态</button
          ><button
            v-for="v in ['待开始', '报名中', '已截止', '已结束']"
            :key="v"
            :class="{ selected: status === v }"
            :aria-pressed="status === v"
            @click="status = v"
          >
            {{ v }}
          </button>
        </div>
        <div class="sidebar-help">
          <h3>报名说明</h3>
          <p>截止后不可提交新报名。</p>
          <p>团队报名由队长统一提交。</p>
          <p>审核和面试通知请查看站内信。</p>
        </div>
      </aside>
      <section class="catalog-results" aria-label="活动查询结果">
        <div class="catalog-search">
          <Search :size="19" /><input
            v-model="keyword"
            aria-label="搜索活动或组织"
            placeholder="输入活动、社团或竞赛名称"
          /><button
            v-if="keyword"
            class="icon-button"
            aria-label="清除搜索关键词"
            @click="keyword = ''"
          >
            <X :size="16" /></button
          ><button class="search-submit" @click="page = 1">搜索</button>
        </div>
        <div class="results-toolbar">
          <span
            >共 <b>{{ rows.length }}</b> 项{{ kind === 'club' ? '招新活动' : '竞赛信息' }}</span
          ><label
            >排序<select v-model="sort" aria-label="排序">
              <option value="newest">最新发布</option>
              <option value="deadline">即将截止</option>
            </select></label
          >
        </div>
        <div v-if="filtersCount" class="selected-filters">
          <span>当前筛选</span
          ><button v-if="campus" @click="campus = ''">{{ campus }} <X :size="12" /></button
          ><button v-if="stars" @click="stars = undefined">{{ stars }} 星 <X :size="12" /></button
          ><button v-if="status" @click="status = ''">{{ status }} <X :size="12" /></button>
        </div>
        <div class="activity-list">
          <RouterLink
            v-for="a in visible"
            :key="a.id"
            :to="'/activities/' + a.id"
            class="activity-row activity-card"
            ><div class="organization-mark" aria-hidden="true">
              <span>{{ kind === 'club' ? '社团' : '竞赛' }}</span
              ><small>{{ org(a).stars }} 星</small>
            </div>
            <div class="activity-row-main">
              <div class="row-title">
                <h3>{{ a.title }}</h3>
                <span class="activity-state" :class="stateClass(a)">{{
                  activityStatus(a, s.now)
                }}</span>
              </div>
              <div class="row-organization">
                {{ org(a).name
                }}<span
                  ><MapPin :size="13" />{{
                    org(a).campus === '两校区' ? '两校区' : org(a).campus + '校区'
                  }}</span
                >
              </div>
              <p class="activity-excerpt">{{ summary(a) }}</p>
              <div class="row-tags">
                <span>{{ a.external ? '外部报名' : a.team ? '团队报名' : '个人报名' }}</span
                ><span v-if="!a.external">{{ a.rolling ? '滚动审核' : '截止后统一审核' }}</span
                ><span v-if="a.team">{{ a.minTeam }}—{{ a.maxTeam }} 人 / 队</span>
              </div>
            </div>
            <div class="activity-row-end">
              <span class="deadline-label">报名截止</span><strong>{{ date(a.end) }}</strong
              ><small>{{ time(a.end) }}</small
              ><span class="row-detail-link">查看详情 <ArrowRight :size="14" /></span></div
          ></RouterLink>
        </div>
        <el-empty v-if="!rows.length" description="没有符合条件的活动"
          ><el-button @click="resetFilters">清除筛选条件</el-button></el-empty
        >
        <div class="catalog-pagination">
          <span>第 {{ page }} 页 / 共 {{ Math.max(1, Math.ceil(rows.length / 8)) }} 页</span
          ><el-pagination
            v-if="rows.length > 8"
            v-model:current-page="page"
            :page-size="8"
            :total="rows.length"
            layout="prev,pager,next"
          />
        </div>
        <div v-if="s.me" class="participation-summary">
          <div>
            <b>我的报名</b
            ><span
              >{{ enrolled.length }} 项记录<span v-if="unread"
                >，{{ unread }} 条未读通知</span
              ></span
            >
          </div>
          <RouterLink to="/my">查看报名进度 <ArrowRight :size="14" /></RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>
