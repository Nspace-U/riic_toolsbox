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
import type { OperatorProgressionNode } from "@/types/operatorProgression";
import type {
  LayoutEntry,
  OperatorState,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import {
  DEFAULT_SOURCE_MATERIAL,
  PRODUCT_OPTIONS,
  ROOM_LABELS,
  ROOM_ORDER,
  ROOM_REPRESENTATIVE_COLORS,
  SOURCE_MATERIAL_OPTIONS,
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
import { operatorPasteAssignments } from "@/utils/simulator/operatorClipboard";

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
interface OperatorProgressionInfo {
  nodes: OperatorProgressionNode[];
  current: { elite: number; level: number };
  hasManualProgression: boolean;
}
interface PointerInteraction {
  mode: "press" | "box" | "move";
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startAddress?: SlotAddress;
  sourceAddresses: SlotAddress[];
  additive: boolean;
}
interface ClipboardEntry {
  name: string;
  state?: OperatorState;
}
interface ClipboardState {
  mode: "copy" | "cut";
  entries: ClipboardEntry[];
  sourceAddresses: SlotAddress[];
}
interface HistoryEntry {
  before: ScheduleDocument;
  after: ScheduleDocument;
}
interface ContextMenuState extends SlotAddress {
  scope: "operator" | "room";
  positions: number[];
  x: number;
  y: number;
}
interface ContextMenuItem {
  key: string;
  label: string;
  check?: boolean;
  disabled?: boolean;
  divider?: boolean;
  action?: () => void;
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
    operatorProgression?: (
      name: string,
      type: RoomKey,
      state: OperatorState,
    ) => OperatorProgressionInfo | undefined;
  }>(),
  {
    fixedRoomTypes: () => [],
    fixedRoomLevels: () => ({}),
    facilityColors: () => ({}),
    operatorProgression: undefined,
  },
);

const emit = defineEmits<{
  "update:modelValue": [document: ScheduleDocument];
}>();
const editorElement = ref<HTMLElement>();
const layoutText = ref("");
const layoutError = ref("");
const pickerAddress = ref<SlotAddress>();
const pickerStyle = ref<Record<string, string>>({});
const selectedProfession = ref("");
const selectedAddresses = ref<Set<string>>(new Set());
const selectionAnchor = ref<SlotAddress>();
const hoveredAddress = ref<SlotAddress>();
const editingAddress = ref<SlotAddress>();
const draftName = ref("");
const pointerInteraction = ref<PointerInteraction>();
const dragTargetKey = ref("");
const clipboard = ref<ClipboardState>();
const pasteHighlightKeys = ref<Set<string>>(new Set());
const contextMenu = ref<ContextMenuState>();
const contextMenuElement = ref<HTMLElement>();
const selectAllStage = ref<0 | 1 | 2>(0);
const undoHistory = ref<HistoryEntry[]>([]);
const redoHistory = ref<HistoryEntry[]>([]);
const selectionMarquee = ref({ left: 0, top: 0, width: 0, height: 0 });
const suppressNextClick = ref(false);
let layoutApplyTimer: ReturnType<typeof setTimeout> | undefined;
let pasteHighlightTimer: ReturnType<typeof setTimeout> | undefined;

const fixedRoomTypeSet = computed(() => new Set(props.fixedRoomTypes));
const facilityRows = computed<FacilityRow[]>(() => {
  const rows: FacilityRow[] = [];
  ROOM_ORDER.forEach((type) => {
    const entries = orderedLayoutEntries(props.modelValue.layout)
      .filter(({ entry }) => entry.type === type)
      .map(({ entry, index }, position) => ({ entry, index, position }));
    if (!entries.length) return;
    if (type === "power") {
      rows.push({
        key: type,
        type,
        label: ROOM_LABELS[type] + "（" + entries.length + "）",
        entries,
      });
    } else {
      entries.forEach((entry) =>
        rows.push({
          key: type + "-" + entry.position,
          type,
          label:
            ROOM_LABELS[type] +
            (entries.length > 1 ? " " + (entry.position + 1) : ""),
          entries: [entry],
        }),
      );
    }
  });
  return rows;
});
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
    ? ROOM_LABELS[pickerAddress.value.type] + " · 选择干员"
    : "选择干员",
);
const pickerProfessionOptions = computed(() => [
  ...new Set(
    props
      .operatorCandidates(pickerAddress.value?.type ?? "manufacture")
      .map((candidate) => candidate.operator.profession),
  ),
]);
const selectionMarqueeStyle = computed<Record<string, string>>(() => ({
  insetInlineStart: selectionMarquee.value.left + "px",
  insetBlockStart: selectionMarquee.value.top + "px",
  width: selectionMarquee.value.width + "px",
  height: selectionMarquee.value.height + "px",
}));
const contextMenuSections = computed(() => {
  const menu = contextMenu.value;
  if (!menu)
    return [] as Array<{
      key: string;
      title: string;
      items: ContextMenuItem[];
    }>;
  const items = roomContextMenuItems(menu.type, menu.positions);
  return items.length
    ? [{ key: "room-" + menu.type, title: ROOM_LABELS[menu.type], items }]
    : [];
});
const operatorContextMenuDetails = computed(() => {
  const menu = contextMenu.value;
  if (!menu || menu.scope !== "operator") return undefined;
  const name = slotName(menu);
  const operator = props.operatorFor(name);
  if (!name || !operator) return undefined;
  const room = roomAt(props.modelValue, menu.type, menu.position, false);
  const state = room?.operatorStates?.[name] ?? {};
  return {
    name,
    operator,
    state,
    progression: props.operatorProgression?.(name, menu.type, state),
  };
});

watch(
  () => props.modelValue.layout,
  (layout) => {
    layoutText.value = layoutTextFor(layout);
  },
  { deep: true, immediate: true },
);

onMounted(() => {
  window.addEventListener("resize", updatePickerPosition);
  window.addEventListener("scroll", updatePickerPosition, true);
  window.addEventListener("click", handleWindowClick);
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener("selectstart", handleWindowSelectStart);
});
onBeforeUnmount(() => {
  if (layoutApplyTimer !== undefined) clearTimeout(layoutApplyTimer);
  if (pasteHighlightTimer !== undefined) clearTimeout(pasteHighlightTimer);
  window.removeEventListener("resize", updatePickerPosition);
  window.removeEventListener("scroll", updatePickerPosition, true);
  window.removeEventListener("click", handleWindowClick);
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener("selectstart", handleWindowSelectStart);
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function cloneDocument(): ScheduleDocument {
  return clone(props.modelValue);
}
function updateDocument(update: (document: ScheduleDocument) => void): boolean {
  const before = cloneDocument();
  const after = cloneDocument();
  update(after);
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  undoHistory.value = [
    ...undoHistory.value.slice(-49),
    { before, after: clone(after) },
  ];
  redoHistory.value = [];
  emit("update:modelValue", after);
  return true;
}
function restoreHistory(action: "undo" | "redo"): void {
  const source = action === "undo" ? undoHistory.value : redoHistory.value;
  const destination = action === "undo" ? redoHistory.value : undoHistory.value;
  const entry = source.at(-1);
  if (!entry) return;
  source.pop();
  destination.push(entry);
  emit(
    "update:modelValue",
    clone(action === "undo" ? entry.before : entry.after),
  );
  clearEditing();
}
function facilityStyle(type: RoomKey): Record<string, string> {
  return {
    "--simulator-facility-accent":
      props.facilityColors?.[type] ?? ROOM_REPRESENTATIVE_COLORS[type],
  };
}
function facilityWidth(row: FacilityRow): string {
  return Math.max(1, slotRefs(row).length) * 76 + 29 + "px";
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
  updateDocument((document) => {
    plan.types.forEach((entryType) =>
      document.layout.push({
        type: entryType,
        level: layoutEntryLevelMax(entryType),
      }),
    );
    document.layout = ensureFixedLayout(document.layout);
    document.plans.forEach((planEntry) =>
      resizeRoomsForLayout(planEntry, document.layout),
    );
  });
  layoutError.value = "";
}
function applyLayoutText(text: string = layoutText.value): void {
  try {
    const nextLayout = ensureFixedLayout(
      validateAddedLayout(layoutWithBuildChain(parseLayoutText(text))),
    );
    updateDocument((document) => {
      document.layout = nextLayout;
      document.plans.forEach((plan) => resizeRoomsForLayout(plan, nextLayout));
    });
    layoutError.value = "";
    layoutText.value = layoutTextFor(nextLayout);
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
  if (value === null || layoutEntryIsFixed(props.modelValue.layout[index]!))
    return;
  updateDocument((document) => {
    const entry = document.layout[index];
    if (!entry) return;
    entry.level = value;
    document.plans.forEach((plan) =>
      resizeRoomsForLayout(plan, document.layout),
    );
  });
}
function removeLayoutEntry(index: number): void {
  const entry = props.modelValue.layout[index];
  if (!entry || layoutEntryIsFixed(entry)) {
    layoutError.value = "当前组合的核心设施不可删除";
    return;
  }
  const cascadedTypes = new Set(cascadeLayoutTypes(entry.type));
  const labels = [...cascadedTypes]
    .filter((type) =>
      props.modelValue.layout.some((item) => item.type === type),
    )
    .map((type) => ROOM_LABELS[type]);
  if (
    labels.length &&
    !window.confirm(
      "删除" +
        ROOM_LABELS[entry.type] +
        "后，将同时删除" +
        labels.join("、") +
        "，确定吗？",
    )
  )
    return;
  updateDocument((document) => {
    document.layout = ensureFixedLayout(
      document.layout.filter(
        (item, itemIndex) =>
          itemIndex !== index && !cascadedTypes.has(item.type),
      ),
    );
    document.plans.forEach((plan) =>
      resizeRoomsForLayout(plan, document.layout),
    );
  });
  layoutError.value = "";
}
function slotRefs(row: FacilityRow): SlotRef[] {
  return row.entries.flatMap((entry) =>
    Array.from(
      { length: roomSlotCount(row.type, entry.entry.level) },
      (_, slotIndex) => ({ entry, slotIndex }),
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
  const rooms = Array.isArray(plan.rooms[type])
    ? (plan.rooms[type] as RoomAssignment[])
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
    key: type + "-" + slot.entry.position + "-" + slot.slotIndex,
  };
}
function allSlotAddresses(): SlotAddress[] {
  return facilityRows.value.flatMap((row) =>
    slotRefs(row).map((slot) => slotAddress(slot, row.type)),
  );
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
  return Boolean(left && right && left.key === right.key);
}
function slotDisplayName(address: SlotAddress): string {
  return sameAddress(editingAddress.value, address)
    ? draftName.value
    : slotName(address);
}
function slotIsSelected(address: SlotAddress): boolean {
  return selectedAddresses.value.has(address.key);
}
function slotIsEditing(address: SlotAddress): boolean {
  return sameAddress(editingAddress.value, address);
}
function trimOperatorSlots(names: string[]): string[] {
  let end = names.length;
  while (end > 0 && !names[end - 1]) end -= 1;
  return names.slice(0, end);
}
function setRoomOperators(
  room: RoomAssignment,
  names: string[],
  overrides: Map<string, OperatorState | undefined> = new Map(),
): void {
  const normalizedNames = trimOperatorSlots(names);
  const nextStates: Record<string, OperatorState> = {};
  normalizedNames.forEach((name) => {
    if (!name) return;
    const state = overrides.has(name)
      ? overrides.get(name)
      : room.operatorStates?.[name];
    if (state) nextStates[name] = clone(state);
  });
  if (!normalizedNames.length) {
    delete room.operators;
    delete room.operatorStates;
    return;
  }
  room.operators = normalizedNames;
  delete room.skip;
  if (Object.keys(nextStates).length) room.operatorStates = nextStates;
  else delete room.operatorStates;
}
function snapshotAt(
  document: ScheduleDocument,
  address: SlotAddress,
): ClipboardEntry {
  const room = roomAt(document, address.type, address.position, false);
  const name = room?.operators?.[address.slotIndex] ?? "";
  const state = name ? room?.operatorStates?.[name] : undefined;
  return { name, ...(state ? { state: clone(state) } : {}) };
}
function applySnapshots(
  document: ScheduleDocument,
  assignments: Map<string, { address: SlotAddress; entry: ClipboardEntry }>,
): void {
  const changes = new Map<
    string,
    Array<{ address: SlotAddress; entry: ClipboardEntry }>
  >();
  assignments.forEach((change) => {
    const key = change.address.type + "-" + change.address.position;
    changes.set(key, [...(changes.get(key) ?? []), change]);
  });
  changes.forEach((items) => {
    const first = items[0];
    if (!first) return;
    const room = roomAt(
      document,
      first.address.type,
      first.address.position,
      true,
    );
    if (!room) return;
    const entry = document.layout.filter(
      (item) => item.type === first.address.type,
    )[first.address.position];
    const capacity = entry
      ? roomSlotCount(first.address.type, entry.level)
      : first.address.slotIndex + 1;
    const names = Array.from(
      { length: capacity },
      (_, index) => room.operators?.[index] ?? "",
    );
    const states = new Map<string, OperatorState | undefined>();
    items.forEach(({ address, entry: snapshot }) => {
      names[address.slotIndex] = snapshot.name;
      states.set(snapshot.name, snapshot.state);
    });
    setRoomOperators(room, names, states);
  });
}
function setSlotName(address: SlotAddress, name: string): void {
  updateDocument((document) => {
    const room = roomAt(document, address.type, address.position, true);
    if (!room) return;
    const entry = document.layout.filter((item) => item.type === address.type)[
      address.position
    ];
    const capacity = entry
      ? roomSlotCount(address.type, entry.level)
      : address.slotIndex + 1;
    const names = Array.from(
      { length: capacity },
      (_, index) => room.operators?.[index] ?? "",
    );
    const oldName = names[address.slotIndex];
    names[address.slotIndex] = name;
    const states = new Map<string, OperatorState | undefined>();
    if (oldName && oldName !== name) states.set(oldName, undefined);
    setRoomOperators(room, names, states);
  });
}
function clearEditing(): void {
  editingAddress.value = undefined;
  draftName.value = "";
}
function commitSlotEdit(): void {
  const address = editingAddress.value;
  if (!address) return;
  const value = draftName.value.trim();
  if (value !== slotName(address)) setSlotName(address, value);
  clearEditing();
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
  if (!slotIsEditing(address)) selectSlot(undefined, address);
}
function openPicker(address: SlotAddress): void {
  pickerAddress.value = address;
  selectedProfession.value = "";
  void nextTick(updatePickerPosition);
}
function closePicker(): void {
  pickerAddress.value = undefined;
  pickerStyle.value = {};
  selectedProfession.value = "";
}
function handleSlotDoubleClick(address: SlotAddress): void {
  selectSlot(undefined, address);
  editingAddress.value = address;
  draftName.value = slotName(address);
  openPicker(address);
}
function selectOperator(operator: Operator): void {
  const address = pickerAddress.value;
  if (!address) return;
  clearEditing();
  setSlotName(address, operator.name);
  selectedAddresses.value = new Set([address.key]);
  selectionAnchor.value = address;
  closePicker();
}
function selectionScope(address: SlotAddress): string {
  return address.type === "power"
    ? address.type
    : address.type + "-" + address.position;
}
function addressesInScope(address: SlotAddress): SlotAddress[] {
  const scope = selectionScope(address);
  return allSlotAddresses().filter((item) => selectionScope(item) === scope);
}
function selectSlot(event: MouseEvent | undefined, address: SlotAddress): void {
  if (suppressNextClick.value) {
    suppressNextClick.value = false;
    return;
  }
  commitSlotEdit();
  const next = new Set(selectedAddresses.value);
  const anchor = selectionAnchor.value;
  if (
    event?.shiftKey &&
    anchor &&
    selectionScope(anchor) === selectionScope(address)
  ) {
    const scope = addressesInScope(address);
    const start = scope.findIndex((item) => item.key === anchor.key);
    const end = scope.findIndex((item) => item.key === address.key);
    if (start >= 0 && end >= 0) {
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      for (let index = from; index <= to; index += 1)
        if (scope[index]) next.add(scope[index]!.key);
    }
  } else if (event?.ctrlKey || event?.metaKey) {
    if (next.has(address.key)) next.delete(address.key);
    else next.add(address.key);
  } else {
    next.clear();
    next.add(address.key);
  }
  selectedAddresses.value = next;
  selectionAnchor.value = address;
  selectAllStage.value = 0;
}
function slotFromTarget(target: EventTarget | null): SlotAddress | undefined {
  if (!(target instanceof Element)) return undefined;
  const slot = target.closest<HTMLElement>(
    ".basic-calculator-schedule-slot[data-key]",
  );
  if (!slot) return undefined;
  const type = slot.dataset.type as RoomKey | undefined;
  const position = Number(slot.dataset.position);
  const slotIndex = Number(slot.dataset.slotIndex);
  return type && Number.isInteger(position) && Number.isInteger(slotIndex)
    ? { type, position, slotIndex, key: slot.dataset.key ?? "" }
    : undefined;
}
function selectedSlotAddresses(): SlotAddress[] {
  return allSlotAddresses().filter((address) =>
    selectedAddresses.value.has(address.key),
  );
}
function currentTarget(): SlotAddress | undefined {
  return selectedSlotAddresses()[0] ?? hoveredAddress.value;
}
function setHoveredAddress(address: SlotAddress | undefined): void {
  hoveredAddress.value = address;
}
function addressesAtPoint(x: number, y: number): SlotAddress | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    const address = slotFromTarget(element);
    if (address) return address;
  }
  return undefined;
}
function transferPairs(
  sources: SlotAddress[],
  target: SlotAddress,
): Array<[SlotAddress, SlotAddress]> {
  const valid = sources.filter((address) => slotName(address));
  if (!valid.length) return [];
  const firstSource = valid[0];
  if (!firstSource) return [];
  const sameScope = valid.every(
    (address) => selectionScope(address) === selectionScope(firstSource),
  );
  if (sameScope && selectionScope(target) === selectionScope(firstSource)) {
    const scope = addressesInScope(target);
    const first = scope.findIndex((address) => address.key === valid[0]?.key);
    const targetIndex = scope.findIndex(
      (address) => address.key === target.key,
    );
    if (first >= 0 && targetIndex >= 0) {
      return valid.flatMap((source) => {
        const sourceIndex = scope.findIndex(
          (address) => address.key === source.key,
        );
        const destination = scope[targetIndex + sourceIndex - first];
        return destination ? [[source, destination] as const] : [];
      });
    }
  }
  const addresses = allSlotAddresses();
  const start = addresses.findIndex((address) => address.key === target.key);
  return start < 0
    ? []
    : valid.flatMap((source, index) => {
        const destination = addresses[start + index];
        return destination ? [[source, destination] as const] : [];
      });
}
function swapAddressPairs(pairs: Array<[SlotAddress, SlotAddress]>): void {
  if (!pairs.length) return;
  const document = cloneDocument();
  const snapshots = new Map<string, ClipboardEntry>();
  pairs.forEach(([source, destination]) => {
    if (!snapshots.has(source.key))
      snapshots.set(source.key, snapshotAt(document, source));
    if (!snapshots.has(destination.key))
      snapshots.set(destination.key, snapshotAt(document, destination));
  });
  const sourceKeys = new Set(pairs.map(([source]) => source.key));
  const destinationKeys = new Set(
    pairs.map(([, destination]) => destination.key),
  );
  const assignments = new Map<
    string,
    { address: SlotAddress; entry: ClipboardEntry }
  >();
  pairs.forEach(([source, destination]) => {
    const entry = snapshots.get(source.key);
    if (entry)
      assignments.set(destination.key, { address: destination, entry });
  });
  if ([...sourceKeys].some((key) => destinationKeys.has(key))) {
    sourceKeys.forEach((key) => {
      if (destinationKeys.has(key)) return;
      const address = pairs.flatMap(([source, destination]) =>
        source.key === key
          ? [source]
          : destination.key === key
            ? [destination]
            : [],
      )[0];
      if (address) assignments.set(key, { address, entry: { name: "" } });
    });
  } else {
    pairs.forEach(([source, destination]) => {
      const entry = snapshots.get(destination.key);
      if (entry) assignments.set(source.key, { address: source, entry });
    });
  }
  const changed = [...assignments.values()].some(
    ({ address, entry }) =>
      JSON.stringify(snapshots.get(address.key)) !== JSON.stringify(entry),
  );
  if (!changed) return;
  updateDocument((candidate) => applySnapshots(candidate, assignments));
  const destinations = pairs.map(([, destination]) => destination);
  selectedAddresses.value = new Set(destinations.map((address) => address.key));
  selectionAnchor.value = destinations[0];
}
function handlePointerDown(event: PointerEvent): void {
  if (
    event.button !== 0 ||
    !editorElement.value?.contains(event.target as Node)
  )
    return;
  const target = event.target instanceof Element ? event.target : undefined;
  if (target?.closest("input, textarea, select, button")) return;
  const address = slotFromTarget(event.target);
  const sources =
    address && slotName(address)
      ? event.shiftKey && selectedAddresses.value.has(address.key)
        ? selectedSlotAddresses()
        : [address]
      : [];
  pointerInteraction.value = {
    mode: address ? "press" : "box",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    startAddress: address,
    sourceAddresses: sources,
    additive: event.ctrlKey || event.metaKey,
  };
  if (!address) event.preventDefault();
}
function updateSelectionMarquee(interaction: PointerInteraction): void {
  selectionMarquee.value = {
    left: Math.min(interaction.startX, interaction.currentX),
    top: Math.min(interaction.startY, interaction.currentY),
    width: Math.abs(interaction.currentX - interaction.startX),
    height: Math.abs(interaction.currentY - interaction.startY),
  };
}
function selectSlotsInBox(interaction: PointerInteraction): void {
  const left = Math.min(interaction.startX, interaction.currentX);
  const right = Math.max(interaction.startX, interaction.currentX);
  const top = Math.min(interaction.startY, interaction.currentY);
  const bottom = Math.max(interaction.startY, interaction.currentY);
  const selected = interaction.additive
    ? new Set(selectedAddresses.value)
    : new Set<string>();
  editorElement.value
    ?.querySelectorAll<HTMLElement>(".basic-calculator-schedule-slot[data-key]")
    .forEach((slot) => {
      const rect = slot.getBoundingClientRect();
      if (
        rect.right >= left &&
        rect.left <= right &&
        rect.bottom >= top &&
        rect.top <= bottom
      ) {
        if (slot.dataset.key) selected.add(slot.dataset.key);
      }
    });
  selectedAddresses.value = selected;
  selectionAnchor.value = selectedSlotAddresses()[0];
  selectionMarquee.value = { left: 0, top: 0, width: 0, height: 0 };
}
function handlePointerMove(event: PointerEvent): void {
  const interaction = pointerInteraction.value;
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const moved =
    Math.abs(event.clientX - interaction.startX) > 4 ||
    Math.abs(event.clientY - interaction.startY) > 4;
  if (interaction.mode === "press" && moved)
    interaction.mode = interaction.sourceAddresses.length ? "move" : "box";
  interaction.currentX = event.clientX;
  interaction.currentY = event.clientY;
  if (interaction.mode === "box") {
    event.preventDefault();
    updateSelectionMarquee(interaction);
  } else if (interaction.mode === "move") {
    event.preventDefault();
    dragTargetKey.value =
      addressesAtPoint(event.clientX, event.clientY)?.key ?? "";
  }
}
function handlePointerUp(event: PointerEvent): void {
  const interaction = pointerInteraction.value;
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  interaction.currentX = event.clientX;
  interaction.currentY = event.clientY;
  if (interaction.mode === "box") {
    selectSlotsInBox(interaction);
    suppressNextClick.value = true;
  } else if (interaction.mode === "move") {
    const target = addressesAtPoint(event.clientX, event.clientY);
    if (target)
      swapAddressPairs(transferPairs(interaction.sourceAddresses, target));
    suppressNextClick.value = true;
  }
  pointerInteraction.value = undefined;
  dragTargetKey.value = "";
}
function handlePointerCancel(): void {
  pointerInteraction.value = undefined;
  dragTargetKey.value = "";
  selectionMarquee.value = { left: 0, top: 0, width: 0, height: 0 };
  suppressNextClick.value = true;
}
function handleWindowSelectStart(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element) || !editorElement.value?.contains(target))
    return;
  if (
    pointerInteraction.value?.mode === "box" ||
    pointerInteraction.value?.mode === "move" ||
    target.closest(".simulator-slot")
  ) {
    if (!target.closest("input, textarea, select")) event.preventDefault();
  }
}
function clearPasteHighlight(): void {
  pasteHighlightKeys.value = new Set();
  if (pasteHighlightTimer !== undefined) clearTimeout(pasteHighlightTimer);
  pasteHighlightTimer = undefined;
}
function showPasteHighlight(addresses: SlotAddress[]): void {
  clearPasteHighlight();
  pasteHighlightKeys.value = new Set(addresses.map((address) => address.key));
  pasteHighlightTimer = setTimeout(clearPasteHighlight, 700);
}
function clipboardSource(): SlotAddress[] {
  const selected = selectedSlotAddresses();
  if (selected.length) return selected;
  const target = currentTarget();
  return target ? [target] : [];
}
function copyOperators(): boolean {
  commitSlotEdit();
  const addresses = clipboardSource();
  if (!addresses.length) return false;
  clipboard.value = {
    mode: "copy",
    entries: addresses.map((address) => snapshotAt(props.modelValue, address)),
    sourceAddresses: addresses,
  };
  clearSelection();
  return true;
}
function cutOperators(): boolean {
  commitSlotEdit();
  const addresses = clipboardSource();
  if (!addresses.length) return false;
  clipboard.value = {
    mode: "cut",
    entries: addresses.map((address) => snapshotAt(props.modelValue, address)),
    sourceAddresses: addresses,
  };
  const assignments = new Map<
    string,
    { address: SlotAddress; entry: ClipboardEntry }
  >();
  addresses.forEach((address) =>
    assignments.set(address.key, { address, entry: { name: "" } }),
  );
  updateDocument((candidate) => applySnapshots(candidate, assignments));
  clearSelection();
  return true;
}
function pasteOperators(): boolean {
  const state = clipboard.value;
  const target = currentTarget();
  if (!state?.entries.length || !target) return false;
  commitSlotEdit();
  const selected = selectedSlotAddresses();
  const fallback = transferPairs(state.sourceAddresses, target).flatMap(
    ([, address], index) =>
      state.entries[index] ? [{ address, entry: state.entries[index]! }] : [],
  );
  const assignments = operatorPasteAssignments(
    state.entries,
    selected,
    fallback,
  );
  if (!assignments.length) return false;
  const destinations = assignments.map(({ address }) => address);
  const changed = updateDocument((candidate) => {
    const next = new Map<
      string,
      { address: SlotAddress; entry: ClipboardEntry }
    >();
    assignments.forEach((assignment) =>
      next.set(assignment.address.key, assignment),
    );
    applySnapshots(candidate, next);
  });
  if (!changed) return false;
  if (state.mode === "cut") clipboard.value = undefined;
  selectedAddresses.value = new Set(destinations.map((address) => address.key));
  selectionAnchor.value = destinations[0];
  showPasteHighlight(destinations);
  return true;
}
function deleteOperators(): boolean {
  const addresses = clipboardSource().filter((address) => slotName(address));
  if (!addresses.length) return false;
  const assignments = new Map<
    string,
    { address: SlotAddress; entry: ClipboardEntry }
  >();
  addresses.forEach((address) =>
    assignments.set(address.key, { address, entry: { name: "" } }),
  );
  return updateDocument((candidate) => applySnapshots(candidate, assignments));
}
function clearSelection(): void {
  selectedAddresses.value = new Set();
  selectionAnchor.value = undefined;
  selectAllStage.value = 0;
}
function selectAllOperators(): boolean {
  const target = currentTarget();
  if (!target) return false;
  const addresses =
    selectAllStage.value === 0
      ? addressesInScope(target)
      : selectAllStage.value === 1
        ? allSlotAddresses().filter((address) => address.type === target.type)
        : allSlotAddresses();
  selectedAddresses.value = new Set(addresses.map((address) => address.key));
  selectionAnchor.value = target;
  selectAllStage.value = Math.min(2, selectAllStage.value + 1) as 0 | 1 | 2;
  return addresses.length > 0;
}
function navigateSlot(
  action: "tab" | "enter" | "left" | "right" | "up" | "down",
): boolean {
  const current = editingAddress.value ?? currentTarget();
  if (!current) return false;
  if (editingAddress.value) commitSlotEdit();
  const addresses = allSlotAddresses();
  const currentIndex = addresses.findIndex(
    (address) => address.key === current.key,
  );
  if (currentIndex < 0) return false;
  let target: SlotAddress | undefined;
  if (action === "tab" || action === "left" || action === "right") {
    const index = currentIndex + (action === "left" ? -1 : 1);
    target =
      action === "tab"
        ? addresses[(index + addresses.length) % addresses.length]
        : addresses[index];
  } else if (action === "enter") {
    const scope = addressesInScope(current);
    const empty = scope.find((address) => !slotName(address));
    target =
      empty ??
      scope[
        (scope.findIndex((address) => address.key === current.key) + 1) %
          Math.max(1, scope.length)
      ];
  } else {
    const index = facilityRows.value.findIndex((row) =>
      row.entries.some(
        (entry) =>
          row.type === current.type && entry.position === current.position,
      ),
    );
    const row = facilityRows.value[index + (action === "up" ? -1 : 1)];
    if (row) {
      const slot =
        slotRefs(row)[Math.min(current.slotIndex, slotRefs(row).length - 1)];
      if (slot) target = slotAddress(slot, row.type);
    }
  }
  if (!target || target.key === current.key) return false;
  selectedAddresses.value = new Set([target.key]);
  selectionAnchor.value = target;
  return true;
}
function keyboardShortcutKey(event: KeyboardEvent): string {
  const keys: Record<string, string> = {
    KeyA: "a",
    KeyC: "c",
    KeyX: "x",
    KeyV: "v",
    KeyZ: "z",
    KeyY: "y",
  };
  return keys[event.code] ?? event.key.toLowerCase();
}
function handleWindowKeydown(event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof Node) || !editorElement.value?.contains(target))
    return;
  const input =
    target instanceof Element
      ? target.closest("input, textarea, select")
      : undefined;
  const pendingInput =
    input instanceof HTMLInputElement &&
    input.classList.contains("simulator-slot-name-input--pending");
  if (input && !editingAddress.value && !pendingInput) return;
  const key = keyboardShortcutKey(event);
  if (event.key === "Escape") {
    event.preventDefault();
    clearEditing();
    closePicker();
    closeContextMenu();
    clearPasteHighlight();
    return;
  }
  if (pendingInput && event.key === "Backspace") {
    event.preventDefault();
    return;
  }
  const primary =
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  if (primary && key === "z") {
    event.preventDefault();
    restoreHistory("undo");
    return;
  }
  if (primary && key === "y") {
    event.preventDefault();
    restoreHistory("redo");
    return;
  }
  if (primary && key === "a") {
    if (selectAllOperators()) event.preventDefault();
    return;
  }
  if (primary && key === "c") {
    if (copyOperators()) event.preventDefault();
    return;
  }
  if (primary && key === "x") {
    if (cutOperators()) event.preventDefault();
    return;
  }
  if (primary && key === "v") {
    if (pasteOperators()) event.preventDefault();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const navigation: Record<
    string,
    "tab" | "enter" | "left" | "right" | "up" | "down"
  > = {
    Tab: "tab",
    Enter: "enter",
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  };
  const action = navigation[event.key];
  if (action && navigateSlot(action)) event.preventDefault();
  if (event.key === "Delete" && deleteOperators()) event.preventDefault();
}
function handleWindowClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Node) || !editorElement.value?.contains(target))
    return;
  if (
    target instanceof Element &&
    target.closest(".simulator-context-menu, .simulator-operator-picker")
  )
    return;
  if (target instanceof Element && target.closest(".simulator-slot[data-key]"))
    return;
  commitSlotEdit();
  closePicker();
  closeContextMenu();
  clearSelection();
}
async function updatePickerPosition(): Promise<void> {
  const address = pickerAddress.value;
  if (!address) return;
  await nextTick();
  const slot = editorElement.value?.querySelector<HTMLElement>(
    '.basic-calculator-schedule-slot[data-key="' + address.key + '"]',
  );
  const panel = editorElement.value?.querySelector<HTMLElement>(
    ".simulator-operator-picker",
  );
  if (!slot || !panel || pickerAddress.value?.key !== address.key) return;
  const rect = slot.getBoundingClientRect();
  const padding = 8;
  const maxTop = Math.max(
    padding,
    window.innerHeight - panel.offsetHeight - padding,
  );
  const left = Math.min(
    Math.max(padding, rect.right + padding),
    Math.max(padding, window.innerWidth - panel.offsetWidth - padding),
  );
  pickerStyle.value = {
    insetInlineStart: left + "px",
    insetBlockStart: Math.min(Math.max(padding, rect.top), maxTop) + "px",
  };
}
function contextMenuPosition(event: MouseEvent): { x: number; y: number } {
  return {
    x: Math.min(event.clientX, Math.max(8, window.innerWidth - 260)),
    y: event.clientY,
  };
}
async function clampContextMenuPosition(): Promise<void> {
  await nextTick();
  const menu = contextMenu.value;
  const element = contextMenuElement.value;
  if (!menu || !element) return;
  const maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8);
  if (menu.y > maxTop) contextMenu.value = { ...menu, y: maxTop };
}
function closeContextMenu(): void {
  contextMenu.value = undefined;
}
function openSlotContextMenu(event: MouseEvent, address: SlotAddress): void {
  event.preventDefault();
  commitSlotEdit();
  if (!slotName(address) && !roomHasProduct(address.type)) return;
  selectedAddresses.value = new Set([address.key]);
  selectionAnchor.value = address;
  contextMenu.value = {
    ...address,
    scope: slotName(address) ? "operator" : "room",
    positions: [address.position],
    ...contextMenuPosition(event),
  };
  void clampContextMenuPosition();
}
function openRoomContextMenu(event: MouseEvent, row: FacilityRow): void {
  event.preventDefault();
  if (!roomHasProduct(row.type)) return;
  const position = row.entries[0]?.position;
  if (position === undefined) return;
  contextMenu.value = {
    type: row.type,
    position,
    slotIndex: 0,
    key: row.type + "-" + position + "-0",
    scope: "room",
    positions: row.entries.map((entry) => entry.position),
    ...contextMenuPosition(event),
  };
  void clampContextMenuPosition();
}
function sourceValue(room: RoomAssignment | undefined): string {
  return (
    room?.sourceMaterial ??
    (room?.product === "源石碎片" ? DEFAULT_SOURCE_MATERIAL : "")
  );
}
function roomHasProduct(type: RoomKey): boolean {
  return type === "trading" || type === "manufacture";
}
function productOptions(
  type: RoomKey,
  currentProduct: string | undefined,
): Array<{ value: string; label: string; disabled?: boolean }> {
  const options =
    type === "trading"
      ? PRODUCT_OPTIONS.filter(
          (option) => option.value === "龙门币" || option.value === "合成玉",
        )
      : PRODUCT_OPTIONS.filter(
          (option) => option.value !== "龙门币" && option.value !== "合成玉",
        );
  const result: Array<{ value: string; label: string; disabled?: boolean }> = [
    { value: "", label: "未指定产物" },
    ...options,
  ];
  if (
    currentProduct &&
    !result.some((option) => option.value === currentProduct)
  ) {
    result.push({
      value: currentProduct,
      label: currentProduct + "（仅保留）",
      disabled: true,
    });
  }
  return result;
}
function updateRooms(
  type: RoomKey,
  positions: number[],
  update: (room: RoomAssignment) => void,
): void {
  updateDocument((document) =>
    positions.forEach((position) => {
      const room = roomAt(document, type, position, true);
      if (room) update(room);
    }),
  );
}
function roomContextMenuItems(
  type: RoomKey,
  positions: number[],
): ContextMenuItem[] {
  if (!roomHasProduct(type)) return [];
  const rooms = positions.map((position) =>
    roomAt(props.modelValue, type, position, false),
  );
  const currentProduct = rooms.every(
    (room) => (room?.product ?? "") === (rooms[0]?.product ?? ""),
  )
    ? rooms[0]?.product
    : undefined;
  const items: ContextMenuItem[] = [];
  productOptions(type, currentProduct).forEach((option) =>
    items.push({
      key: "product-" + type + "-" + option.value,
      label: option.label,
      check: rooms.every((room) => (room?.product ?? "") === option.value),
      disabled: option.disabled,
      action: () => {
        updateRooms(type, positions, (room) => {
          if (!option.value) {
            delete room.product;
            delete room.sourceMaterial;
          } else {
            room.product = option.value;
            if (option.value === "源石碎片")
              room.sourceMaterial ||= DEFAULT_SOURCE_MATERIAL;
            else delete room.sourceMaterial;
          }
        });
        closeContextMenu();
      },
    }),
  );
  if (rooms.length && rooms.every((room) => room?.product === "源石碎片")) {
    items.push({ key: "source-divider-" + type, label: "", divider: true });
    SOURCE_MATERIAL_OPTIONS.forEach((option) =>
      items.push({
        key: "source-" + type + "-" + option.value,
        label: option.label,
        check: rooms.every((room) => sourceValue(room) === option.value),
        action: () => {
          updateRooms(type, positions, (room) => {
            room.sourceMaterial = option.value;
          });
          closeContextMenu();
        },
      }),
    );
  }
  return items;
}
function updateOperatorState(
  address: SlotAddress,
  key: "mood" | "elite" | "level",
  value: number | undefined,
): void {
  const name = slotName(address);
  if (!name) return;
  updateDocument((document) => {
    const room = roomAt(document, address.type, address.position, true);
    if (!room) return;
    const states = room.operatorStates ?? {};
    const state = states[name] ?? {};
    if (value === undefined) delete state[key];
    else state[key] = value;
    if (Object.keys(state).length) states[name] = state;
    else delete states[name];
    if (Object.keys(states).length) room.operatorStates = states;
    else delete room.operatorStates;
  });
  closeContextMenu();
}
function progressionItemKey(node: OperatorProgressionNode): string {
  return node.type + "-" + node.value;
}
function isCurrentProgression(node: OperatorProgressionNode): boolean {
  const progression = operatorContextMenuDetails.value?.progression;
  if (!progression) return false;
  return node.type === "elite"
    ? progression.current.elite === node.value
    : progression.current.level === node.value;
}
function updateOperatorProgression(node: OperatorProgressionNode): void {
  const menu = contextMenu.value;
  if (!menu) return;
  updateDocument((document) => {
    const room = roomAt(document, menu.type, menu.position, true);
    const name = room?.operators?.[menu.slotIndex];
    if (!room || !name) return;
    const states = room.operatorStates ?? {};
    const state = states[name] ?? {};
    if (node.type === "elite") {
      state.elite = node.value;
      state.level = 1;
    } else {
      state.level = node.value;
    }
    states[name] = state;
    room.operatorStates = states;
  });
  closeContextMenu();
}
function resetOperatorProgression(): void {
  const menu = contextMenu.value;
  if (!menu) return;
  updateDocument((document) => {
    const room = roomAt(document, menu.type, menu.position, false);
    const name = room?.operators?.[menu.slotIndex];
    const state = name ? room?.operatorStates?.[name] : undefined;
    if (!room || !name || !state) return;
    delete state.elite;
    delete state.level;
    if (!Object.keys(state).length) delete room.operatorStates?.[name];
    if (room.operatorStates && !Object.keys(room.operatorStates).length)
      delete room.operatorStates;
  });
  closeContextMenu();
}
function contextMenuStyle(): Record<string, string> {
  const menu = contextMenu.value;
  return menu
    ? { insetInlineStart: menu.x + "px", insetBlockStart: menu.y + "px" }
    : {};
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
    ref="editorElement"
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
      <div
        v-for="row in facilityRows"
        :key="row.key"
        class="basic-calculator-facility-column"
        :style="{ '--basic-calculator-facility-width': facilityWidth(row) }"
      >
        <a-card
          :bordered="false"
          class="simulator-column-card simulator-facility-card"
          :style="facilityStyle(row.type)"
          @contextmenu.stop.prevent="openRoomContextMenu($event, row)"
        >
          <template #title>
            <div class="simulator-facility-title">
              <span>{{ row.label }}</span>
              <a-space v-if="row.type !== 'power'" :size="4" wrap>
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
              <div
                class="simulator-facility-queue-content"
                @contextmenu.stop.prevent="openRoomContextMenu($event, row)"
              >
                <div class="simulator-slot-grid" :style="slotStyle()">
                  <ScheduleOperatorSlot
                    v-for="slot in slotRefs(row)"
                    :key="
                      row.type +
                      '-' +
                      slot.entry.position +
                      '-' +
                      slot.slotIndex
                    "
                    class="basic-calculator-schedule-slot"
                    :clipboard="
                      clipboard?.sourceAddresses.some(
                        (address) =>
                          address.key === slotAddress(slot, row.type).key,
                      )
                    "
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
                    :paste-highlighted="
                      pasteHighlightKeys.has(slotAddress(slot, row.type).key)
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
                    @click="selectSlot($event, slotAddress(slot, row.type))"
                    @contextmenu="
                      openSlotContextMenu($event, slotAddress(slot, row.type))
                    "
                    @dblclick="
                      handleSlotDoubleClick(slotAddress(slot, row.type))
                    "
                    @input="
                      handleSlotInput($event, slotAddress(slot, row.type))
                    "
                    @input-click="
                      handleSlotInputClick(slotAddress(slot, row.type))
                    "
                    @mouseenter="setHoveredAddress(slotAddress(slot, row.type))"
                    @mouseleave="setHoveredAddress(undefined)"
                  />
                </div>
              </div>
            </a-card>
          </div>
        </a-card>
      </div>
      <div
        v-if="pointerInteraction?.mode === 'box'"
        :style="selectionMarqueeStyle"
        class="simulator-selection-marquee basic-calculator-selection-marquee"
      />
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
    <div
      v-if="contextMenu"
      ref="contextMenuElement"
      :class="[
        'simulator-context-menu',
        { 'simulator-context-menu--flat': contextMenuSections.length <= 1 },
      ]"
      :style="contextMenuStyle()"
      @click="closeContextMenu"
    >
      <a-menu :selectable="false">
        <template v-if="operatorContextMenuDetails">
          <a-menu-item
            v-for="mood in [0, 12, 24]"
            :key="'mood-' + mood"
            @click="
              updateOperatorState(
                contextMenu!,
                'mood',
                mood === 24 ? undefined : mood,
              )
            "
          >
            <span class="simulator-context-menu-marker">{{
              operatorContextMenuDetails.state.mood === undefined
                ? mood === 24
                  ? "✓"
                  : ""
                : operatorContextMenuDetails.state.mood === mood
                  ? "✓"
                  : ""
            }}</span>
            心情 {{ mood }}<span v-if="mood === 24">（默认）</span>
          </a-menu-item>
          <a-menu-divider
            v-if="operatorContextMenuDetails.progression?.nodes.length"
          />
          <a-menu-item
            v-for="node in operatorContextMenuDetails.progression?.nodes ?? []"
            :key="progressionItemKey(node)"
            @click="updateOperatorProgression(node)"
          >
            <span class="simulator-context-menu-marker">{{
              isCurrentProgression(node) ? "✓" : ""
            }}</span>
            {{ node.label }}
          </a-menu-item>
          <a-menu-item
            v-if="operatorContextMenuDetails.progression?.hasManualProgression"
            key="reset-progression"
            danger
            @click="resetOperatorProgression"
          >
            <span class="simulator-context-menu-marker" />恢复默认练度
          </a-menu-item>
          <a-menu-divider v-if="contextMenuSections.length" />
        </template>
        <a-menu-item-group
          v-for="section in contextMenuSections"
          :key="section.key"
          :title="section.title"
        >
          <template v-for="item in section.items" :key="item.key">
            <a-menu-divider v-if="item.divider" />
            <a-menu-item
              v-else
              :disabled="item.disabled"
              @click="item.action?.()"
            >
              <span class="simulator-context-menu-marker">{{
                item.check ? "✓" : ""
              }}</span>
              {{ item.label }}
            </a-menu-item>
          </template>
        </a-menu-item-group>
      </a-menu>
    </div>
    <div class="simulator-layout-summary">
      <span class="simulator-summary-label">设施布局</span>
      <a-tag v-for="row in facilityRows" :key="row.key" color="green">{{
        row.label
      }}</a-tag>
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
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
  overflow-x: auto;
}
.basic-calculator-facility-column {
  flex: 0 0 var(--basic-calculator-facility-width);
  max-width: var(--basic-calculator-facility-width);
  min-width: 0;
}
.basic-calculator-facility-column :deep(.simulator-facility-card) {
  min-width: 0;
}
.basic-calculator-facility-column :deep(.simulator-facility-title) {
  min-width: 0;
}
.basic-calculator-facility-column
  :deep(.simulator-facility-title > span:first-child) {
  flex: 0 1 auto;
}
.basic-calculator-facility-column :deep(.simulator-facility-queue) {
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
.basic-calculator-selection-marquee {
  position: fixed;
  z-index: 20;
  pointer-events: none;
}
</style>
