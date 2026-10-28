<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { usePlatform } from '@/stores/platform'
import { defaultStages, stageLabels, type Activity, type FieldType } from '@/domain/types'
import { upload } from '@/api/client'
const crypto = globalThis.crypto
const props = defineProps<{ activity?: Activity }>()
const emit = defineEmits<{ saved: [] }>()
const s = usePlatform()
const a = ref<Activity>(
  props.activity
    ? JSON.parse(JSON.stringify(props.activity))
    : {
        id: '',
        orgId:
          s.data?.organizations.find((o) => s.me?.orgIds.includes(o.id))?.id ||
          s.data!.organizations[0]!.id,
        title: '',
        body: '## 活动介绍\n\n欢迎参加。',
        poster: '',
        start: '2026-10-28T10:00:00+08:00',
        end: '2026-11-10T18:00:00+08:00',
        published: false,
        removed: false,
        external: false,
        externalGuide: '',
        team: false,
        minTeam: 2,
        maxTeam: 4,
        rolling: true,
        fields: [{ id: 'intro', label: '自我介绍', type: 'textarea', required: true, options: [] }],
        stages: defaultStages(),
        softGrade: '',
        softMaterial: '',
        resultPublished: false,
        resultVersion: 0,
      },
)
const locked = computed(() => s.data?.applications.some((r) => r.activityId === a.value.id))
const kinds: { value: FieldType; label: string }[] = [
  { value: 'text', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'radio', label: '单选' },
  { value: 'checkbox', label: '多选' },
  { value: 'date', label: '日期' },
  { value: 'file', label: '文件' },
]
async function save(published: boolean) {
  try {
    await s.act('activity.save', { ...a.value, published })
    ElMessage.success(published ? '活动已发布' : '草稿已保存')
    emit('saved')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
function move(i: number, d: number) {
  const items = a.value.fields
  const target = i + d
  if (target >= 0 && target < items.length) [items[i], items[target]] = [items[target]!, items[i]!]
}
async function poster(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    a.value.poster = 'file:' + (await upload(f))
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
</script>
<template>
  <el-form label-position="top"
    ><el-alert
      v-if="locked"
      title="已有报名：组织、报名方式、表单与审核规则已锁定。公告及截止时间变更会通知报名者。"
      type="warning"
      :closable="false"
    />
    <div class="form-grid">
      <el-form-item label="所属组织"
        ><el-select v-model="a.orgId" :disabled="locked"
          ><el-option
            v-for="o in s.data?.organizations.filter(
              (o) => o.enabled && (s.admin || s.me?.orgIds.includes(o.id)),
            )"
            :key="o.id"
            :label="o.name"
            :value="o.id" /></el-select></el-form-item
      ><el-form-item label="活动名称"><el-input v-model="a.title" /></el-form-item
      ><el-form-item label="报名开始"
        ><el-date-picker
          v-model="a.start"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item
      ><el-form-item label="报名截止"
        ><el-date-picker v-model="a.end" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ"
      /></el-form-item>
    </div>
    <el-form-item label="公告（Markdown）"
      ><el-input v-model="a.body" type="textarea" :rows="5" /></el-form-item
    ><el-form-item label="活动海报"
      ><input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        @change="poster"
      /><span v-if="a.poster">已选择海报</span
      ><el-button v-if="a.poster" link @click="a.poster = ''">移除</el-button></el-form-item
    >
    <div class="form-grid">
      <el-form-item label="报名渠道"
        ><el-switch
          v-model="a.external"
          :disabled="locked"
          active-text="仅外部指引"
          inactive-text="平台报名" /></el-form-item
      ><el-form-item v-if="!a.external" label="审核时机"
        ><el-radio-group v-model="a.rolling" :disabled="locked"
          ><el-radio :value="true">滚动审核</el-radio
          ><el-radio :value="false">截止后统一审核</el-radio></el-radio-group
        ></el-form-item
      >
    </div>
    <el-form-item v-if="a.external" label="外部官方链接或文字指引"
      ><el-input v-model="a.externalGuide" type="textarea" /></el-form-item
    ><template v-else
      ><el-form-item label="团队报名"
        ><el-switch v-model="a.team" :disabled="locked" /><span class="muted">
          适用于开启平台报名的竞赛</span
        ></el-form-item
      ><el-form-item v-if="a.team" label="团队人数范围（含队长）"
        ><el-input-number v-model="a.minTeam" :min="2" :disabled="locked" /> 至
        <el-input-number v-model="a.maxTeam" :min="a.minTeam" :disabled="locked"
      /></el-form-item>
      <h3>报名表字段</h3>
      <div v-for="(f, i) in a.fields" :key="f.id" class="field-config">
        <el-input v-model="f.label" placeholder="字段名称" :disabled="locked" /><el-select
          v-model="f.type"
          :disabled="locked"
          ><el-option
            v-for="k in kinds"
            :key="k.value"
            :label="k.label"
            :value="k.value" /></el-select
        ><el-checkbox v-model="f.required" :disabled="locked">必填</el-checkbox
        ><el-button :disabled="locked || i === 0" @click="move(i, -1)">↑</el-button
        ><el-button :disabled="locked || i === a.fields.length - 1" @click="move(i, 1)">↓</el-button
        ><el-button :disabled="locked" @click="a.fields.splice(i, 1)">删除</el-button
        ><el-input
          v-if="f.type === 'radio' || f.type === 'checkbox'"
          :model-value="f.options.join(',')"
          placeholder="选项以英文逗号分隔"
          :disabled="locked"
          @update:model-value="f.options = $event.split(',').filter(Boolean)"
        />
      </div>
      <el-button
        :disabled="locked"
        @click="
          a.fields.push({
            id: crypto.randomUUID(),
            label: '新字段',
            type: 'text',
            required: false,
            options: [],
          })
        "
        >＋ 添加字段</el-button
      >
      <h3>审核环节 · 固定顺序</h3>
      <div v-for="st in a.stages" :key="st.key" class="stage-config">
        <b>{{ stageLabels[st.key] }}</b
        ><el-checkbox v-model="st.enabled" :disabled="locked">启用</el-checkbox
        ><el-checkbox v-model="st.automatic" :disabled="locked || !st.enabled">默认通过</el-checkbox
        ><el-select v-model="st.mode" :disabled="locked || !st.enabled || st.automatic"
          ><el-option label="通过 / 不通过" value="pass" /><el-option
            label="100分制"
            value="score" /></el-select
        ><el-input-number
          v-if="st.mode === 'score'"
          v-model="st.threshold"
          :min="0"
          :max="100"
          :step="1"
          step-strictly
          :disabled="locked"
          aria-label="合格线"
        />
      </div>
      <div class="form-grid">
        <el-form-item label="建议年级（软提示，逗号分隔）"
          ><el-input v-model="a.softGrade" placeholder="大一,大二" /></el-form-item
        ><el-form-item label="建议提交材料（字段编号）"
          ><el-select v-model="a.softMaterial" clearable
            ><el-option
              v-for="f in a.fields"
              :key="f.id"
              :label="f.label"
              :value="f.id" /></el-select
        ></el-form-item></div
    ></template>
    <div class="row-actions">
      <el-button :loading="s.busy" @click="save(false)" :disabled="!!activity?.published"
        >保存草稿</el-button
      ><el-button type="primary" :loading="s.busy" @click="save(true)">{{
        activity?.published ? '保存变更' : '发布活动'
      }}</el-button>
    </div></el-form
  >
</template>
