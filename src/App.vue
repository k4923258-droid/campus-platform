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
const store = usePlatform()
const router = useRouter()
const loginOpen = ref(false)
const register = ref(false)
const form = ref({ studentNo: '20260001', password: 'Demo123!', name: '' })
const loading = ref(false)
const noticeOpen = ref(false)
async function signIn() {
  loading.value = true
  try {
    if (register.value) await store.act('register', form.value)
    await store.login(form.value.studentNo, form.value.password)
    loginOpen.value = false
    ElMessage.success('登录成功')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
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
  loginOpen.value = true
}
let poll: ReturnType<typeof setInterval>
onMounted(async () => {
  window.addEventListener('campus-login', openLogin)
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
        ><button v-else class="button dark" @click="loginOpen = true">
          登录 / 注册 <ArrowUpRight :size="16" />
        </button>
      </div>
    </header>
    <div class="demo-bar">
      <span
        ><span class="status-dot" />{{
          mockMode ? '课程演示环境 · 使用模拟账号与数据' : '课程演示环境 · 仅供操作演示'
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
      <span>校园社团招新与竞赛信息一体化平台</span><span>仅使用模拟账号与演示数据</span>
    </footer>
  </div>
  <el-dialog
    v-model="loginOpen"
    :title="register ? '创建模拟账号' : '登录平台'"
    width="440px"
    class="responsive-dialog"
    ><p class="muted">登录后可报名、查看审核进度和站内信。</p>
    <el-form label-position="top" @submit.prevent="signIn"
      ><el-form-item v-if="register" label="姓名"><el-input v-model="form.name" /></el-form-item
      ><el-form-item label="学号 / 管理员账号"><el-input v-model="form.studentNo" /></el-form-item
      ><el-form-item label="密码"
        ><el-input v-model="form.password" type="password" show-password /></el-form-item
      ><el-button type="primary" native-type="submit" :loading="loading" class="full">{{
        register ? '注册并登录' : '登录'
      }}</el-button></el-form
    ><button class="text-button" @click="register = !register">
      {{ register ? '已有账号，去登录' : '创建模拟账号' }}
    </button>
    <div class="demo-accounts">
      <b>演示账号 · 密码均为 Demo123!</b
      ><button
        v-for="a in [
          { n: '学生', id: '20260001' },
          { n: '队员', id: '20260002' },
          { n: '负责人', id: '20240001' },
          { n: '管理员', id: 'admin' },
        ]"
        :key="a.id"
        @click="
          () => {
            form.studentNo = a.id
            form.password = 'Demo123!'
            register = false
          }
        "
      >
        {{ a.n }} · {{ a.id }}
      </button>
    </div></el-dialog
  >
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
