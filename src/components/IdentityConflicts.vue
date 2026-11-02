<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { http } from '@/api/client'
interface Conflict {
  id: string
  claimant_id: string
  existing_id: string
  student_no: string
  status: string
  reason: string
}
const items = ref<Conflict[]>([])
async function refresh() {
  items.value = (await http.get('/auth/identity-conflicts')).data.items
}
onMounted(() => refresh().catch((e) => ElMessage.error(e.message)))
async function resolve(item: Conflict) {
  try {
    const { value } = await ElMessageBox.prompt(
      '核对身份凭据后填写依据（至少10字）。原账号将停用，负责人和管理员权限不会转移。',
      '处理身份冲突',
      { inputValidator: (v) => String(v || '').trim().length >= 10 || '请填写至少10字的核验依据' },
    )
    const { value: ids } = await ElMessageBox.prompt(
      '仅迁移明确核准的报名ID，多个以逗号分隔；不迁移填“无”。',
      '选择历史数据范围',
      { inputValue: '无', inputValidator: (v) => !!v?.trim() || '请明确填写迁移范围' },
    )
    await http.post(`/auth/identity-conflicts/${item.id}/resolve`, {
      reason: value,
      transferApplicationIds: ids === '无' ? [] : ids.split(/[,，\s]+/).filter(Boolean),
    })
    await refresh()
    ElMessage.success('已处理，用户须重新登录')
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message)
  }
}
</script>
<template>
  <section>
    <h2>身份冲突处理</h2>
    <p class="muted">只处理已验证邮箱提出的冲突申请。核验身份、旧数据归属和迁移范围后再操作。</p>
    <el-button @click="refresh">刷新申请</el-button
    ><el-table :data="items"
      ><el-table-column prop="student_no" label="待绑定学号" /><el-table-column
        prop="claimant_id"
        label="申请用户ID"
      /><el-table-column prop="existing_id" label="原用户ID" /><el-table-column
        prop="status"
        label="状态"
      /><el-table-column label="操作"
        ><template #default="{ row }"
          ><el-button v-if="row.status === 'pending'" @click="resolve(row)"
            >核验并处理</el-button
          ></template
        ></el-table-column
      ></el-table
    >
  </section>
</template>
