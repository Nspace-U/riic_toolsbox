<script setup lang="ts">
import {
  BookOutlined,
  DatabaseOutlined,
  DownOutlined,
  SearchOutlined,
  ReloadOutlined,
  UpOutlined,
} from '@ant-design/icons-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import RichTextDescription from '@/components/RichTextDescription.vue'
import LazyImage from '@/components/LazyImage.vue'
import SearchHighlight from '@/components/SearchHighlight.vue'
import { useBaseData } from '@/composables/useBaseData'
import { useDataSource } from '@/composables/useDataSource'
import type { BaseSkillTerm, Operator, OperatorSkill } from '@/types/baseData'
import { getOperatorAvatarFile, getOperatorAvatarSourceUrl } from '@/utils/operatorAvatar'

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

type SortMode = 'implementationOrder' | 'name'
type OperatorDisplayRow = {
  operator: Operator
  skills: OperatorSkill[]
  terms: Array<[string, BaseSkillTerm]>
  implementationOrder: number | undefined
}
type PreparedSkill = {
  skill: OperatorSkill
  replaced: boolean
  searchText: string
}
type PreparedOperator = {
  operator: Operator
  skills: PreparedSkill[]
  terms: Array<[string, BaseSkillTerm]>
  searchText: string
  implementationOrder: number | undefined
}

const { operators, terms, metadata, loading, errorMessage, ready, reload } = useBaseData()
const { selectedDataSource } = useDataSource()

const searchText = ref('')
const selectedFacilities = ref<string[]>([])
const showReplaced = ref(false)
const sortMode = ref<SortMode>('implementationOrder')
const expandedOperatorIds = ref(new Set<string>())
let filterUpdateTimer: number | undefined

const facilityOptions = FACILITIES.map((facility) => ({ label: facility, value: facility }))
const sortOptions = [
  { label: '实装倒序', value: 'implementationOrder' },
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

function operatorAvatarUrl(operator: Operator): string | undefined {
  const avatarFile = getOperatorAvatarFile(operator, 0)
  return avatarFile ? getOperatorAvatarSourceUrl(selectedDataSource.value, avatarFile) : undefined
}

function isReplaced(skill: OperatorSkill): boolean {
  return skill.replacement.includes('被「')
}

function termKeys(text: string): string[] {
  return [...text.matchAll(/\[T=([^\]]+)\][\s\S]*?\[\/T\]/g)].map((match) => match[1] ?? '')
}

function isExpanded(operator: Operator): boolean {
  return expandedOperatorIds.value.has(operator.id)
}

function isSkillVisible(row: OperatorDisplayRow, skill: OperatorSkill): boolean {
  return isExpanded(row.operator) || row.skills.includes(skill)
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

function sortOperatorRows(operatorRows: OperatorDisplayRow[]): OperatorDisplayRow[] {
  return operatorRows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (sortMode.value === 'name') {
        return left.row.operator.name.localeCompare(right.row.operator.name, 'zh-CN') || left.index - right.index
      }

      const leftOrder = left.row.implementationOrder
      const rightOrder = right.row.implementationOrder
      if (leftOrder === undefined || rightOrder === undefined) {
        if (leftOrder === undefined && rightOrder === undefined) {
          return left.index - right.index
        }
        return leftOrder === undefined ? 1 : -1
      }
      return rightOrder - leftOrder || left.index - right.index
    })
    .map(({ row }) => row)
}

const preparedOperators = computed<PreparedOperator[]>(() => {
  const termEntriesByMember = new Map<string, Array<[string, BaseSkillTerm]>>()
  Object.entries(terms.value).forEach(([key, term]) => {
    term.members.forEach((member) => {
      const entries = termEntriesByMember.get(member) ?? []
      entries.push([key, term])
      termEntriesByMember.set(member, entries)
    })
  })

  return operators.value.map((operator) => {
    const keys = new Set(operator.skills.flatMap((skill) => termKeys(skill.description)))
    const termsForOperator = [...keys]
      .map((key) => [key, terms.value[key]] as const)
      .filter((entry): entry is [string, BaseSkillTerm] => Boolean(entry[1]))
    ;(termEntriesByMember.get(operator.name) ?? []).forEach(([key, term]) => {
      if (!termsForOperator.some(([existingKey]) => existingKey === key)) {
        termsForOperator.push([key, term])
      }
    })

    const skills = operator.skills.map((skill) => ({
      skill,
      replaced: isReplaced(skill),
      searchText: [
        skill.name,
        skill.facility,
        skill.unlockCondition,
        skill.replacement,
        skill.description.replace(/\[(?:\/?(?:C|T)(?:=[^\]]+)?)\]/g, ''),
        ...termKeys(skill.description).flatMap((key) => [key, terms.value[key]?.name ?? '']),
      ].join(' ').toLocaleLowerCase(),
    }))

    return {
      operator,
      skills,
      terms: termsForOperator,
      searchText: [
        operator.name,
        operator.id,
        operator.profession,
        operator.branch,
        ...termsForOperator.flatMap(([key, term]) => [key, term.name]),
      ].join(' ').toLocaleLowerCase(),
      implementationOrder: operator.implementationOrder,
    }
  })
})

function buildFilteredOperatorRows(): OperatorDisplayRow[] {
  const query = normalizedSearchText.value
  const selected = new Set(selectedFacilities.value)
  const rows: OperatorDisplayRow[] = []

  preparedOperators.value.forEach((prepared) => {
    const facilitySkills = prepared.skills.filter(({ skill, replaced }) => {
      return (showReplaced.value || !replaced) && (!selected.size || selected.has(skill.facility))
    })
    if (facilitySkills.length === 0) {
      return
    }

    const matchesOperator = !query || prepared.searchText.includes(query)
    const matchedSkills = matchesOperator || !query
      ? facilitySkills
      : facilitySkills.filter(({ searchText }) => searchText.includes(query))
    if (matchedSkills.length === 0) {
      return
    }

    rows.push({
      operator: prepared.operator,
      skills: matchedSkills.map(({ skill }) => skill),
      terms: prepared.terms,
      implementationOrder: prepared.implementationOrder,
    })
  })

  return sortOperatorRows(rows)
}

const filteredOperatorRows = ref<OperatorDisplayRow[]>([])

function updateFilteredOperatorRows(): void {
  filterUpdateTimer = undefined
  filteredOperatorRows.value = buildFilteredOperatorRows()
}

function scheduleFilteredOperatorUpdate(): void {
  if (filterUpdateTimer !== undefined) {
    window.clearTimeout(filterUpdateTimer)
  }
  filterUpdateTimer = window.setTimeout(updateFilteredOperatorRows, 0)
}

const visibleSkillCount = computed(() => filteredOperatorRows.value.reduce((count, row) => count + row.skills.length, 0))

const totalSkillCount = computed(() => {
  return operators.value.reduce((count, operator) => count + operator.skills.length, 0)
})

function rarityLabel(operator: Operator): string {
  return operator.rarity > 0 ? `${operator.rarity}★` : '未知稀有度'
}

function handleReload(): void {
  void reload()
}

watch([searchText, selectedFacilities, showReplaced, sortMode], () => {
  clearExpandedOperators()
  scheduleFilteredOperatorUpdate()
})
watch([operators, terms], scheduleFilteredOperatorUpdate, { immediate: true })

onBeforeUnmount(() => {
  if (filterUpdateTimer !== undefined) {
    window.clearTimeout(filterUpdateTimer)
  }
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
        <span v-if="ready" class="operator-filter-count">当前显示 {{ filteredOperatorRows.length }} 名干员 · {{ visibleSkillCount }} 条技能</span>
      </div>
    </a-card>

    <a-spin :spinning="loading" class="operator-data-spin" tip="读取数据中...">
      <div v-if="ready && filteredOperatorRows.length" class="operator-list">
        <a-card
          v-for="row in filteredOperatorRows"
          :key="row.operator.id"
          v-memo="[row, isExpanded(row.operator)]"
          :bordered="false"
          class="operator-card"
        >
          <div class="operator-avatar-column">
            <LazyImage
              v-if="operatorAvatarUrl(row.operator)"
              :alt="`${row.operator.name}头像`"
              :src="operatorAvatarUrl(row.operator) || ''"
            />
            <div v-else class="operator-avatar-placeholder">暂无</div>
          </div>

          <div class="operator-profile-copy">
            <h3><SearchHighlight :query="searchText" :text="row.operator.name" /></h3>
            <span class="operator-id"><SearchHighlight :query="searchText" :text="row.operator.id" /></span>
            <div class="operator-tags">
              <a-tag color="gold"><SearchHighlight :query="searchText" :text="rarityLabel(row.operator)" /></a-tag>
              <a-tag color="blue"><SearchHighlight :query="searchText" :text="row.operator.profession || '未知职业'" /></a-tag>
              <a-tag v-if="row.operator.branch"><SearchHighlight :query="searchText" :text="row.operator.branch" /></a-tag>
            </div>
            <div v-if="row.terms.length" class="operator-terms">
              <span class="operator-terms-label">所属术语</span>
              <span class="operator-terms-list">
                <a-tooltip
                  v-for="([termKey, term]) in row.terms"
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
              v-for="skill in row.operator.skills"
              :key="`${skill.slot}-${skill.name}-${skill.unlockCondition}`"
              v-show="isSkillVisible(row, skill)"
              :class="{ 'operator-skill-row--replaced': isReplaced(skill) }"
              class="operator-skill-row"
            >
              <div class="skill-icon">
                <LazyImage
                  v-if="skill.iconFile"
                  :alt="`${skill.name}图标`"
                  :src="imageUrl('assets/raw/build_skill_icon', skill.iconFile)"
                />
                <span v-else>{{ skill.name.slice(0, 1) || '?' }}</span>
              </div>
              <div class="operator-skill-copy">
                <div class="operator-skill-meta">
                  <a-tag color="cyan"><SearchHighlight :query="searchText" :text="skill.unlockCondition || '未注明解锁条件'" /></a-tag>
                  <a-tag v-if="skill.facility" color="green"><SearchHighlight :query="searchText" :text="skill.facility" /></a-tag>
                  <a-tag v-if="isReplaced(skill)" color="orange">被替换</a-tag>
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
              v-if="row.operator.skills.length > row.skills.length || isExpanded(row.operator)"
              class="operator-hidden-skills-button"
              type="text"
              @click="toggleExpanded(row.operator)"
            >
              <template #icon>
                <UpOutlined v-if="isExpanded(row.operator)" />
                <DownOutlined v-else />
              </template>
              {{ isExpanded(row.operator) ? '折叠隐藏技能' : '展开隐藏技能' }}
            </a-button>
          </div>
        </a-card>
      </div>
      <a-empty v-else-if="ready" class="operator-empty" description="没有符合当前筛选条件的技能" />
    </a-spin>
  </div>
</template>
