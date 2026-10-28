import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { http, command, mockMode } from '@/api/client'
import type { Snapshot } from '@/domain/types'
export const usePlatform = defineStore('platform', () => {
  const data = ref<Snapshot>()
  const busy = ref(false)
  const me = computed(() => data.value?.me)
  const admin = computed(() => !!me.value?.roles.includes('admin'))
  const manager = computed(() => admin.value || !!me.value?.roles.includes('manager'))
  const now = computed(() => new Date(data.value?.now || Date.now()))
  async function refresh() {
    data.value = (await http.get('/snapshot')).data
  }
  async function login(studentNo: string, password: string) {
    if (!mockMode) await http.get('/csrf')
    const r = await http.post('/session', { studentNo, password })
    if (mockMode) sessionStorage.setItem('demo-session', r.data.token)
    await refresh()
  }
  async function logout() {
    await http.delete('/session')
    sessionStorage.removeItem('demo-session')
    await refresh()
  }
  async function act(action: string, p: unknown = {}) {
    busy.value = true
    try {
      const result = await command(action, p)
      await refresh()
      return result
    } finally {
      busy.value = false
    }
  }
  return { data, me, admin, manager, now, busy, refresh, login, logout, act }
})
