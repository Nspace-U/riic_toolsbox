<script setup lang="ts">
import {
  BookOutlined,
  DatabaseOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import OperatorSkillCard from '@/components/OperatorSkillCard.vue'
import { useBaseData } from '@/composables/useBaseData'
import { useDataSource } from '@/composables/useDataSource'
import type { Operator, OperatorSkill, SkillTermReference } from '@/types/baseData'
import { getOperatorSkillTermKeys, getOperatorTerms } from '@/utils/operatorSkill'

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
  terms: SkillTermReference[]
  implementationOrder: number | undefined
  searchMatchedHiddenSkill: boolean
}
type PreparedSkill = {
  skill: OperatorSkill
  replaced: boolean
  searchText: string
}
type PreparedOperator = {
  operator: Operator
  skills: PreparedSkill[]
  terms: SkillTermReference[]
  searchText: string
  implementationOrder: number | undefined
}

const {
  operators,
  richTextStyles,
  terms,
  metadata,
  loading,
  assetsLoading,
  assetsReady,
  assetPreloadResult,
  errorMessage,
  ready,
  reload,
} = useBaseData()
const { selectedDataSource } = useDataSource()

const searchText = ref('')
const selectedFacilities = ref<string[]>([])
const showReplaced = ref(false)
const showOperatorId = ref(true)
const showTerms = ref(true)
const showTermDefinitions = ref(true)
const sortMode = ref<SortMode>('implementationOrder')
const expandedOperatorIds = ref(new Set<string>())
let filterUpdateTimer: number | undefined

const facilityOptions = FACILITIES.map((facility) => ({ label: facility, value: facility }))
const sortOptions = [
  { label: '实装倒序', value: 'implementationOrder' },
  { label: '名称正序', value: 'name' },
]

const normalizedSearchText = computed(() => searchText.value.trim().toLocaleLowerCase())

function isReplaced(skill: OperatorSkill): boolean {
  return skill.replacement.includes('被「')
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
  return operators.value.map((operator) => {
    const termsForOperator = getOperatorTerms(operator)

    const skills = operator.skills.map((skill) => ({
      skill,
      replaced: isReplaced(skill),
      searchText: [
        skill.name,
        skill.facility,
        skill.unlockCondition,
        skill.replacement,
        skill.description,
        ...getOperatorSkillTermKeys([skill]).flatMap((key) => {
          const reference = skill.termReferences.find((term) => term.key === key)
          return [key, reference?.name ?? '']
        }),
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
        ...termsForOperator.flatMap((term) => [term.key, term.name]),
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

    const visibleSkills = new Set(matchedSkills.map(({ skill }) => skill))
    const searchMatchedHiddenSkill = Boolean(query) && prepared.skills.some(({ skill, searchText }) => {
      return !visibleSkills.has(skill) && searchText.includes(query)
    })

    rows.push({
      operator: prepared.operator,
      skills: matchedSkills.map(({ skill }) => skill),
      terms: prepared.terms,
      implementationOrder: prepared.implementationOrder,
      searchMatchedHiddenSkill,
    })
  })

  return sortOperatorRows(rows)
}

const filteredOperatorRows = ref<OperatorDisplayRow[]>([])

function updateFilteredOperatorRows(): void {
  filterUpdateTimer = undefined
  const rows = buildFilteredOperatorRows()
  filteredOperatorRows.value = rows

  if (normalizedSearchText.value) {
    expandedOperatorIds.value = new Set(
      rows
        .filter((row) => row.searchMatchedHiddenSkill)
        .map((row) => row.operator.id),
    )
  }
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

const totalTermCount = computed(() => {
  return new Set(
    operators.value.flatMap((operator) => getOperatorTerms(operator).map((reference) => reference.key)),
  ).size
})

function handleReload(): void {
  void reload()
}

watch([searchText, selectedFacilities, showReplaced, sortMode], () => {
  clearExpandedOperators()
  scheduleFilteredOperatorUpdate()
})
watch(operators, scheduleFilteredOperatorUpdate, { immediate: true })

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
        <span v-else-if="assetsLoading">正在后台准备图片...</span>
        <span v-else-if="ready">
          已读取 {{ operators.length }} 名干员 · {{ totalSkillCount }} 条技能 · {{ totalTermCount }} 条术语
          <span v-if="metadata" class="operator-data-version">Torappu {{ metadata.clientVersion }} · {{ metadata.resVersion }}</span>
          <span v-if="assetPreloadResult?.failed" class="operator-data-version">
            {{ assetPreloadResult.failed }} 张图片读取失败
          </span>
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
        <a-checkbox v-model:checked="showReplaced">展开已被替换的技能</a-checkbox>
        <a-checkbox v-model:checked="showOperatorId">显示干员 ID</a-checkbox>
        <a-checkbox v-model:checked="showTerms">显示所属术语</a-checkbox>
        <a-checkbox v-model:checked="showTermDefinitions" :disabled="!showTerms">显示术语描述</a-checkbox>
        <span v-if="ready" class="operator-filter-count">当前显示 {{ filteredOperatorRows.length }} 名干员 · {{ visibleSkillCount }} 条技能</span>
      </div>
    </a-card>

    <a-spin :spinning="loading || assetsLoading" class="operator-data-spin" tip="正在准备干员资料...">
      <div v-if="ready && assetsReady && filteredOperatorRows.length" class="operator-list">
        <OperatorSkillCard
          v-for="row in filteredOperatorRows"
          :key="row.operator.id"
          v-memo="[row, isExpanded(row.operator), showOperatorId, showTerms, showTermDefinitions, searchText]"
          :data-source="selectedDataSource"
          :operator="row.operator"
          :operator-terms="row.terms"
          :show-operator-id="showOperatorId"
          :show-term-definitions="showTermDefinitions"
          :show-terms="showTerms"
          :rich-text-styles="richTextStyles"
          :search-text="searchText"
          :skills="row.operator.skills"
          :terms="terms"
          :visible-skills="row.skills"
          :expanded="isExpanded(row.operator)"
          show-expand-button
          class="operator-card"
          @toggle-expanded="toggleExpanded(row.operator)"
        >
        </OperatorSkillCard>
      </div>
      <a-empty v-else-if="ready && assetsReady" class="operator-empty" description="没有符合当前筛选条件的技能" />
    </a-spin>
  </div>
</template>
