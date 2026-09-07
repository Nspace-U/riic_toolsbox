<script setup lang="ts">
import {
  ClusterOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons-vue'
import { computed, ref } from 'vue'

import { useBaseData } from '@/composables/useBaseData'
import { useDataSource } from '@/composables/useDataSource'
import { useMaaDocuments } from '@/composables/useMaaDocuments'
import type { EliteLevel, Operator } from '@/types/baseData'
import type {
  MaaLayoutEntry,
  MaaOperatorState,
  MaaPlan,
  MaaRoomAssignment,
  MaaRoomKey,
  MaaScheduleDocument,
  StoredMaaDocument,
} from '@/types/maaSchedule'
import {
  MAA_PRODUCT_LABELS,
  MAA_ROOM_LABELS,
  MAA_ROOM_ORDER,
  MAA_SOURCE_MATERIAL_OPTIONS,
  cloneMaaSchedule,
  parseMaaScheduleText,
  roomSlotCount,
  serializeMaaSchedule,
  validateMaaSchedule,
} from '@/utils/maaSchedule'
import { getOperatorAvatarFile, getOperatorAvatarSourceUrl } from '@/utils/operatorAvatar'

interface FacilityEntry {
  entry: MaaLayoutEntry
  index: number
  position: number
}

interface FacilityRow {
  key: string
  type: MaaRoomKey
  label: string
  entries: FacilityEntry[]
}

interface DraftSlot {
  name: string
  mood: number | null
  elite: number | null
}

interface DraftRoom {
  position: number
  label: string
  slots: DraftSlot[]
}

const {
  documents,
  activeDocumentId,
  createDocument,
  getActiveDocument,
  setActiveDocument,
  updateDocument,
  removeDocument,
  duplicateDocument,
} = useMaaDocuments()
const { operators } = useBaseData()
const { selectedDataSource } = useDataSource()

const fileInput = ref<HTMLInputElement>()
const errorMessage = ref('')
const successMessage = ref('')
const editingPlanIndex = ref<number | null>(null)
const editingType = ref<MaaRoomKey>()
const editingRowKey = ref('')
const draftRooms = ref<DraftRoom[]>([])
const editorOpen = ref(false)

const activeDocument = computed(() => getActiveDocument())
const currentDocument = computed(() => activeDocument.value?.document)

const layoutGroups = computed(() => {
  const document = currentDocument.value
  if (!document) {
    return []
  }

  return MAA_ROOM_ORDER.map((type) => ({
    type,
    label: MAA_ROOM_LABELS[type],
    entries: document.layout.filter((entry) => entry.type === type),
  })).filter((group) => group.entries.length > 0)
})

const facilityRows = computed<FacilityRow[]>(() => {
  const document = currentDocument.value
  if (!document) {
    return []
  }

  const rows: FacilityRow[] = []
  MAA_ROOM_ORDER.forEach((type) => {
    const entries = document.layout
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.type === type)
      .map(({ entry, index }, position) => ({ entry, index, position }))
    if (!entries.length) {
      return
    }

    if (type === 'power') {
      rows.push({
        key: type,
        type,
        label: `${MAA_ROOM_LABELS[type]}（${entries.length}）`,
        entries,
      })
      return
    }

    entries.forEach((entry) => {
      const suffix = entries.length > 1 ? ` ${entry.position + 1}` : ''
      rows.push({
        key: `${type}-${entry.position}`,
        type,
        label: `${MAA_ROOM_LABELS[type]}${suffix}`,
        entries: [entry],
      })
    })
  })
  return rows
})

const extraRooms = computed(() => {
  const document = currentDocument.value
  if (!document) {
    return []
  }

  return document.plans.flatMap((plan, planIndex) => MAA_ROOM_ORDER.flatMap((type) => {
    const rooms = plan.rooms[type]
    if (!Array.isArray(rooms)) {
      return []
    }
    const expected = document.layout.filter((entry) => entry.type === type).length
    return rooms.slice(expected).map((room, offset) => ({
      planIndex,
      planName: plan.name || `队列${planIndex + 1}`,
      type,
      index: expected + offset,
      room: room as MaaRoomAssignment,
    }))
  }))
})

const baseOperatorOptions = computed(() => operators.value.map((operator) => ({
  value: operator.name,
  label: `${operator.name} · ${operator.id}`,
})))

function clearMessages(): void {
  errorMessage.value = ''
  successMessage.value = ''
}

function setError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : '操作失败'
  successMessage.value = ''
}

function updateCurrent(mutator: (document: MaaScheduleDocument) => void): void {
  const document = currentDocument.value
  const stored = activeDocument.value
  if (!document || !stored) {
    return
  }

  const candidate = cloneMaaSchedule(document)
  mutator(candidate)
  try {
    validateMaaSchedule(candidate)
  } catch (error: unknown) {
    setError(error)
    return
  }
  updateDocument(stored.id, (target) => {
    target.document = candidate
  })
}

function updateMeta(key: 'title' | 'description', value: string): void {
  updateCurrent((document) => {
    document[key] = value
  })
}

function updatePlanMeta(planIndex: number, key: 'name' | 'description', value: string): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex]
    if (plan) {
      plan[key] = value
    }
  })
}

function updatePlanDuration(planIndex: number, value: number | null): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex]
    if (plan) {
      plan.duration = value ?? undefined
    }
  })
}

function roomAt(plan: MaaPlan, type: MaaRoomKey, position: number): MaaRoomAssignment | undefined {
  const rooms = plan.rooms[type]
  return Array.isArray(rooms) ? rooms[position] as MaaRoomAssignment | undefined : undefined
}

function roomEntries(row: FacilityRow, plan: MaaPlan): Array<{ entry: FacilityEntry; room?: MaaRoomAssignment }> {
  return row.entries.map((entry) => ({
    entry,
    room: roomAt(plan, row.type, entry.position),
  }))
}

function roomOperators(row: FacilityRow, plan: MaaPlan): string[] {
  return roomEntries(row, plan).flatMap(({ room }) => room?.operators ?? [])
}

function firstEntryPosition(row: FacilityRow): number {
  return row.entries[0]?.position ?? 0
}

function roomProduct(room: MaaRoomAssignment | undefined): string {
  if (!room?.product) {
    return ''
  }
  return MAA_PRODUCT_LABELS[room.product] ?? room.product
}

function roomSource(room: MaaRoomAssignment | undefined): string {
  if (!room?.sourceMaterial) {
    return ''
  }
  return MAA_SOURCE_MATERIAL_OPTIONS.find((option) => option.value === room.sourceMaterial)?.label
    ?? room.sourceMaterial
}

function roomStatus(room: MaaRoomAssignment | undefined): string {
  if (room?.skip) {
    return '跳过换班'
  }
  if (!room || !room.operators?.length) {
    return '未配置干员'
  }
  return ''
}

function planDurationHours(plan: MaaPlan): string {
  const minutes = Number(plan.duration ?? 720)
  return `${(minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 小时`
}

function operatorByName(name: string): Operator | undefined {
  return operators.value.find((operator) => operator.name === name)
}

function operatorState(room: MaaRoomAssignment | undefined, name: string): MaaOperatorState {
  return room?.operatorStates?.[name] ?? {}
}

function avatarUrl(name: string, state: MaaOperatorState): string | undefined {
  const operator = operatorByName(name)
  if (!operator) {
    return undefined
  }
  const elite = Number.isInteger(state.elite) && state.elite !== undefined
    ? Math.max(0, Math.min(2, state.elite)) as EliteLevel
    : 0
  const file = getOperatorAvatarFile(operator, elite)
  return file ? getOperatorAvatarSourceUrl(selectedDataSource.value, file) : undefined
}

function stateTagText(room: MaaRoomAssignment | undefined, name: string): string[] {
  const state = operatorState(room, name)
  const tags: string[] = []
  if (typeof state.mood === 'number') {
    tags.push(`心情 ${state.mood}`)
  }
  if (typeof state.elite === 'number') {
    tags.push(`精英 ${state.elite}`)
  }
  return tags
}

function handleCreate(): void {
  clearMessages()
  createDocument()
  successMessage.value = '已新建排班表。'
}

function openFilePicker(): void {
  fileInput.value?.click()
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }

  clearMessages()
  try {
    const parsed = parseMaaScheduleText(await file.text())
    createDocument(parsed.document, parsed.inferredLayout, file.name)
    successMessage.value = parsed.inferredLayout
      ? '已导入，布局由文件内容推断。'
      : '已导入 Maa 排班表。'
  } catch (error: unknown) {
    setError(error)
  }
}

function handleDuplicate(): void {
  clearMessages()
  const document = activeDocument.value
  if (!document) {
    return
  }
  duplicateDocument(document.id)
  successMessage.value = '已复制排班表。'
}

function handleDelete(): void {
  const document = activeDocument.value
  if (!document) {
    return
  }
  if (!window.confirm(`确定删除“${document.document.title || '未命名排班表'}”吗？`)) {
    return
  }
  removeDocument(document.id)
  successMessage.value = '已删除排班表。'
}

function handleExport(): void {
  const document = currentDocument.value
  if (!document) {
    return
  }

  clearMessages()
  try {
    const json = serializeMaaSchedule(document)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${(document.title?.trim() || '排班模拟器').replace(/[\\/:*?"<>|]/g, '_')}.json`
    link.click()
    URL.revokeObjectURL(url)
    successMessage.value = '已导出严格 JSON 文件。'
  } catch (error: unknown) {
    setError(error)
  }
}

function roomLabel(type: MaaRoomKey, position: number, total: number): string {
  const suffix = total > 1 ? ` ${position + 1}` : ''
  return `${MAA_ROOM_LABELS[type]}${suffix}`
}

function openOperatorEditor(row: FacilityRow, planIndex: number): void {
  const plan = currentDocument.value?.plans[planIndex]
  if (!plan) {
    return
  }

  editingPlanIndex.value = planIndex
  editingType.value = row.type
  editingRowKey.value = row.key
  draftRooms.value = row.entries.map((entry) => {
    const room = roomAt(plan, row.type, entry.position)
    const names = room?.operators ?? []
    const capacity = roomSlotCount(row.type, entry.entry.level)
    return {
      position: entry.position,
      label: row.type === 'power'
        ? roomLabel(row.type, entry.position, row.entries.length)
        : row.label,
      slots: Array.from({ length: capacity }, (_, slotIndex) => {
        const name = names[slotIndex] ?? ''
        const state = operatorState(room, name)
        return {
          name,
          mood: typeof state.mood === 'number' ? state.mood : null,
          elite: typeof state.elite === 'number' ? state.elite : null,
        }
      }),
    }
  })
  editorOpen.value = true
}

function draftNameSet(excludedRoom: DraftRoom, excludedSlot: DraftSlot): Set<string> {
  const names = new Set<string>()
  draftRooms.value.forEach((room) => room.slots.forEach((slot) => {
    if (room === excludedRoom && slot === excludedSlot) {
      return
    }
    if (slot.name) {
      names.add(slot.name)
    }
  }))
  return names
}

function currentPlanNameSet(): Set<string> {
  const names = new Set<string>()
  const planIndex = editingPlanIndex.value
  const type = editingType.value
  const row = facilityRows.value.find((item) => item.key === editingRowKey.value)
  const plan = planIndex === null ? undefined : currentDocument.value?.plans[planIndex]
  if (!plan || !type || !row) {
    return names
  }

  MAA_ROOM_ORDER.forEach((roomType) => {
    const rooms = plan.rooms[roomType]
    if (!Array.isArray(rooms)) {
      return
    }
    rooms.forEach((room, position) => {
      const isEditingRoom = roomType === type && row.entries.some((entry) => entry.position === position)
      if (isEditingRoom) {
        return
      }
      ;(room as MaaRoomAssignment).operators?.forEach((name) => names.add(name))
    })
  })
  return names
}

function operatorOptionsFor(room: DraftRoom, slot: DraftSlot): Array<{ value: string; label: string; disabled?: boolean }> {
  const selectedElsewhere = draftNameSet(room, slot)
  const selectedInOtherRooms = currentPlanNameSet()
  const options = baseOperatorOptions.value.map((option) => ({
    ...option,
    disabled: selectedElsewhere.has(option.value) || selectedInOtherRooms.has(option.value),
  }))
  if (slot.name && !options.some((option) => option.value === slot.name)) {
    options.unshift({
      value: slot.name,
      label: `${slot.name}（未知干员）`,
      disabled: false,
    })
  }
  return options
}

function clearDraftState(slot: DraftSlot): void {
  if (!slot.name) {
    slot.mood = null
    slot.elite = null
  }
}

function saveOperatorEditor(): void {
  const planIndex = editingPlanIndex.value
  const type = editingType.value
  const row = facilityRows.value.find((item) => item.key === editingRowKey.value)
  if (planIndex === null || !type || !row) {
    editorOpen.value = false
    return
  }

  updateCurrent((document) => {
    const plan = document.plans[planIndex]
    if (!plan) {
      return
    }
    const rooms = Array.isArray(plan.rooms[type]) ? [...plan.rooms[type] as MaaRoomAssignment[]] : []
    row.entries.forEach((entry, entryIndex) => {
      const draft = draftRooms.value[entryIndex]
      if (!draft) {
        return
      }
      const operatorsForRoom: string[] = []
      const operatorStates: Record<string, MaaOperatorState> = {}
      draft.slots.forEach((slot) => {
        if (!slot.name) {
          return
        }
        operatorsForRoom.push(slot.name)
        const state: MaaOperatorState = {}
        if (slot.mood !== null) {
          state.mood = slot.mood
        }
        if (slot.elite !== null) {
          state.elite = slot.elite
        }
        if (Object.keys(state).length > 0) {
          operatorStates[slot.name] = state
        }
      })
      const room = rooms[entry.position] ?? {}
      if (operatorsForRoom.length > 0) {
        room.operators = operatorsForRoom
        delete room.skip
      } else {
        delete room.operators
        room.skip = true
      }
      if (Object.keys(operatorStates).length > 0) {
        room.operatorStates = operatorStates
      } else {
        delete room.operatorStates
      }
      rooms[entry.position] = room
    })
    plan.rooms[type] = rooms
  })
  if (!errorMessage.value) {
    editorOpen.value = false
    successMessage.value = '已更新干员组合。'
  }
}

function isStoredDocument(document: StoredMaaDocument): boolean {
  return document.id === activeDocumentId.value
}
</script>

<template>
  <div class="page-shell simulator-page">
    <div class="page-heading">
      <div class="page-heading-icon simulator-page-heading-icon" aria-hidden="true">
        <ClusterOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title">排班模拟器</a-typography-title>
        <span class="page-heading-description">按设施与队列查看 MAA 排班，保留干员状态与布局关系</span>
      </div>
    </div>

    <a-alert
      v-if="errorMessage"
      :message="errorMessage"
      class="simulator-alert"
      closable
      show-icon
      type="error"
      @close="errorMessage = ''"
    />
    <a-alert
      v-if="successMessage"
      :message="successMessage"
      class="simulator-alert"
      closable
      show-icon
      type="success"
      @close="successMessage = ''"
    />

    <div class="simulator-layout">
      <aside class="simulator-document-sidebar">
        <div class="simulator-sidebar-head">
          <div>
            <span class="simulator-eyebrow">SCHEDULES</span>
            <h3>排班表</h3>
          </div>
          <a-button aria-label="新建排班表" title="新建排班表" type="text" @click="handleCreate">
            <template #icon><PlusOutlined /></template>
          </a-button>
        </div>
        <div class="simulator-sidebar-actions">
          <a-button block @click="openFilePicker">
            <template #icon><UploadOutlined /></template>
            导入 JSON
          </a-button>
          <input ref="fileInput" accept=".json,application/json" hidden type="file" @change="handleFileChange">
        </div>
        <div class="simulator-document-list">
          <button
            v-for="document in documents"
            :key="document.id"
            :class="['simulator-document-item', { 'simulator-document-item--active': isStoredDocument(document) }]"
            type="button"
            @click="setActiveDocument(document.id)"
          >
            <span class="simulator-document-item-title">{{ document.document.title || '未命名排班表' }}</span>
            <span class="simulator-document-item-meta">
              {{ document.document.plans.length }} 个队列
              <span v-if="document.inferredLayout"> · 推断布局</span>
            </span>
          </button>
          <a-empty v-if="!documents.length" :image="undefined" description="暂无排班表" />
        </div>
      </aside>

      <main v-if="currentDocument" class="simulator-editor">
        <div class="simulator-editor-toolbar">
          <div class="simulator-toolbar-group">
            <a-button title="复制当前排班表" @click="handleDuplicate">
              <template #icon><CopyOutlined /></template>
              复制
            </a-button>
            <a-button danger title="删除当前排班表" @click="handleDelete">
              <template #icon><DeleteOutlined /></template>
              删除
            </a-button>
          </div>
          <a-button type="primary" @click="handleExport">
            <template #icon><DownloadOutlined /></template>
            导出 JSON
          </a-button>
        </div>

        <a-card :bordered="false" class="simulator-meta-panel">
          <div class="simulator-panel-heading">
            <div>
              <span class="simulator-eyebrow">SIMULATOR</span>
              <h3>排班信息</h3>
            </div>
            <a-tag color="cyan">{{ currentDocument.plans.length }} 个队列</a-tag>
          </div>
          <a-form layout="vertical">
            <div class="simulator-meta-grid">
              <a-form-item label="名称">
                <a-input
                  :value="currentDocument.title ?? ''"
                  @update:value="(value: string) => updateMeta('title', value)"
                />
              </a-form-item>
              <a-form-item label="描述">
                <a-textarea
                  :auto-size="{ minRows: 1, maxRows: 4 }"
                  :value="currentDocument.description ?? ''"
                  @update:value="(value: string) => updateMeta('description', value)"
                />
              </a-form-item>
            </div>
          </a-form>
          <div class="simulator-layout-summary">
            <span class="simulator-summary-label">设施布局</span>
            <a-tag v-for="group in layoutGroups" :key="group.type" color="green">
              {{ group.label }} × {{ group.entries.length }}
            </a-tag>
          </div>
        </a-card>

        <a-card :bordered="false" class="simulator-matrix-panel" title="设施排班">
          <template #extra>
            <span class="simulator-matrix-hint">横向滚动查看全部队列</span>
          </template>
          <div class="simulator-matrix-scroll">
            <div :style="{ '--simulator-queue-count': currentDocument.plans.length }" class="simulator-matrix">
              <div class="simulator-matrix-corner">设施</div>
              <div v-for="(plan, planIndex) in currentDocument.plans" :key="`head-${planIndex}`" class="simulator-queue-head">
                <div class="simulator-queue-head-main">
                  <a-typography-text strong>{{ plan.name || `队列${planIndex + 1}` }}</a-typography-text>
                  <a-tag color="blue">{{ planDurationHours(plan) }}</a-tag>
                </div>
                <a-input
                  :value="plan.description ?? ''"
                  class="simulator-queue-description"
                  placeholder="队列描述（可选）"
                  @update:value="(value: string) => updatePlanMeta(planIndex, 'description', value)"
                />
                <div class="simulator-queue-head-actions">
                  <a-input-number
                    :max="1440"
                    :min="60"
                    :value="plan.duration ?? 720"
                    addon-after="分钟"
                    size="small"
                    @update:value="(value: number | null) => updatePlanDuration(planIndex, value)"
                  />
                  <a-input
                    :value="plan.name ?? ''"
                    placeholder="队列名称"
                    size="small"
                    @update:value="(value: string) => updatePlanMeta(planIndex, 'name', value)"
                  />
                </div>
              </div>

              <template v-for="row in facilityRows" :key="row.key">
                <div class="simulator-facility-cell">
                  <div class="simulator-facility-cell-title">{{ row.label }}</div>
                  <div class="simulator-facility-cell-meta">
                    <a-tag v-for="entry in row.entries" :key="entry.index" color="gold">Lv {{ entry.entry.level }}</a-tag>
                  </div>
                </div>
                <div v-for="(plan, planIndex) in currentDocument.plans" :key="`${row.key}-${planIndex}`" class="simulator-plan-cell">
                  <div class="simulator-plan-cell-topline">
                    <a-space :size="4" wrap>
                      <template v-for="({ room }, entryIndex) in roomEntries(row, plan)" :key="`products-${entryIndex}`">
                        <a-tag v-if="roomProduct(room)" color="gold">{{ roomProduct(room) }}</a-tag>
                        <a-tag v-if="roomSource(room)" color="orange">{{ roomSource(room) }}</a-tag>
                      </template>
                    </a-space>
                    <a-button aria-label="编辑干员组合" title="编辑干员组合" type="text" @click="openOperatorEditor(row, planIndex)">
                      <template #icon><EditOutlined /></template>
                    </a-button>
                  </div>

                  <template v-if="row.type === 'power'">
                    <div v-for="({ entry, room }, entryIndex) in roomEntries(row, plan)" :key="`power-${entryIndex}`" class="simulator-power-group">
                      <span class="simulator-power-group-title">{{ roomLabel(row.type, entry.position, row.entries.length) }}</span>
                      <div v-if="room?.operators?.length" class="simulator-operator-list">
                        <div v-for="operator in room.operators" :key="operator" class="simulator-operator">
                          <a-avatar :size="38" :src="avatarUrl(operator, operatorState(room, operator))">
                            {{ operator.slice(0, 1) }}
                          </a-avatar>
                          <div class="simulator-operator-copy">
                            <span class="simulator-operator-name">{{ operator }}</span>
                            <a-space v-if="stateTagText(room, operator).length" :size="4" wrap>
                              <a-tag v-for="tag in stateTagText(room, operator)" :key="tag" color="blue">{{ tag }}</a-tag>
                            </a-space>
                          </div>
                        </div>
                      </div>
                      <a-tag v-else :color="roomStatus(room) === '跳过换班' ? 'default' : 'warning'">
                        {{ roomStatus(room) }}
                      </a-tag>
                    </div>
                  </template>
                  <template v-else>
                    <div v-if="roomOperators(row, plan).length" class="simulator-operator-list">
                      <div v-for="operator in roomOperators(row, plan)" :key="operator" class="simulator-operator">
                        <a-avatar :size="38" :src="avatarUrl(operator, operatorState(roomAt(plan, row.type, firstEntryPosition(row)), operator))">
                          {{ operator.slice(0, 1) }}
                        </a-avatar>
                        <div class="simulator-operator-copy">
                          <span class="simulator-operator-name">{{ operator }}</span>
                          <a-space
                            v-if="stateTagText(roomAt(plan, row.type, firstEntryPosition(row)), operator).length"
                            :size="4"
                            wrap
                          >
                            <a-tag
                              v-for="tag in stateTagText(roomAt(plan, row.type, firstEntryPosition(row)), operator)"
                              :key="tag"
                              color="blue"
                            >{{ tag }}</a-tag>
                          </a-space>
                        </div>
                      </div>
                    </div>
                    <a-tag v-else :color="roomStatus(roomAt(plan, row.type, firstEntryPosition(row))) === '跳过换班' ? 'default' : 'warning'">
                      {{ roomStatus(roomAt(plan, row.type, firstEntryPosition(row))) }}
                    </a-tag>
                  </template>
                </div>
              </template>
            </div>
          </div>
        </a-card>

        <a-alert
          v-if="extraRooms.length"
          :message="`发现 ${extraRooms.length} 个未登记设施实例`"
          class="simulator-anomaly-alert"
          show-icon
          type="warning"
        >
          <template #description>
            <div class="simulator-anomaly-list">
              <span v-for="item in extraRooms" :key="`${item.planIndex}-${item.type}-${item.index}`">
                {{ item.planName }} · {{ MAA_ROOM_LABELS[item.type] }} {{ item.index + 1 }}
                <template v-if="item.room.operators?.length">：{{ item.room.operators.join('、') }}</template>
              </span>
            </div>
          </template>
        </a-alert>
      </main>

      <a-empty v-else class="simulator-editor-empty" description="导入或新建一个排班表">
        <template #extra>
          <a-space>
            <a-button type="primary" @click="handleCreate">
              <template #icon><PlusOutlined /></template>
              新建排班表
            </a-button>
            <a-button @click="openFilePicker">
              <template #icon><UploadOutlined /></template>
              导入 JSON
            </a-button>
          </a-space>
        </template>
      </a-empty>
    </div>

    <a-modal
      v-model:open="editorOpen"
      ok-text="保存"
      title="编辑干员组合"
      width="680px"
      @ok="saveOperatorEditor"
    >
      <a-alert
        class="simulator-editor-modal-alert"
        description="同一队列内不能重复配置干员；空槽位保存后会从 JSON 中移除。"
        show-icon
        type="info"
      />
      <div class="simulator-draft-rooms">
        <section v-for="room in draftRooms" :key="room.position" class="simulator-draft-room">
          <div class="simulator-draft-room-title">{{ room.label }}</div>
          <div v-for="(slot, slotIndex) in room.slots" :key="slotIndex" class="simulator-draft-slot">
            <span class="simulator-draft-slot-label">槽位 {{ slotIndex + 1 }}</span>
            <a-select
              v-model:value="slot.name"
              :options="operatorOptionsFor(room, slot)"
              allow-clear
              class="simulator-draft-operator-select"
              option-filter-prop="label"
              placeholder="选择干员"
              show-search
              @change="clearDraftState(slot)"
            />
            <a-input-number
              v-model:value="slot.mood"
              :disabled="!slot.name"
              :max="24"
              :min="0"
              placeholder="心情"
              size="small"
            />
            <a-input-number
              v-model:value="slot.elite"
              :disabled="!slot.name"
              :max="2"
              :min="0"
              placeholder="精英"
              size="small"
            />
          </div>
        </section>
      </div>
    </a-modal>
  </div>
</template>