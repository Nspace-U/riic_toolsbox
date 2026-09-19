<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import ScheduleLayoutEditor from "@/components/ScheduleLayoutEditor.vue";
import ScheduleOperatorPicker from "@/components/ScheduleOperatorPicker.vue";
import ScheduleOperatorSlot from "@/components/ScheduleOperatorSlot.vue";
import type { OperatorPickerCandidateView } from "@/components/OperatorPickerPanel.vue";
import type { EliteLevel, Operator } from "@/types/baseData";
import type {
  LayoutEntry,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import {
  ROOM_LABELS,
  ROOM_ORDER,
  ROOM_REPRESENTATIVE_COLORS,
  orderedLayoutEntries,
  parseLayoutText,
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
const selectedAddress = ref<SlotAddress>();
const editingAddress = ref<SlotAddress>();
const draftName = ref("");
const pointerDrag = ref<PointerDragState>();
const dragTargetKey = ref("");
const suppressNextClick = ref(false);
let layoutApplyTimer: ReturnType<typeof setTimeout> | undefined;

const fixedRoomTypeSet = computed(() => new Set(props.fixedRoomTypes));

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
  window.removeEventListener("click", handleWindowClick);
});

onMounted(() => {
  window.addEventListener("resize", updatePickerPosition);
  window.addEventListener("scroll", updatePickerPosition, true);
  window.addEventListener("click", handleWindowClick);
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

function applyLayoutText(text: string = layoutText.value): void {
  try {
    const requested = parseLayoutText(text);
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

function sameAddress(
  left: SlotAddress | undefined,
  right: SlotAddress | undefined,
): boolean {
  return left?.key !== undefined && left.key === right?.key;
}

function slotDisplayName(address: SlotAddress): string {
  return sameAddress(editingAddress.value, address)
    ? draftName.value
    : slotName(address);
}

function slotIsSelected(address: SlotAddress): boolean {
  return sameAddress(selectedAddress.value, address);
}

function slotIsEditing(address: SlotAddress): boolean {
  return sameAddress(editingAddress.value, address);
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
  if (editingAddress.value && !sameAddress(editingAddress.value, address)) {
    commitSlotEdit();
  }
  selectedAddress.value = address;
  if (pickerAddress.value && !sameAddress(pickerAddress.value, address)) {
    closePicker();
  }
}

function handleSlotDoubleClick(address: SlotAddress): void {
  handleSlotClick(address);
  editingAddress.value = address;
  draftName.value = slotName(address);
  openPicker(address);
}

function openPicker(address: SlotAddress): void {
  pickerAddress.value = address;
  selectedProfession.value = "";
  void nextTick(updatePickerPosition);
}

function commitSlotEdit(): void {
  const address = editingAddress.value;
  if (!address) return;
  if (draftName.value !== slotName(address)) {
    setSlotName(address, draftName.value.trim());
  }
  editingAddress.value = undefined;
  draftName.value = "";
}

function handleSlotInput(event: Event, address: SlotAddress): void {
  const value =
    event.target instanceof HTMLInputElement ? event.target.value : "";
  if (!slotIsEditing(address)) {
    editingAddress.value = address;
    draftName.value = slotName(address);
  }
  draftName.value = value;
}

function handleSlotInputClick(address: SlotAddress): void {
  if (!slotIsEditing(address)) handleSlotClick(address);
}

function handleWindowClick(event: MouseEvent): void {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(".simulator-operator-picker")
  ) {
    return;
  }
  if (
    target instanceof Element &&
    target.closest(".simulator-slot[data-key]")
  ) {
    return;
  }
  commitSlotEdit();
  closePicker();
  selectedAddress.value = undefined;
}

function closePicker(): void {
  pickerAddress.value = undefined;
  pickerStyle.value = {};
  selectedProfession.value = "";
}

function selectOperator(operator: Operator): void {
  const address = pickerAddress.value;
  if (!address) return;
  selectedAddress.value = address;
  editingAddress.value = address;
  draftName.value = operator.name;
  commitSlotEdit();
  closePicker();
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
</script>

<template>
  <div
    class="basic-calculator-schedule-editor"
    @pointercancel="handlePointerCancel"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
  >
    <ScheduleLayoutEditor
      :error="layoutError"
      :facility-colors="facilityColors"
      :fixed-room-levels="fixedRoomLevels"
      :fixed-room-types="fixedRoomTypes"
      :layout="modelValue.layout"
      :show-summary="false"
      :layout-text-footer="layoutTextHint()"
      @add-layout="addLayoutEntry"
      @apply-layout-text="applyLayoutText"
      @remove-layout="removeLayoutEntry"
      @update-layout-level="updateLayoutLevel"
    />

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
                <ScheduleOperatorSlot
                  v-for="slot in slotRefs(row)"
                  :key="`${row.type}-${slot.entry.position}-${slot.slotIndex}`"
                  class="basic-calculator-schedule-slot"
                  :display-name="slotDisplayName(slotAddress(slot, row.type))"
                  :elite-level="
                    operatorEliteLevel(
                      slotDisplayName(slotAddress(slot, row.type)),
                      row.type,
                    )
                  "
                  :name-input-pending="
                    slotIsSelected(slotAddress(slot, row.type)) &&
                    !slotIsEditing(slotAddress(slot, row.type))
                  "
                  :name-input-value="
                    slotDisplayName(slotAddress(slot, row.type))
                  "
                  :name-input-visible="
                    slotIsSelected(slotAddress(slot, row.type))
                  "
                  :name-editing="slotIsEditing(slotAddress(slot, row.type))"
                  :operator="
                    operatorFor(slotDisplayName(slotAddress(slot, row.type)))
                  "
                  :selected="slotIsSelected(slotAddress(slot, row.type))"
                  :size="76"
                  :slot-key="slotAddress(slot, row.type).key"
                  :special-label="
                    specialLabel(slotDisplayName(slotAddress(slot, row.type)))
                  "
                  :title="
                    slotDisplayName(slotAddress(slot, row.type)) ||
                    '点击选择干员，双击编辑'
                  "
                  :hovered="dragTargetKey === slotAddress(slot, row.type).key"
                  :room-label="row.label"
                  :room-type="row.type"
                  :position="slot.entry.position"
                  :slot-index="slot.slotIndex"
                  @blur="commitSlotEdit"
                  @click="handleSlotClick(slotAddress(slot, row.type))"
                  @contextmenu="clearSlot(slotAddress(slot, row.type))"
                  @dblclick="handleSlotDoubleClick(slotAddress(slot, row.type))"
                  @input="handleSlotInput($event, slotAddress(slot, row.type))"
                  @input-click="
                    handleSlotInputClick(slotAddress(slot, row.type))
                  "
                />
              </div>
            </div>
          </a-card>
        </div>
      </a-card>
    </div>

    <ScheduleOperatorPicker
      v-if="pickerAddress"
      :avatar-size="64"
      :candidates="pickerCandidates"
      :profession-options="pickerProfessionOptions"
      :selected-profession="selectedProfession"
      :style="pickerStyle"
      :title="pickerTitle"
      @outside="closePicker"
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
