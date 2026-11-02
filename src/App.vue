<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowUpRight,
  Compass,
  CalendarDays,
  LayoutDashboard,
  ShieldCheck,
  Bell,
  GraduationCap,
  LogOut,
} from 'lucide-vue-next'
import { usePlatform } from './stores/platform'
import { mockMode, http } from './api/client'
import AuthDialog from './components/AuthDialog.vue'
const store = usePlatform()
const router = useRouter()
const loginOpen = ref(false)
const authInitial = ref<'login' | 'bind' | 'email-change'>('login')
const noticeOpen = ref(false)
function openAccount() {
  authInitial.value = store.me?.bindingStatus === 'bound' ? 'email-change' : 'bind'
  loginOpen.value = true
}
async function logout() {
  try {
    await store.logout()
    await router.push('/')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
async function reset() {
  try {
    await http.post('/demo/reset')
    sessionStorage.removeItem('demo-session')
    await store.refresh()
    await router.push('/')
    ElMessage.success('演示数据已恢复')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
function openLogin() {
  authInitial.value = 'login'
  loginOpen.value = true
}
let poll: ReturnType<typeof setInterval>
onMounted(async () => {
  window.addEventListener('campus-login', openLogin)
  window.addEventListener('campus-account', openAccount)
  try {
    if (!mockMode) await http.get('/csrf')
    await store.refresh()
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
  poll = setInterval(() => store.refresh().catch(() => {}), 30000)
})
onUnmounted(() => {
  clearInterval(poll)
  window.removeEventListener('campus-login', openLogin)
  window.removeEventListener('campus-account', openAccount)
})
</script>
<template>
  <div class="site-shell">
    <header class="topbar">
      <RouterLink to="/" class="brand"
        ><span class="brand-icon"><GraduationCap :size="24" /></span
        ><span
          >校园社团与竞赛平台<span class="brand-sub">社团招新 / 竞赛报名</span></span
        ></RouterLink
      >
      <nav aria-label="主导航">
        <RouterLink to="/"><Compass :size="17" />活动信息</RouterLink
        ><RouterLink to="/my"><CalendarDays :size="17" />我的报名</RouterLink
        ><RouterLink v-if="store.manager" to="/manage"
          ><LayoutDashboard :size="17" />负责人工作台</RouterLink
        ><RouterLink v-if="store.admin" to="/admin"><ShieldCheck :size="17" />平台管理</RouterLink>
      </nav>
      <div class="top-actions">
        <button v-if="store.me" class="icon-button" aria-label="站内信" @click="noticeOpen = true">
          <Bell :size="19" /><span
            v-if="store.data?.notices.some((n) => !n.read)"
            class="notice-dot"
          /></button
        ><template v-if="store.me"
          ><span class="avatar">{{ store.me.name.slice(0, 1) }}</span
          ><span class="user-name">{{ store.me.name }}</span
          ><button class="icon-button" aria-label="退出登录" @click="logout">
            <LogOut :size="17" /></button></template
        ><button v-else class="button dark" @click="openLogin">
          登录 / 注册 <ArrowUpRight :size="16" />
        </button>
      </div>
    </header>
    <div v-if="store.data?.identityMode !== 'formal'" class="demo-bar">
      <span
        ><span class="status-dot" />{{
          store.data?.identityMode === 'local-mail'
            ? '本地邮件测试环境 · 使用测试身份'
            : '课程演示环境 · 使用模拟账号与数据'
        }}</span
      >
      <div v-if="mockMode">
        <span>演示时间 {{ store.now.toLocaleString('zh-CN', { hour12: false }) }}</span
        ><button v-if="store.admin" @click="reset">恢复演示数据</button>
      </div>
    </div>
    <main v-if="store.data"><RouterView /></main>
    <main v-else class="loading-panel">正在载入校园信息…</main>
    <footer>
      <span>校园社团招新与竞赛信息一体化平台</span
      ><span>{{
        store.data?.identityMode === 'formal' ? '校园活动信息与报名' : '仅使用模拟账号与演示数据'
      }}</span>
    </footer>
  </div>
  <AuthDialog v-model="loginOpen" :initial="authInitial" />
  <el-drawer v-model="noticeOpen" title="站内信" size="440px" class="responsive-dialog"
    ><el-empty v-if="!store.data?.notices.length" description="暂时没有新消息" />
    <article
      v-for="n in store.data?.notices"
      :key="n.id"
      class="notice-item"
      :class="{ unread: !n.read }"
    >
      <span class="eyebrow"
        >{{ n.read ? '已读' : '未读' }} · {{ new Date(n.at).toLocaleString() }}</span
      >
      <p>{{ n.text }}</p>
      <el-button v-if="!n.read" size="small" @click="store.act('notice.read', { id: n.id })"
        >标为已读</el-button
      >
    </article></el-drawer
  >
</template>
