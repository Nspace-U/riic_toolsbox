<script setup lang="ts">
import {
  BookOutlined,
  DatabaseOutlined,
  DownOutlined,
  ReloadOutlined,
  SearchOutlined,
  UpOutlined,
} from '@ant-design/icons-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import RichTextDescription from '@/components/RichTextDescription.vue'
import SearchHighlight from '@/components/SearchHighlight.vue'
import { useBaseData } from '@/composables/useBaseData'
import { useDataSource } from '@/composables/useDataSource'
import type { BaseSkillTerm, Operator, OperatorAvatars, OperatorSkill } from '@/types/baseData'
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

const AVATAR_KEY: keyof OperatorAvatars = 'elite0'
type SortMode = 'implementationDate' | 'name'

const { operators, terms, metadata, loading, errorMessage, ready, reload } = useBaseData()
const { selectedDataSource } = useDataSource()

const searchText = ref('')
const selectedFacilities = ref<string[]>([])
const showReplaced = ref(false)
const sortMode = ref<SortMode>('implementationDate')
const expandedOperatorIds = ref(new Set<string>())
const generatedAvatarUrls = ref<Record<string, string>>({})
const avatarGenerationError = ref('')

const facilityOptions = FACILITIES.map((facility) => ({ label: facility, value: facility }))
const sortOptions = [
  { label: '实装时间倒序', value: 'implementationDate' },
  { label: '名称正序', value: 'name' },
]

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

function isReplaced(skill: OperatorSkill): boolean {
  return skill.replacement.includes('被「')
}

function isVisibleSkill(skill: OperatorSkill): boolean {
  if (!showReplaced.value && isReplaced(skill)) {
    return false
  }
  return selectedFacilities.value.length === 0 || selectedFacilities.value.includes(skill.facility)
}

function skillSearchText(skill: OperatorSkill): string {
  return [
    skill.name,
    skill.facility,
    skill.unlockCondition,
    skill.replacement,
    skill.description.replace(/\[(?:\/?(?:C|T)(?:=[^\]]+)?)\]/g, ''),
    ...termKeys(skill.description).flatMap((key) => [key, terms.value[key]?.name ?? '']),
  ]
    .join(' ')
    .toLocaleLowerCase()
}

function termKeys(text: string): string[] {
  return [...text.matchAll(/\[T=([^\]]+)\][\s\S]*?\[\/T\]/g)].map((match) => match[1] ?? '')
}

function operatorTermEntries(operator: Operator): Array<[string, BaseSkillTerm]> {
  const keys = new Set(operator.skills.flatMap((skill) => termKeys(skill.description)))
  Object.entries(terms.value).forEach(([key, term]) => {
    if (term.members.includes(operator.name)) {
      keys.add(key)
    }
  })
  return [...keys]
    .map((key) => [key, terms.value[key]] as const)
    .filter((entry): entry is [string, BaseSkillTerm] => Boolean(entry[1]))
}

function operatorSearchText(operator: Operator): string {
  return [
    operator.name,
    operator.id,
    operator.profession,
    operator.branch,
    ...operatorTermEntries(operator).flatMap(([key, term]) => [key, term.name]),
  ]
    .join(' ')
    .toLocaleLowerCase()
}

function matchesOperatorFields(operator: Operator): boolean {
  const query = normalizedSearchText.value
  return Boolean(query) && operatorSearchText(operator).includes(query)
}

function matchesSkill(skill: OperatorSkill): boolean {
  const query = normalizedSearchText.value
  return !query || skillSearchText(skill).includes(query)
}

function visibleSkills(operator: Operator): OperatorSkill[] {
  const skills = operator.skills.filter((skill) => isVisibleSkill(skill))
  if (!normalizedSearchText.value || matchesOperatorFields(operator)) {
    return skills
  }
  return skills.filter((skill) => matchesSkill(skill))
}

function displayedSkills(operator: Operator): OperatorSkill[] {
  return expandedOperatorIds.value.has(operator.id) ? operator.skills : visibleSkills(operator)
}

function hiddenSkillCount(operator: Operator): number {
  return operator.skills.length - visibleSkills(operator).length
}

function isExpanded(operator: Operator): boolean {
  return expandedOperatorIds.value.has(operator.id)
}

function toggleExpanded(operator: Operator): void {
  const nextIds = new Set(expandedOperatorIds.value)
  if (nextIds.has(operator.id)) {
    nextIds.delete(operator.id)
  } else {
    nextIds.add(operator.id)
  }
  expandedOperatorIds.value = nextIds
}

function clearExpandedOperators(): void {
  if (expandedOperatorIds.value.size > 0) {
    expandedOperatorIds.value = new Set()
  }
}

function toggleFacility(facility: string): void {
  const nextFacilities = new Set(selectedFacilities.value)
  if (nextFacilities.has(facility)) {
    nextFacilities.delete(facility)
  } else {
    nextFacilities.add(facility)
  }
  selectedFacilities.value = [...nextFacilities]
}

function selectAllFacilities(): void {
  selectedFacilities.value = []
}

function isAllFacilitiesSelected(): boolean {
  return selectedFacilities.value.length === 0
}

function implementationTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{2}:\d{2}))?$/)
  if (!match) {
    return undefined
  }
  const [, year, month, day, time] = match
  const normalizedValue = `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}${time ? `T${time}` : ''}`
  const timestamp = Date.parse(normalizedValue)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function sortOperators(operatorList: Operator[]): Operator[] {
  return operatorList
    .map((operator, index) => ({ operator, index }))
    .sort((left, right) => {
      if (sortMode.value === 'name') {
        return left.operator.name.localeCompare(right.operator.name, 'zh-CN') || left.index - right.index
      }

      const leftTimestamp = implementationTimestamp(left.operator.implementationDate)
      const rightTimestamp = implementationTimestamp(right.operator.implementationDate)
      if (leftTimestamp === undefined || rightTimestamp === undefined) {
        if (leftTimestamp === undefined && rightTimestamp === undefined) {
          return left.index - right.index
        }
        return leftTimestamp === undefined ? -1 : 1
      }
      return rightTimestamp - leftTimestamp || left.index - right.index
    })
    .map(({ operator }) => operator)
}

const filteredOperators = computed<Operator[]>(() => {
  return sortOperators(
    operators.value.filter((operator) => {
      const searchMatches = !normalizedSearchText.value
        || matchesOperatorFields(operator)
        || operator.skills.some((skill) => matchesSkill(skill))
      return searchMatches && displayedSkills(operator).length > 0
    }),
  )
})

const visibleSkillCount = computed(() => {
  return filteredOperators.value.reduce((count, operator) => count + displayedSkills(operator).length, 0)
})

const totalSkillCount = computed(() => {
  return operators.value.reduce((count, operator) => count + operator.skills.length, 0)
})

function rarityLabel(operator: Operator): string {
  return operator.rarity > 0 ? `${operator.rarity}★` : '未知稀有度'
}

function termsForOperator(operator: Operator): Array<[string, BaseSkillTerm]> {
  return operatorTermEntries(operator)
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
        showRarity: false,
        showEliteLevel: false,
        showProfession: false,
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

watch([searchText, selectedFacilities, showReplaced], clearExpandedOperators)

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
        <a-select v-model:value="sortMode" :options="sortOptions" aria-label="干员排序" />
      </div>
      <div class="operator-filter-section">
        <span class="operator-filter-label">设施</span>
        <div class="facility-filter-options">
          <a-button
            :type="isAllFacilitiesSelected() ? 'primary' : 'default'"
            @click="selectAllFacilities"
          >
            全部设施
          </a-button>
          <a-button
            v-for="facility in facilityOptions"
            :key="facility.value"
            :type="selectedFacilities.includes(facility.value) ? 'primary' : 'default'"
            @click="toggleFacility(facility.value)"
          >
            {{ facility.label }}
          </a-button>
        </div>
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
          <div class="operator-avatar-column">
            <img
              v-if="generatedAvatarUrls[operator.id]"
              :alt="`${operator.name}头像`"
              :src="generatedAvatarUrls[operator.id]"
              loading="lazy"
            />
            <div v-else class="operator-avatar-placeholder">{{ operator.avatars[AVATAR_KEY] ? '生成中' : '暂无' }}</div>
          </div>

          <div class="operator-profile-copy">
            <h3><SearchHighlight :query="searchText" :text="operator.name" /></h3>
            <span class="operator-id"><SearchHighlight :query="searchText" :text="operator.id" /></span>
            <div class="operator-tags">
              <a-tag color="gold"><SearchHighlight :query="searchText" :text="rarityLabel(operator)" /></a-tag>
              <a-tag color="blue"><SearchHighlight :query="searchText" :text="operator.profession || '未知职业'" /></a-tag>
              <a-tag v-if="operator.branch"><SearchHighlight :query="searchText" :text="operator.branch" /></a-tag>
            </div>
            <div v-if="termsForOperator(operator).length" class="operator-terms">
              <span class="operator-terms-label">所属术语</span>
              <span class="operator-terms-list">
                <a-tooltip
                  v-for="([termKey, term]) in termsForOperator(operator)"
                  :key="termKey"
                  placement="topLeft"
                >
                  <template #title>
                    <div class="term-tooltip-title">术语：{{ term.name }}</div>
                    <div v-if="term.definition" class="term-tooltip-definition">{{ term.definition }}</div>
                  </template>
                  <span class="term-text"><SearchHighlight :query="searchText" :text="term.name" /></span>
                </a-tooltip>
              </span>
            </div>
          </div>

          <div class="operator-skills-list">
            <article
              v-for="skill in displayedSkills(operator)"
              :key="`${skill.slot}-${skill.name}-${skill.unlockCondition}`"
              :class="{ 'operator-skill-row--replaced': isReplaced(skill) }"
              class="operator-skill-row"
            >
              <div class="skill-icon">
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
                  <a-tag color="cyan"><SearchHighlight :query="searchText" :text="skill.unlockCondition || '未注明解锁条件'" /></a-tag>
                  <a-tag v-if="skill.facility" color="green"><SearchHighlight :query="searchText" :text="skill.facility" /></a-tag>
                  <a-tag v-if="isReplaced(skill)" color="orange">已被替换</a-tag>
                </div>
                <h4><SearchHighlight :query="searchText" :text="skill.name || '未命名技能'" /></h4>
                <RichTextDescription
                  v-if="skill.description"
                  :highlight-query="searchText"
                  :terms="terms"
                  :text="skill.description"
                />
              </div>
            </article>
            <a-button
              v-if="hiddenSkillCount(operator) > 0 || isExpanded(operator)"
              class="operator-hidden-skills-button"
              type="text"
              @click="toggleExpanded(operator)"
            >
              <template #icon>
                <UpOutlined v-if="isExpanded(operator)" />
                <DownOutlined v-else />
              </template>
              {{ isExpanded(operator) ? '折叠隐藏技能' : '展开隐藏技能' }}
            </a-button>
          </div>
        </a-card>
      </div>
      <a-empty v-else-if="ready" class="operator-empty" description="没有符合当前筛选条件的技能" />
    </a-spin>
  </div>
</template>
