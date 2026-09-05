<script setup lang="ts">
import {
  BookOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import RichTextDescription from '@/components/RichTextDescription.vue'
import { useBaseData } from '@/composables/useBaseData'
import { useDataSource } from '@/composables/useDataSource'
import type { Operator, OperatorAvatars, OperatorSkill } from '@/types/baseData'
import { generateOperatorAvatarUrl } from '@/utils/operatorAvatar'

const FACILITIES = [
  '控制中枢',
  '贸易站',
  '制造站',
  '发电站',
  '会客室',
  '办公室',
  '加工站',
  '训练室',
  '宿舍',
]

const AVATAR_STAGE = { key: 'elite0' as keyof OperatorAvatars, label: '精0' }

type FacilitySelection = string | { value?: string | number }

const { operators, terms, metadata, loading, errorMessage, ready, reload } = useBaseData()
const { selectedDataSource } = useDataSource()

const searchText = ref('')
const selectedFacilities = ref<FacilitySelection[]>([])
const showReplaced = ref(true)
const generatedAvatarUrls = ref<Record<string, string>>({})
const avatarGenerationError = ref('')

const facilityOptions = FACILITIES.map((facility) => ({ label: facility, value: facility }))

const normalizedSearchText = computed(() => searchText.value.trim().toLocaleLowerCase())

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

function imageUrl(directory: string, fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/%2B/g, '+')
    .replace(/%26/g, '&')
  return assetUrl(`${directory}/${encodedFileName}`)
}

function facilityValue(selection: FacilitySelection): string {
  return typeof selection === 'string' ? selection : String(selection.value ?? '')
}

function isReplaced(skill: OperatorSkill): boolean {
  return skill.replacement.includes('被「')
}

function isVisibleSkill(skill: OperatorSkill): boolean {
  if (!showReplaced.value && isReplaced(skill)) {
    return false
  }
  return selectedFacilities.value.length === 0
    || selectedFacilities.value.some((selection) => facilityValue(selection) === skill.facility)
}

function skillSearchText(skill: OperatorSkill): string {
  return [
    skill.name,
    skill.facility,
    skill.unlockCondition,
    skill.replacement,
    skill.description.replace(/\[(?:\/?(?:C|T)(?:=[^\]]+)?)\]/g, ''),
  ]
    .join(' ')
    .toLocaleLowerCase()
}

function matchesSearch(operator: Operator): boolean {
  const query = normalizedSearchText.value
  if (!query) {
    return true
  }

  return operator.name.toLocaleLowerCase().includes(query)
    || operator.id.toLocaleLowerCase().includes(query)
    || operator.profession.toLocaleLowerCase().includes(query)
    || operator.skills.some((skill) => skillSearchText(skill).includes(query))
}

function visibleSkills(operator: Operator): OperatorSkill[] {
  return operator.skills.filter((skill) => isVisibleSkill(skill))
}

const filteredOperators = computed<Operator[]>(() => {
  return operators.value.filter((operator) => matchesSearch(operator) && visibleSkills(operator).length > 0)
})

const visibleSkillCount = computed(() => {
  return filteredOperators.value.reduce((count, operator) => count + visibleSkills(operator).length, 0)
})

const totalSkillCount = computed(() => {
  return operators.value.reduce((count, operator) => count + operator.skills.length, 0)
})

function rarityLabel(operator: Operator): string {
  return operator.rarity > 0 ? `${operator.rarity}★` : '未知稀有度'
}

function handleReload(): void {
  void reload()
}

function revokeGeneratedAvatarUrls(urls: Record<string, string>): void {
  Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
}

let avatarGenerationRequestId = 0

async function generateSkillAvatars(operatorList: Operator[]): Promise<void> {
  const requestId = ++avatarGenerationRequestId
  const dataSource = selectedDataSource.value
  avatarGenerationError.value = ''
  const transientUrls: string[] = []
  const generatedEntries = await Promise.all(operatorList.map(async (operator) => {
    try {
      const url = await generateOperatorAvatarUrl(operator, dataSource, {
        eliteLevel: 0,
        showRarity: true,
        showEliteLevel: true,
        showProfession: true,
        moodScattered: false,
      })
      if (url) {
        transientUrls.push(url)
      }
      return [operator.id, url] as const
    } catch {
      return [operator.id, undefined] as const
    }
  }))

  if (requestId !== avatarGenerationRequestId) {
    transientUrls.forEach((url) => URL.revokeObjectURL(url))
    return
  }

  const nextUrls: Record<string, string> = {}
  generatedEntries.forEach(([operatorId, url]) => {
    if (url) {
      nextUrls[operatorId] = url
    }
  })
  revokeGeneratedAvatarUrls(generatedAvatarUrls.value)
  generatedAvatarUrls.value = nextUrls
  if (Object.keys(nextUrls).length < operatorList.length && operatorList.length > 0) {
    avatarGenerationError.value = '部分干员头像生成失败，请检查头像资源是否可用'
  }
}

watch(
  [filteredOperators, selectedDataSource],
  ([operatorList]) => {
    void generateSkillAvatars(operatorList)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  avatarGenerationRequestId += 1
  revokeGeneratedAvatarUrls(generatedAvatarUrls.value)
})
</script>

<template>
  <div class="page-shell operator-skills-page">
    <div class="page-heading">
      <div class="page-heading-icon" aria-hidden="true">
        <BookOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title">基建技能一览</a-typography-title>
        <span class="page-heading-description">按数据源读取干员资料、基建技能与术语</span>
      </div>
    </div>

    <div class="operator-data-summary">
      <div class="operator-data-summary-copy">
        <DatabaseOutlined />
        <span v-if="loading">正在读取数据...</span>
        <span v-else-if="ready">
          已读取 {{ operators.length }} 名干员 · {{ totalSkillCount }} 条技能 · {{ Object.keys(terms).length }} 条术语
          <span v-if="metadata" class="operator-data-version">Torappu {{ metadata.clientVersion }} · {{ metadata.resVersion }}</span>
        </span>
        <span v-else>等待读取数据</span>
      </div>
      <a-button :loading="loading" type="text" @click="handleReload">
        <template #icon>
          <ReloadOutlined />
        </template>
        重新读取
      </a-button>
    </div>

    <a-alert
      v-if="errorMessage"
      :message="errorMessage"
      class="operator-data-error"
      show-icon
      type="error"
    />

    <a-alert
      v-if="avatarGenerationError"
      :message="avatarGenerationError"
      class="operator-data-error"
      show-icon
      type="warning"
    />

    <a-card :bordered="false" class="operator-filter-panel">
      <div class="operator-filter-grid">
        <a-input
          v-model:value="searchText"
          allow-clear
          placeholder="搜索干员、ID、职业、技能名称或描述"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input>
        <a-select
          v-model:value="selectedFacilities"
          :options="facilityOptions"
          allow-clear
          mode="multiple"
          placeholder="按设施筛选"
          :max-tag-count="'responsive'"
        />
      </div>
      <div class="operator-filter-footer">
        <a-checkbox v-model:checked="showReplaced">显示已被替换的技能</a-checkbox>
        <span v-if="ready" class="operator-filter-count">当前显示 {{ filteredOperators.length }} 名干员 · {{ visibleSkillCount }} 条技能</span>
      </div>
    </a-card>

    <a-spin :spinning="loading" class="operator-data-spin" tip="读取数据中...">
      <div v-if="ready && filteredOperators.length" class="operator-list">
        <a-card
          v-for="operator in filteredOperators"
          :key="operator.id"
          :bordered="false"
          class="operator-card"
        >
          <div class="operator-profile">
            <div class="operator-avatar-grid">
              <div class="operator-avatar-cell">
                <img
                  v-if="generatedAvatarUrls[operator.id]"
                  :alt="`${operator.name} ${AVATAR_STAGE.label}头像`"
                  :src="generatedAvatarUrls[operator.id]"
                  loading="lazy"
                />
                <div v-else class="operator-avatar-placeholder">{{ operator.avatars.elite0 ? '生成中' : '暂无' }}</div>
                <span>{{ AVATAR_STAGE.label }}</span>
              </div>
            </div>
            <div class="operator-profile-copy">
              <h3>{{ operator.name }}</h3>
              <span class="operator-id">{{ operator.id }}</span>
              <div class="operator-tags">
                <a-tag color="gold">{{ rarityLabel(operator) }}</a-tag>
                <a-tag color="blue">{{ operator.profession || '未知职业' }}</a-tag>
              </div>
              <span v-if="operator.branch" class="operator-branch">{{ operator.branch }}</span>
            </div>
          </div>

          <div class="operator-skills-list">
            <article v-for="skill in visibleSkills(operator)" :key="`${skill.slot}-${skill.name}-${skill.unlockCondition}`" class="operator-skill-row">
              <div class="skill-icon-frame">
                <img
                  v-if="skill.iconFile"
                  :alt="`${skill.name}图标`"
                  :src="imageUrl('assets/raw/build_skill_icon', skill.iconFile)"
                  loading="lazy"
                />
                <span v-else>{{ skill.name.slice(0, 1) || '?' }}</span>
              </div>
              <div class="operator-skill-copy">
                <div class="operator-skill-meta">
                  <a-tag>槽位 {{ skill.slot || '?' }}</a-tag>
                  <a-tag color="cyan">{{ skill.unlockCondition || '未注明解锁条件' }}</a-tag>
                  <a-tag v-if="skill.facility" color="green">{{ skill.facility }}</a-tag>
                  <a-tag v-if="isReplaced(skill)" color="orange">已被替换</a-tag>
                </div>
                <h4>{{ skill.name || '未命名技能' }}</h4>
                <div v-if="skill.replacement" class="skill-replacement">
                  <span>替换关系</span>
                  {{ skill.replacement }}
                </div>
                <RichTextDescription
                  v-if="skill.description"
                  :terms="terms"
                  :text="skill.description"
                />
              </div>
            </article>
          </div>
        </a-card>
      </div>
      <a-empty v-else-if="ready" class="operator-empty" description="没有符合当前筛选条件的技能" />
    </a-spin>
  </div>
</template>
