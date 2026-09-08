<script setup lang="ts">
import {
  ClusterOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons-vue'
import { computed, ref } from 'vue'

import { useBaseData } from '@/composables/useBaseData'
import { useDataSource } from '@/composables/useDataSource'
import { useMaaDocuments } from '@/composables/useMaaDocuments'
import OperatorAvatarDisplay from '@/components/OperatorAvatarDisplay.vue'
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
  DEFAULT_MAA_SOURCE_MATERIAL,
  MAA_PRODUCT_LABELS,
  MAA_PRODUCT_OPTIONS,
  MAA_ROOM_LABELS,
  MAA_ROOM_ORDER,
  MAA_ROOM_REPRESENTATIVE_COLORS,
  MAA_SOURCE_MATERIAL_OPTIONS,
  MAA_UNSUPPORTED_PRODUCT_LABELS,
  MaaScheduleError,
  cloneMaaSchedule,
  parseMaaScheduleText,
  roomSlotCount,
  serializeMaaSchedule,
  validateMaaSchedule,
} from '@/utils/maaSchedule'

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

interface FacilitySlotRef {
  entry: FacilityEntry
  slotIndex: number
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
const draftOperatorNames = ref<Record<string, string>>({})

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
  try {
    mutator(candidate)
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

function operatorSlotKey(planIndex: number, type: MaaRoomKey, position: number, slotIndex: number): string {
  return `${planIndex}-${type}-${position}-${slotIndex}`
}

function operatorNameAt(
  plan: MaaPlan,
  type: MaaRoomKey,
  position: number,
  slotIndex: number,
): string {
  return roomAt(plan, type, position)?.operators?.[slotIndex] ?? ''
}

function operatorDraftValue(
  plan: MaaPlan,
  planIndex: number,
  type: MaaRoomKey,
  position: number,
  slotIndex: number,
): string {
  const key = operatorSlotKey(planIndex, type, position, slotIndex)
  return draftOperatorNames.value[key] ?? operatorNameAt(plan, type, position, slotIndex)
}

function handleOperatorDraft(
  planIndex: number,
  type: MaaRoomKey,
  position: number,
  slotIndex: number,
  value: string,
): void {
  draftOperatorNames.value[operatorSlotKey(planIndex, type, position, slotIndex)] = value
}

function operatorElite(room: MaaRoomAssignment | undefined, name: string): EliteLevel {
  const state = operatorState(room, name)
  if (state.elite === 1 || state.elite === 2) {
    return state.elite
  }
  return 0
}

function slotRefs(row: FacilityRow): FacilitySlotRef[] {
  return row.entries.flatMap((entry) => Array.from(
    { length: roomSlotCount(row.type, entry.entry.level) },
    (_, slotIndex) => ({ entry, slotIndex }),
  ))
}

const SIMULATOR_SLOT_WIDTH = 72
const SIMULATOR_SLOT_GAP = 8
const SIMULATOR_FACILITY_MIN_WIDTH = 224

function facilityCardWidth(row: FacilityRow): string {
  const slotCount = Math.max(1, slotRefs(row).length)
  const contentWidth = slotCount * SIMULATOR_SLOT_WIDTH + (slotCount - 1) * SIMULATOR_SLOT_GAP
  return `${Math.max(SIMULATOR_FACILITY_MIN_WIDTH, contentWidth + 40)}px`
}

function facilityCardStyle(type: MaaRoomKey): Record<string, string> {
  return {
    '--simulator-facility-accent': MAA_ROOM_REPRESENTATIVE_COLORS[type],
  }
}

function slotRoom(plan: MaaPlan, slot: FacilitySlotRef): MaaRoomAssignment | undefined {
  return roomAt(plan, slot.entry.entry.type, slot.entry.position)
}

function slotName(row: FacilityRow, plan: MaaPlan, planIndex: number, slot: FacilitySlotRef): string {
  return operatorDraftValue(plan, planIndex, row.type, slot.entry.position, slot.slotIndex)
}

function slotOperator(row: FacilityRow, plan: MaaPlan, planIndex: number, slot: FacilitySlotRef): Operator | undefined {
  return operatorByName(slotName(row, plan, planIndex, slot))
}

function commitOperatorName(
  planIndex: number,
  type: MaaRoomKey,
  position: number,
  slotIndex: number,
): void {
  const document = currentDocument.value
  const plan = document?.plans[planIndex]
  if (!document || !plan) {
    return
  }

  const key = operatorSlotKey(planIndex, type, position, slotIndex)
  const nextName = draftOperatorNames.value[key]?.trim() ?? ''
  const previousName = operatorNameAt(plan, type, position, slotIndex)
  if (nextName === previousName) {
    delete draftOperatorNames.value[key]
    return
  }

  updateCurrent((candidate) => {
    const candidatePlan = candidate.plans[planIndex]
    if (!candidatePlan) {
      return
    }
    const rooms = Array.isArray(candidatePlan.rooms[type])
      ? [...candidatePlan.rooms[type] as MaaRoomAssignment[]]
      : []
    const room = rooms[position] ?? {}
    const capacity = candidate.layout.filter((entry) => entry.type === type)[position]
    const slotLimit = capacity ? roomSlotCount(type, capacity.level) : 0
    const names = Array.from({ length: slotLimit }, (_, index) => room.operators?.[index] ?? '')
    names[slotIndex] = nextName
    const compactNames = names.filter(Boolean)
    if (nextName) {
      const duplicate = Object.entries(candidatePlan.rooms).some(([roomType, roomList]) => {
        if (!Array.isArray(roomList)) {
          return false
        }
        return roomList.some((candidateRoom, roomPosition) => {
          const otherRoom = candidateRoom as MaaRoomAssignment
          return (roomType !== type || roomPosition !== position || otherRoom.operators?.indexOf(nextName) !== slotIndex)
            && otherRoom.operators?.includes(nextName)
        })
      })
      if (duplicate) {
        throw new MaaScheduleError(`干员“${nextName}”已在当前队列的其他设施中配置`)
      }
    }
    const nextStates: Record<string, MaaOperatorState> = {}
    compactNames.forEach((name) => {
      const state = room.operatorStates?.[name]
      if (state) {
        nextStates[name] = state
      }
    })
    room.operators = compactNames
    if (compactNames.length === 0) {
      room.skip = true
    } else {
      delete room.skip
    }
    if (Object.keys(nextStates).length > 0) {
      room.operatorStates = nextStates
    } else {
      delete room.operatorStates
    }
    rooms[position] = room
    candidatePlan.rooms[type] = rooms
  })
  if (!errorMessage.value) {
    delete draftOperatorNames.value[key]
  }
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

        <a-row :gutter="[10, 10]" class="simulator-facility-grid">
          <a-col class="simulator-queue-column" flex="0 0 220px">
            <a-card :bordered="false" class="simulator-column-card simulator-queue-card" title="队列信息">
              <div class="simulator-queue-entries">
                <div v-for="(plan, planIndex) in currentDocument.plans" :key="`queue-${planIndex}`" class="simulator-queue-info">
                  <div class="simulator-queue-info-main">
                    <a-input
                      :value="plan.name ?? ''"
                      class="simulator-queue-entry-title"
                      placeholder="队列名称"
                      size="small"
                      @update:value="(value: string) => updatePlanMeta(planIndex, 'name', value)"
                    />
                    <a-input-number
                      :max="1440"
                      :min="60"
                      :value="plan.duration ?? 720"
                      addon-after="分钟"
                      class="simulator-queue-duration"
                      size="small"
                      @update:value="(value: number | null) => updatePlanDuration(planIndex, value)"
                    />
                  </div>
                  <span class="simulator-queue-duration-summary">{{ planDurationHours(plan) }}</span>
                  <a-input
                    :value="plan.description ?? ''"
                    class="simulator-queue-description"
                    placeholder="队列描述（可选）"
                    size="small"
                    @update:value="(value: string) => updatePlanMeta(planIndex, 'description', value)"
                  />
                </div>
              </div>
            </a-card>
          </a-col>

          <a-col
            v-for="row in facilityRows"
            :key="row.key"
            :style="{ '--simulator-column-width': facilityCardWidth(row) }"
            class="simulator-facility-column"
          >
            <a-card
              :bordered="false"
              :class="['simulator-column-card', 'simulator-facility-card']"
              :style="facilityCardStyle(row.type)"
            >
              <template #title>
                <div class="simulator-facility-title">
                  <span>{{ row.label }}</span>
                  <a-space :size="4" wrap>
                    <a-tag v-for="entry in row.entries" :key="entry.index" color="gold">Lv {{ entry.entry.level }}</a-tag>
                  </a-space>
                </div>
              </template>
              <template #extra>
                <a-tag v-if="row.type === 'power'" color="cyan">合并显示</a-tag>
              </template>

              <div class="simulator-facility-queues">
                <a-card
                  v-for="(plan, planIndex) in currentDocument.plans"
                  :key="`${row.key}-${planIndex}`"
                  :bordered="true"
                  class="simulator-facility-queue"
                  size="small"
                >
                  <div class="simulator-facility-queue-content">
                    <div class="simulator-facility-queue-meta">
                      <a-space v-if="roomEntries(row, plan).some(({ room }) => roomProduct(room) || roomSource(room))" :size="4" wrap>
                        <template v-for="({ room }, entryIndex) in roomEntries(row, plan)" :key="`products-${entryIndex}`">
                          <a-tag v-if="roomProduct(room)" color="gold">{{ roomProduct(room) }}</a-tag>
                          <a-tag v-if="roomSource(room)" color="orange">{{ roomSource(room) }}</a-tag>
                        </template>
                      </a-space>
                      <a-tag
                        v-if="row.entries.some((entry) => roomStatus(roomAt(plan, row.type, entry.position)) === '跳过换班')"
                        color="default"
                      >
                        跳过换班
                      </a-tag>
                    </div>
                    <div class="simulator-slot-grid">
                      <div v-for="slot in slotRefs(row)" :key="`${planIndex}-${slot.entry.position}-${slot.slotIndex}`" class="simulator-slot">
                        <OperatorAvatarDisplay
                          v-if="slotOperator(row, plan, planIndex, slot)"
                          :data-source="selectedDataSource"
                          :elite-level="operatorElite(slotRoom(plan, slot), slotName(row, plan, planIndex, slot))"
                          :operator="slotOperator(row, plan, planIndex, slot)!"
                          :show-elite-level="true"
                          :show-name="false"
                          :show-profession="true"
                          :show-rarity="true"
                          :plain="true"
                          :size="72"
                        />
                        <a-avatar v-else :size="72" class="simulator-empty-avatar" shape="square">
                          {{ slotName(row, plan, planIndex, slot) || '空槽位' }}
                        </a-avatar>
                        <a-input
                          :value="slotName(row, plan, planIndex, slot)"
                          class="simulator-slot-input"
                          placeholder="干员名称"
                          @blur="commitOperatorName(planIndex, row.type, slot.entry.position, slot.slotIndex)"
                          @press-enter="commitOperatorName(planIndex, row.type, slot.entry.position, slot.slotIndex)"
                          @update:value="(value: string) => handleOperatorDraft(planIndex, row.type, slot.entry.position, slot.slotIndex, value)"
                        />
                      </div>
                    </div>
                  </div>
                </a-card>
              </div>
            </a-card>
          </a-col>
        </a-row>

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

  </div>
</template>