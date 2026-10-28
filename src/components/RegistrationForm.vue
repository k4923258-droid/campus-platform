<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { usePlatform } from '@/stores/platform'
import { upload } from '@/api/client'
import type { Activity, Application } from '@/domain/types'
const props = defineProps<{ activity: Activity; existing?: Application }>()
const emit = defineEmits<{ saved: [] }>()
const s = usePlatform()
const answers = ref<Record<string, any>>({})
const memberText = ref('')
const confirmSoft = ref(false)
const uploading = ref(false)
watch(
  () => props.existing,
  () => {
    answers.value = JSON.parse(JSON.stringify(props.existing?.answers || {}))
    for (const f of props.activity.fields)
      if (f.type === 'checkbox' && !answers.value[f.id]) answers.value[f.id] = []
    memberText.value = (props.existing?.memberNos || [])
      .filter((n) => n !== s.me?.studentNo)
      .join('\n')
  },
  { immediate: true },
)
async function fileChanged(fieldId: string, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  try {
    answers.value[fieldId] = 'file:' + (await upload(file))
    await s.refresh()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    uploading.value = false
  }
}
async function submit() {
  try {
    await s.act('application.save', {
      id: props.existing?.id,
      activityId: props.activity.id,
      version: props.existing?.version,
      answers: answers.value,
      memberNos: memberText.value.split(/[\s,，]+/).filter(Boolean),
      confirmSoft: confirmSoft.value,
    })
    ElMessage.success('报名已保存，可在“我的报名”查看进度')
    emit('saved')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
</script>
<template>
  <el-form label-position="top" @submit.prevent="submit"
    ><el-alert
      v-if="existing"
      :title="'正在编辑报名 v' + existing.version + '；保存后原审核结论将失效并重新审核。'"
      type="warning"
      :closable="false"
    /><el-form-item
      v-if="activity.team"
      :label="`队员学号（每行一个，含队长共${activity.minTeam}—${activity.maxTeam}人）`"
      ><p class="muted full">
        队长：{{ s.me?.name }} / {{ s.me?.studentNo }}。队员无需逐一确认，可自行退出团队。
      </p>
      <el-input
        v-model="memberText"
        type="textarea"
        :rows="3"
        placeholder="例如：20260002" /></el-form-item
    ><el-form-item v-for="f in activity.fields" :key="f.id" :label="f.label" :required="f.required"
      ><el-input
        v-if="f.type === 'text' || f.type === 'textarea'"
        v-model="answers[f.id]"
        :type="f.type === 'textarea' ? 'textarea' : 'text'"
        :rows="3"
        :aria-label="f.label"
      /><el-input-number
        v-else-if="f.type === 'number'"
        v-model="answers[f.id]"
        :aria-label="f.label"
      /><el-radio-group v-else-if="f.type === 'radio'" v-model="answers[f.id]"
        ><el-radio v-for="o in f.options" :key="o" :value="o">{{ o }}</el-radio></el-radio-group
      ><el-checkbox-group v-else-if="f.type === 'checkbox'" v-model="answers[f.id]"
        ><el-checkbox v-for="o in f.options" :key="o" :value="o">{{
          o
        }}</el-checkbox></el-checkbox-group
      ><el-date-picker
        v-else-if="f.type === 'date'"
        v-model="answers[f.id]"
        type="date"
        value-format="YYYY-MM-DD"
        :aria-label="f.label"
      />
      <div v-else class="file-field">
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,application/zip,.zip"
          :aria-label="f.label"
          @change="fileChanged(f.id, $event)"
        /><small>{{
          s.data?.attachments.find((v) => 'file:' + v.id === answers[f.id])?.name ||
          '图片、PDF、ZIP，单文件不超过20MB'
        }}</small>
      </div></el-form-item
    >
    <div v-if="activity.softGrade || activity.softMaterial" class="soft-tip">
      <p>
        报名建议：{{ activity.softGrade ? '建议年级 ' + activity.softGrade : ''
        }}{{
          activity.softMaterial ? '；建议补充字段 ' + activity.softMaterial : ''
        }}。不满足仍可报名。
      </p>
      <el-checkbox v-model="confirmSoft">如未满足建议条件，我已了解并确认继续提交</el-checkbox>
    </div>
    <el-button native-type="submit" type="primary" :loading="s.busy || uploading" class="full">{{
      existing ? '保存修改并重新审核' : '确认提交报名'
    }}</el-button></el-form
  >
</template>
