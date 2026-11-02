<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { http, mockMode } from '@/api/client'
import { usePlatform } from '@/stores/platform'
const open = defineModel<boolean>({ default: false })
const props = defineProps<{ initial?: 'login' | 'bind' | 'email-change' }>()
const store = usePlatform()
type Mode = 'login' | 'register' | 'password-reset' | 'bind' | 'email-change'
const mode = ref<Mode>('login'),
  busy = ref(false),
  sending = ref(false)
const provider = ref({
  mode: 'formal',
  emailAvailable: false,
  schoolAvailable: false,
  emailDomains: [] as string[],
})
const form = ref({ studentNo: '', password: '', email: '', name: '', code: '', challengeId: '' })
const retryAt = ref(0),
  tick = ref(Date.now())
const retry = computed(() => Math.max(0, Math.ceil((retryAt.value - tick.value) / 1000)))
const titles: Record<Mode, string> = {
  login: '登录平台',
  register: '校园邮箱注册',
  'password-reset': '找回密码',
  bind: '补充身份核验',
  'email-change': '更换绑定邮箱',
}
function useDemo(id: string) {
  form.value.studentNo = id
  form.value.password = 'Demo123!'
}
const interval = setInterval(() => {
  tick.value = Date.now()
}, 1000)
onUnmounted(() => clearInterval(interval))
watch(open, async (value) => {
  if (!value) return
  mode.value = props.initial || 'login'
  form.value.code = ''
  form.value.challengeId = ''
  try {
    provider.value = (await http.get('/auth/providers')).data
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
})
onMounted(async () => {
  try {
    provider.value = (await http.get('/auth/providers')).data
    if (provider.value.mode !== 'formal') {
      form.value.studentNo = '20260001'
      form.value.password = 'Demo123!'
    }
  } catch {
    /* Availability is shown when the dialog is opened. */
  }
})
function change(next: Mode) {
  mode.value = next
  form.value.code = ''
  form.value.challengeId = ''
}
async function send() {
  sending.value = true
  try {
    const r = (
      await http.post('/auth/email/challenges', {
        email: form.value.email,
        purpose: mode.value,
        password: ['bind', 'email-change'].includes(mode.value) ? form.value.password : undefined,
      })
    ).data
    form.value.challengeId = r.challengeId
    form.value.code = ''
    retryAt.value = Date.now() + r.retryAfter * 1000
    ElMessage.success(
      provider.value.mode === 'formal'
        ? '验证邮件已提交，请查看邮箱'
        : '测试邮件已投递，请查看测试收件箱',
    )
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    sending.value = false
  }
}
async function submit() {
  busy.value = true
  try {
    if (mode.value === 'login') {
      await store.login(form.value.studentNo, form.value.password)
      open.value = false
      ElMessage.success('登录成功')
      return
    }
    if (!form.value.challengeId) throw new Error('请先申请邮箱验证码')
    const endpoint =
      mode.value === 'register'
        ? '/auth/register'
        : mode.value === 'password-reset'
          ? '/auth/password/reset'
          : mode.value === 'bind'
            ? '/auth/identity/bind'
            : '/auth/email/change'
    const result = (
      await http.post(endpoint, {
        email: form.value.email,
        challengeId: form.value.challengeId,
        code: form.value.code,
        password: form.value.password,
        name: form.value.name,
      })
    ).data
    if (['bind', 'email-change'].includes(mode.value)) {
      await store.refresh()
      sessionStorage.removeItem('demo-session')
    }
    form.value.studentNo = form.value.email
    form.value.password = ''
    change('login')
    ElMessage.success(result.message || '操作成功，请重新登录')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <el-dialog v-model="open" :title="titles[mode]" width="440px" class="responsive-dialog">
    <p class="muted" v-if="mode === 'login'">使用平台密码登录。身份核验完成后可报名与加入团队。</p>
    <el-alert
      v-else-if="provider.mode !== 'formal'"
      :closable="false"
      type="warning"
      title="当前为测试环境，验证邮件不代表真实校园身份核验。"
    />
    <el-alert
      v-if="mode !== 'login' && !provider.emailAvailable"
      :closable="false"
      type="warning"
      title="邮箱核验服务暂不可用，请稍后再试。"
    />
    <el-form label-position="top" @submit.prevent="submit">
      <template v-if="mode === 'login'">
        <el-form-item label="学号 / 邮箱 / 管理员账号"
          ><el-input v-model="form.studentNo" autocomplete="username"
        /></el-form-item>
        <el-form-item label="密码"
          ><el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="current-password"
        /></el-form-item>
      </template>
      <template v-else>
        <el-form-item label="校园邮箱"
          ><el-input
            v-model="form.email"
            type="email"
            autocomplete="email"
            :placeholder="provider.emailDomains.join(' / ')"
        /></el-form-item>
        <el-form-item v-if="mode === 'register'" label="显示姓名"
          ><el-input v-model="form.name" maxlength="60" /><small class="muted"
            >仅用于页面展示。</small
          ></el-form-item
        >
        <el-form-item
          :label="
            ['bind', 'email-change'].includes(mode) ? '当前平台密码' : '设置平台密码（8～128字符）'
          "
          ><el-input
            v-model="form.password"
            type="password"
            show-password
            :autocomplete="
              ['bind', 'email-change'].includes(mode) ? 'current-password' : 'new-password'
            "
        /></el-form-item>
        <el-form-item label="邮箱验证码">
          <el-input
            v-model="form.code"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
          >
            <template #append
              ><el-button
                :loading="sending"
                :disabled="!provider.emailAvailable || retry > 0"
                @click="send"
                >{{ retry > 0 ? `${retry}秒后重发` : '发送验证码' }}</el-button
              ></template
            >
          </el-input>
        </el-form-item>
        <p class="muted">旧校邮按已确认规则绑定学号；新邮箱映射待确认时只开通公开浏览。</p>
      </template>
      <el-button
        native-type="submit"
        type="primary"
        class="full"
        :loading="busy"
        :disabled="mode !== 'login' && !provider.emailAvailable"
        >{{
          mode === 'login'
            ? '登录'
            : mode === 'register'
              ? '验证并注册'
              : mode === 'password-reset'
                ? '重置密码'
                : '确认核验'
        }}</el-button
      >
    </el-form>
    <div class="auth-links">
      <button v-if="mode !== 'login'" class="text-button" @click="change('login')">返回登录</button>
      <template v-else
        ><button class="text-button" @click="change('register')">校园邮箱注册</button
        ><button class="text-button" @click="change('password-reset')">忘记密码</button></template
      >
      <span class="muted">学校统一认证：暂未接入</span>
    </div>
    <p v-if="mockMode && mode !== 'login'" class="muted">
      <RouterLink to="/test-mail" target="_blank">打开浏览器模拟收件箱</RouterLink
      >（验证码申请会保留）
    </p>
    <div v-if="provider.mode !== 'formal' && mode === 'login'" class="demo-accounts">
      <b>演示账号 · 密码均为 Demo123!</b>
      <button
        v-for="a in [
          { n: '学生', id: '20260001' },
          { n: '队员', id: '20260002' },
          { n: '负责人', id: '20240001' },
          { n: '管理员', id: 'admin' },
        ]"
        :key="a.id"
        @click="useDemo(a.id)"
      >
        {{ a.n }} · {{ a.id }}
      </button>
    </div>
  </el-dialog>
</template>
<style scoped>
.auth-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-top: 12px;
}
.auth-links .muted {
  font-size: 12px;
  width: 100%;
}
</style>
