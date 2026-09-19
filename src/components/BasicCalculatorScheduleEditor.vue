<script setup lang="ts">
import { DeleteOutlined } from "@ant-design/icons-vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import OperatorPickerPanel, {
  type OperatorPickerCandidateView,
} from "@/components/OperatorPickerPanel.vue";
import type { EliteLevel, Operator } from "@/types/baseData";
import type {
  LayoutEntry,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import {
  LAYOUT_TEXT_ROWS,
  ROOM_LABELS,
  ROOM_ORDER,
  ROOM_REPRESENTATIVE_COLORS,
  isFixedLevelRoom,
  orderedLayoutEntries,
  parseLayoutText,
  roomLevelRange,
  roomSlotCount,
} from "@/utils/schedule";
import {
  cascadeLayoutTypes,
  layoutAdditionPlan,
  layoutEntryLevelMax,
  layoutTextFor,
  layoutWithBuildChain,
  resizeRoomsForLayout,
  validateAddedLayout,
} from "@/utils/simulator/layout";

interface FacilityEntry {
  entry: LayoutEntry;
  index: number;
  position: number;
}

interface FacilityRow {
  key: string;
  type: RoomKey;
  label: string;
  entries: FacilityEntry[];
}

interface SlotRef {
  entry: FacilityEntry;
  slotIndex: number;
}

interface SlotAddress {
  type: RoomKey;
  position: number;
  slotIndex: number;
  key: string;
}

interface PointerDragState {
  source: SlotAddress;
  startX: number;
  startY: number;
  moved: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: ScheduleDocument;
    fixedRoomTypes?: RoomKey[];
    fixedRoomLevels?: Partial<Record<RoomKey, number>>;
    facilityColors?: Partial<Record<RoomKey, string>>;
    operatorCandidates: (type: RoomKey) => OperatorPickerCandidateView[];
    operatorFor: (name: string) => Operator | undefined;
    operatorEliteLevel: (name: string, type: RoomKey) => EliteLevel;
  }>(),
  {
    fixedRoomTypes: () => [],
    fixedRoomLevels: () => ({}),
    facilityColors: () => ({}),
  },
);

const emit = defineEmits<{
  "update:modelValue": [document: ScheduleDocument];
}>();

const layoutText = ref("");
const layoutError = ref("");
const pickerAddress = ref<SlotAddress>();
const pickerStyle = ref<Record<string, string>>({});
const selectedProfession = ref("");
const pointerDrag = ref<PointerDragState>();
const dragTargetKey = ref("");
const suppressNextClick = ref(false);
let layoutApplyTimer: ReturnType<typeof setTimeout> | undefined;

const fixedRoomTypeSet = computed(() => new Set(props.fixedRoomTypes));

const layoutRows = computed(() => {
  const indexedEntries = orderedLayoutEntries(props.modelValue.layout);
  return LAYOUT_TEXT_ROWS.map((types, rowIndex) => ({
    key: `basic-calculator-layout-row-${rowIndex}`,
    entries: types.flatMap((type) =>
      indexedEntries
        .filter((item) => item.entry.type === type)
        .map(({ entry, index }, position) => ({ entry, index, position })),
    ),
  }));
});

const facilityRows = computed<FacilityRow[]>(() =>
  ROOM_ORDER.map((type) => ({
    key: `basic-calculator-facility-${type}`,
    type,
    label: ROOM_LABELS[type],
    entries: orderedLayoutEntries(props.modelValue.layout)
      .filter(({ entry }) => entry.type === type)
      .map(({ entry, index }, position) => ({ entry, index, position })),
  })).filter((row) => row.entries.length > 0),
);

const pickerCandidates = computed(() => {
  const address = pickerAddress.value;
  if (!address) return [];
  return props
    .operatorCandidates(address.type)
    .filter(
      (candidate) =>
        !selectedProfession.value ||
        candidate.operator.profession === selectedProfession.value,
    );
});

const pickerTitle = computed(() =>
  pickerAddress.value
    ? `${ROOM_LABELS[pickerAddress.value.type]} · 选择干员`
    : "选择干员",
);

const pickerProfessionOptions = computed(() => {
  const values = new Set(
    props
      .operatorCandidates(pickerAddress.value?.type ?? "manufacture")
      .map((candidate) => candidate.operator.profession),
  );
  return [...values];
});

watch(
  () => props.modelValue.layout,
  (layout) => {
    layoutText.value = layoutTextFor(layout);
  },
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  if (layoutApplyTimer !== undefined) clearTimeout(layoutApplyTimer);
  window.removeEventListener("resize", updatePickerPosition);
  window.removeEventListener("scroll", updatePickerPosition, true);
});

onMounted(() => {
  window.addEventListener("resize", updatePickerPosition);
  window.addEventListener("scroll", updatePickerPosition, true);
});

function cloneDocument(): ScheduleDocument {
  return JSON.parse(JSON.stringify(props.modelValue)) as ScheduleDocument;
}

function emitDocument(document: ScheduleDocument): void {
  emit("update:modelValue", document);
}

function facilityStyle(type: RoomKey): Record<string, string> {
  return {
    "--simulator-facility-accent":
      props.facilityColors?.[type] ?? ROOM_REPRESENTATIVE_COLORS[type],
  };
}

function fixedLevel(type: RoomKey): number {
  return props.fixedRoomLevels?.[type] ?? layoutEntryLevelMax(type);
}

function layoutEntryIsFixed(entry: LayoutEntry): boolean {
  return fixedRoomTypeSet.value.has(entry.type);
}

function ensureFixedLayout(layout: LayoutEntry[]): LayoutEntry[] {
  const unfixed = layout.filter(
    (entry) => !fixedRoomTypeSet.value.has(entry.type),
  );
  const fixed = props.fixedRoomTypes.map((type) => ({
    type,
    level: fixedLevel(type),
  }));
  return layoutWithBuildChain([...unfixed, ...fixed]);
}

function layoutAddOptions(): Array<{
  type: RoomKey;
  label: string;
  disabled: boolean;
  reason: string;
}> {
  return ROOM_ORDER.map((type) => {
    if (fixedRoomTypeSet.value.has(type)) {
      return {
        type,
        label: ROOM_LABELS[type],
        disabled: true,
        reason: "该设施由当前组合固定",
      };
    }
    const plan = layoutAdditionPlan(props.modelValue.layout, type);
    if (!plan) {
      return {
        type,
        label: ROOM_LABELS[type],
        disabled: true,
        reason: fixedRoomTypeSet.value.has(type)
          ? "该设施由当前组合固定"
          : "当前设施无法添加",
      };
    }
    const extraTypes = plan.types.filter((entryType) => entryType !== type);
    return {
      type,
      label: ROOM_LABELS[type],
      disabled: false,
      reason: extraTypes.length
        ? `点击添加，将自动补建：${extraTypes
            .map((entryType) => ROOM_LABELS[entryType])
            .join("、")}`
        : "点击添加",
    };
  });
}

function addLayoutEntry(type: RoomKey): void {
  if (fixedRoomTypeSet.value.has(type)) return;
  const plan = layoutAdditionPlan(props.modelValue.layout, type);
  if (!plan) {
    layoutError.value = "当前设施无法添加";
    return;
  }
  const document = cloneDocument();
  plan.types.forEach((entryType) => {
    document.layout.push({
      type: entryType,
      level: layoutEntryLevelMax(entryType),
    });
  });
  document.layout = ensureFixedLayout(document.layout);
  document.plans.forEach((planEntry) =>
    resizeRoomsForLayout(planEntry, document.layout),
  );
  layoutError.value = "";
  emitDocument(document);
}

function applyLayoutText(): void {
  try {
    const requested = parseLayoutText(layoutText.value);
    const nextLayout = ensureFixedLayout(
      validateAddedLayout(layoutWithBuildChain(requested)),
    );
    const document = cloneDocument();
    document.layout = nextLayout;
    document.plans.forEach((plan) => resizeRoomsForLayout(plan, nextLayout));
    layoutError.value = "";
    layoutText.value = layoutTextFor(nextLayout);
    emitDocument(document);
  } catch (error: unknown) {
    layoutError.value = error instanceof Error ? error.message : "布局输入无效";
  }
}

function scheduleLayoutTextApply(text: string): void {
  if (layoutApplyTimer !== undefined) clearTimeout(layoutApplyTimer);
  if (text === layoutTextFor(props.modelValue.layout)) return;
  layoutApplyTimer = setTimeout(() => {
    layoutApplyTimer = undefined;
    if (layoutText.value === text) applyLayoutText();
  }, 300);
}

watch(layoutText, (text) => scheduleLayoutTextApply(text));

function updateLayoutLevel(index: number, value: number | null): void {
  if (value === null || layoutEntryIsFixed(props.modelValue.layout[index]!)) {
    return;
  }
  const document = cloneDocument();
  const entry = document.layout[index];
  if (!entry) return;
  entry.level = value;
  document.plans.forEach((plan) => resizeRoomsForLayout(plan, document.layout));
  emitDocument(document);
}

function removeLayoutEntry(index: number): void {
  const entry = props.modelValue.layout[index];
  if (!entry || layoutEntryIsFixed(entry)) {
    layoutError.value = "当前组合的核心设施不可删除";
    return;
  }
  const cascadedTypes = new Set(cascadeLayoutTypes(entry.type));
  const cascadedLabels = [...cascadedTypes]
    .filter((type) =>
      props.modelValue.layout.some((item) => item.type === type),
    )
    .map((type) => ROOM_LABELS[type]);
  if (
    cascadedLabels.length > 0 &&
    !window.confirm(
      `删除${ROOM_LABELS[entry.type]}后，将同时删除${cascadedLabels.join(
        "、",
      )}，确定吗？`,
    )
  ) {
    return;
  }
  const document = cloneDocument();
  document.layout = ensureFixedLayout(
    document.layout.filter(
      (item, itemIndex) => itemIndex !== index && !cascadedTypes.has(item.type),
    ),
  );
  document.plans.forEach((plan) => resizeRoomsForLayout(plan, document.layout));
  layoutError.value = "";
  emitDocument(document);
}

function slotRefs(row: FacilityRow): SlotRef[] {
  return row.entries.flatMap((entry) =>
    Array.from(
      { length: roomSlotCount(row.type, entry.entry.level) },
      (_, slotIndex) => ({
        entry,
        slotIndex,
      }),
    ),
  );
}

function roomAt(
  document: ScheduleDocument,
  type: RoomKey,
  position: number,
  ensure: boolean,
): RoomAssignment | undefined {
  const plan = document.plans[0];
  if (!plan) return undefined;
  const currentRooms = plan.rooms[type];
  const rooms = Array.isArray(currentRooms)
    ? (currentRooms as RoomAssignment[])
    : [];
  if (ensure) {
    const expected = document.layout.filter(
      (entry) => entry.type === type,
    ).length;
    while (rooms.length < expected) rooms.push({});
    plan.rooms[type] = rooms;
  }
  return rooms[position];
}

function slotAddress(slot: SlotRef, type: RoomKey): SlotAddress {
  return {
    type,
    position: slot.entry.position,
    slotIndex: slot.slotIndex,
    key: `${type}-${slot.entry.position}-${slot.slotIndex}`,
  };
}

function slotName(address: SlotAddress): string {
  return (
    roomAt(props.modelValue, address.type, address.position, false)
      ?.operators?.[address.slotIndex] ?? ""
  );
}

function setSlotName(address: SlotAddress, name: string): void {
  const document = cloneDocument();
  const room = roomAt(document, address.type, address.position, true);
  if (!room) return;
  const capacity = roomSlotCount(
    address.type,
    document.layout.filter((entry) => entry.type === address.type)[
      address.position
    ]?.level ?? 1,
  );
  const names = Array.from(
    { length: capacity },
    (_, index) => room.operators?.[index] ?? "",
  );
  names[address.slotIndex] = name;
  room.operators = names;
  emitDocument(document);
}

function swapSlotNames(source: SlotAddress, target: SlotAddress): void {
  const document = cloneDocument();
  const sourceRoom = roomAt(document, source.type, source.position, true);
  const targetRoom = roomAt(document, target.type, target.position, true);
  if (!sourceRoom || !targetRoom) return;
  const sourceCapacity = roomSlotCount(
    source.type,
    document.layout.filter((entry) => entry.type === source.type)[
      source.position
    ]?.level ?? 1,
  );
  const targetCapacity = roomSlotCount(
    target.type,
    document.layout.filter((entry) => entry.type === target.type)[
      target.position
    ]?.level ?? 1,
  );
  const sourceNames = Array.from(
    { length: sourceCapacity },
    (_, index) => sourceRoom.operators?.[index] ?? "",
  );
  const targetNames = Array.from(
    { length: targetCapacity },
    (_, index) => targetRoom.operators?.[index] ?? "",
  );
  const sourceName = sourceNames[source.slotIndex] ?? "";
  const targetName = targetNames[target.slotIndex] ?? "";
  if (sourceRoom === targetRoom) {
    sourceNames[source.slotIndex] = targetName;
    sourceNames[target.slotIndex] = sourceName;
    sourceRoom.operators = sourceNames;
    emitDocument(document);
    return;
  }
  sourceNames[source.slotIndex] = targetName;
  targetNames[target.slotIndex] = sourceName;
  sourceRoom.operators = sourceNames;
  targetRoom.operators = targetNames;
  emitDocument(document);
}

function clearSlot(address: SlotAddress): void {
  const current = slotName(address);
  if (!current) return;
  const document = cloneDocument();
  const room = roomAt(document, address.type, address.position, false);
  if (!room?.operators) return;
  room.operators[address.slotIndex] = "";
  room.operators = room.operators.map((name) => name ?? "");
  emitDocument(document);
}

function handleSlotClick(address: SlotAddress): void {
  if (suppressNextClick.value) {
    suppressNextClick.value = false;
    return;
  }
  pickerAddress.value = address;
  selectedProfession.value = "";
  void nextTick(updatePickerPosition);
}

function selectOperator(operator: Operator): void {
  const address = pickerAddress.value;
  if (!address) return;
  setSlotName(address, operator.name);
  pickerAddress.value = undefined;
  pickerStyle.value = {};
}

async function updatePickerPosition(): Promise<void> {
  const address = pickerAddress.value;
  if (!address) return;
  await nextTick();
  const slot = document.querySelector<HTMLElement>(
    `.basic-calculator-schedule-slot[data-key="${address.key}"]`,
  );
  const panel = document.querySelector<HTMLElement>(
    ".basic-calculator-schedule-editor .simulator-operator-picker",
  );
  if (!slot || !panel || pickerAddress.value?.key !== address.key) return;
  const slotRect = slot.getBoundingClientRect();
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const padding = 8;
  const maxTop = Math.max(padding, window.innerHeight - panelHeight - padding);
  const rightLeft = slotRect.right + padding;
  const leftLeft = slotRect.left - panelWidth - padding;
  const rightSpace = window.innerWidth - slotRect.right - padding;
  const leftSpace = slotRect.left - padding;
  const left = Math.min(
    Math.max(
      padding,
      rightSpace >= panelWidth || rightSpace >= leftSpace
        ? rightLeft
        : leftLeft,
    ),
    Math.max(padding, window.innerWidth - panelWidth - padding),
  );
  pickerStyle.value = {
    insetInlineStart: `${left}px`,
    insetBlockStart: `${Math.min(Math.max(padding, slotRect.top), maxTop)}px`,
  };
}

function slotFromTarget(target: EventTarget | null): SlotAddress | undefined {
  if (!(target instanceof Element)) return undefined;
  const slot = target.closest<HTMLElement>(".basic-calculator-schedule-slot");
  if (!slot) return undefined;
  const type = slot.dataset.type as RoomKey | undefined;
  const position = Number(slot.dataset.position);
  const slotIndex = Number(slot.dataset.slotIndex);
  if (!type || !Number.isInteger(position) || !Number.isInteger(slotIndex)) {
    return undefined;
  }
  return { type, position, slotIndex, key: slot.dataset.key ?? "" };
}

function handlePointerDown(event: PointerEvent): void {
  const address = slotFromTarget(event.target);
  if (!address || !slotName(address)) return;
  pointerDrag.value = {
    source: address,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
}

function handlePointerMove(event: PointerEvent): void {
  const state = pointerDrag.value;
  if (!state) return;
  if (
    Math.abs(event.clientX - state.startX) > 4 ||
    Math.abs(event.clientY - state.startY) > 4
  ) {
    state.moved = true;
  }
  if (!state.moved) return;
  const target = slotFromTarget(
    document.elementFromPoint(event.clientX, event.clientY),
  );
  dragTargetKey.value = target?.key ?? "";
  event.preventDefault();
}

function handlePointerUp(event: PointerEvent): void {
  const state = pointerDrag.value;
  if (!state) return;
  if (state.moved) {
    const target = slotFromTarget(
      document.elementFromPoint(event.clientX, event.clientY),
    );
    if (target && target.key !== state.source.key) {
      swapSlotNames(state.source, target);
    }
    suppressNextClick.value = true;
  }
  pointerDrag.value = undefined;
  dragTargetKey.value = "";
}

function handlePointerCancel(): void {
  pointerDrag.value = undefined;
  dragTargetKey.value = "";
  suppressNextClick.value = true;
}

function specialLabel(name: string): string | undefined {
  return props.operatorFor(name) ? undefined : name.slice(0, 2);
}

function slotStyle(): Record<string, string> {
  return { "--simulator-slot-size": "76px" };
}

function layoutTextHint(): string {
  return "数字顺序与排班模拟器一致；当前组合的控制中枢和核心工作设施会自动保留。";
}

function fixedLevelText(entry: LayoutEntry): string {
  return `Lv${entry.level}`;
}
</script>

<template>
  <div
    class="basic-calculator-schedule-editor"
    @pointercancel="handlePointerCancel"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
  >
    <div class="simulator-layout-add">
      <div class="simulator-layout-add-heading">
        <span class="simulator-summary-label">添加设施</span>
        <span class="simulator-layout-add-hint">点击设施卡片直接添加</span>
      </div>
      <div class="simulator-layout-add-grid">
        <a-button
          v-for="option in layoutAddOptions()"
          :key="option.type"
          :class="[
            'simulator-layout-add-card',
            { 'simulator-layout-add-card--disabled': option.disabled },
          ]"
          :disabled="option.disabled"
          :style="facilityStyle(option.type)"
          :title="option.reason"
          @click="addLayoutEntry(option.type)"
        >
          {{ option.label }}
        </a-button>
      </div>
    </div>

    <div class="simulator-layout-text-editor">
      <div class="simulator-layout-add-heading">
        <span class="simulator-summary-label">按数字批量设置</span>
        <span class="simulator-layout-add-hint"
          >每行按固定顺序填写设施等级</span
        >
      </div>
      <a-textarea
        v-model:value="layoutText"
        :auto-size="{ minRows: 2, maxRows: 2 }"
        class="simulator-layout-text-input"
        placeholder="33 33222\n1313 2111"
      />
      <div class="simulator-layout-text-footer">
        <span>{{ layoutTextHint() }}</span>
      </div>
      <a-alert
        v-if="layoutError"
        :message="layoutError"
        show-icon
        type="error"
      />
    </div>

    <div class="simulator-layout-list">
      <div
        v-for="row in layoutRows"
        :key="row.key"
        class="simulator-layout-row"
      >
        <div
          v-for="item in row.entries"
          :key="item.index"
          class="simulator-layout-card"
          :style="facilityStyle(item.entry.type)"
        >
          <span class="simulator-layout-card-name">
            {{ ROOM_LABELS[item.entry.type] }}
          </span>
          <div class="simulator-layout-card-actions">
            <span
              v-if="
                isFixedLevelRoom(item.entry.type) ||
                layoutEntryIsFixed(item.entry)
              "
              class="simulator-layout-card-level-text"
              >{{ fixedLevelText(item.entry) }}</span
            >
            <a-input-number
              v-else
              :max="layoutEntryLevelMax(item.entry.type)"
              :min="roomLevelRange(item.entry.type).min"
              :value="item.entry.level"
              addon-after="级"
              class="simulator-layout-card-level"
              @update:value="
                (value: number | null) => updateLayoutLevel(item.index, value)
              "
            />
            <a-button
              :disabled="layoutEntryIsFixed(item.entry)"
              aria-label="删除设施"
              danger
              :title="
                layoutEntryIsFixed(item.entry)
                  ? '当前组合设施不可删除'
                  : '删除设施'
              "
              type="text"
              @click="removeLayoutEntry(item.index)"
            >
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </div>
        </div>
      </div>
    </div>

    <div class="basic-calculator-schedule-facilities">
      <a-card
        v-for="row in facilityRows"
        :key="row.key"
        :bordered="false"
        class="simulator-column-card simulator-facility-card"
        :style="facilityStyle(row.type)"
      >
        <template #title>
          <div class="simulator-facility-title">
            <span>{{ row.label }}</span>
            <a-space :size="4" wrap>
              <a-tag
                v-for="entry in row.entries"
                :key="entry.index"
                color="gold"
              >
                Lv {{ entry.entry.level }}
              </a-tag>
            </a-space>
          </div>
        </template>
        <div class="simulator-facility-queues">
          <a-card
            :bordered="true"
            class="simulator-facility-queue"
            size="small"
          >
            <div class="simulator-facility-queue-content">
              <div class="simulator-slot-grid" :style="slotStyle()">
                <div
                  v-for="slot in slotRefs(row)"
                  :key="`${row.type}-${slot.entry.position}-${slot.slotIndex}`"
                  :class="[
                    'simulator-slot',
                    'basic-calculator-schedule-slot',
                    {
                      'simulator-slot--hovered':
                        dragTargetKey === slotAddress(slot, row.type).key,
                    },
                  ]"
                  :data-key="slotAddress(slot, row.type).key"
                  :data-position="slot.entry.position"
                  :data-slot-index="slot.slotIndex"
                  :data-type="row.type"
                  :title="
                    slotName(slotAddress(slot, row.type)) ||
                    '点击选择干员，右键清空'
                  "
                  @click.stop="handleSlotClick(slotAddress(slot, row.type))"
                  @contextmenu.stop.prevent="
                    clearSlot(slotAddress(slot, row.type))
                  "
                >
                  <OperatorAvatarDisplay
                    v-if="slotName(slotAddress(slot, row.type))"
                    :display-name="slotName(slotAddress(slot, row.type))"
                    :elite-level="
                      operatorEliteLevel(
                        slotName(slotAddress(slot, row.type)),
                        row.type,
                      )
                    "
                    :operator="
                      operatorFor(slotName(slotAddress(slot, row.type)))
                    "
                    :plain="true"
                    :proportional-layout="true"
                    :show-elite-level="true"
                    :show-name="true"
                    :show-profession="true"
                    :show-rarity="true"
                    :size="76"
                    :special-label="
                      specialLabel(slotName(slotAddress(slot, row.type)))
                    "
                  />
                  <template v-else>
                    <div class="simulator-empty-slot-frame" />
                    <span
                      class="simulator-empty-slot-name"
                      :style="{ width: '76px' }"
                    >
                      空槽位
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </a-card>
        </div>
      </a-card>
    </div>

    <OperatorPickerPanel
      v-if="pickerAddress"
      :avatar-size="64"
      :candidates="pickerCandidates"
      :profession-options="pickerProfessionOptions"
      :selected-profession="selectedProfession"
      :style="pickerStyle"
      :title="pickerTitle"
      @select="selectOperator"
      @update:selected-profession="selectedProfession = $event"
    />

    <div class="simulator-layout-summary">
      <span class="simulator-summary-label">设施布局</span>
      <a-tag v-for="row in facilityRows" :key="row.type" color="green">
        {{ row.label }} × {{ row.entries.length }}
      </a-tag>
    </div>
  </div>
</template>

<style scoped>
.basic-calculator-schedule-editor {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.basic-calculator-schedule-editor .simulator-layout-add,
.basic-calculator-schedule-editor .simulator-layout-text-editor {
  padding-block-end: 0;
  margin-block-end: 0;
}

.basic-calculator-schedule-editor .simulator-layout-text-editor {
  justify-items: stretch;
}

.basic-calculator-schedule-editor .simulator-layout-text-input {
  width: 100%;
}

.basic-calculator-schedule-facilities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
  min-width: 0;
}

.basic-calculator-schedule-facilities :deep(.simulator-facility-card) {
  min-width: 0;
}

.basic-calculator-schedule-facilities :deep(.simulator-facility-title) {
  min-width: 0;
}

.basic-calculator-schedule-facilities
  :deep(.simulator-facility-title > span:first-child) {
  flex: 0 1 auto;
}

.basic-calculator-schedule-facilities :deep(.simulator-facility-queue) {
  height: auto;
  min-height: 112px;
}

.basic-calculator-schedule-slot {
  touch-action: none;
}

.basic-calculator-schedule-slot :deep(.simulator-empty-slot-frame) {
  width: 76px;
  height: 76px;
}

.basic-calculator-schedule-slot :deep(.simulator-empty-slot-name) {
  height: 20px;
  line-height: 20px;
}

.basic-calculator-schedule-editor :deep(.simulator-operator-picker) {
  margin: 0;
}

@media (max-width: 720px) {
  .basic-calculator-schedule-facilities {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
