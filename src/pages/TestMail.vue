<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { http, mockMode } from '@/api/client'
const items = ref<{ id: string; to: string; purpose: string; text: string; at: string }[]>([])
async function refresh() {
  if (mockMode) items.value = (await http.get('/demo/mail')).data.items
}
onMounted(refresh)
</script>
<template>
  <div class="page-wrap">
    <h1>浏览器模拟收件箱</h1>
    <p class="muted">仅用于模拟接口演示。Java 本地邮件测试请查看 Mailpit 收件箱。</p>
    <el-button v-if="mockMode" @click="refresh">刷新邮件</el-button
    ><el-empty v-if="!items.length" description="暂无模拟邮件" />
    <article v-for="m in items" :key="m.id" class="notice-item">
      <p>{{ m.to }} · {{ m.purpose }} · {{ m.at }}</p>
      <p>{{ m.text }}</p>
    </article>
  </div>
</template>
