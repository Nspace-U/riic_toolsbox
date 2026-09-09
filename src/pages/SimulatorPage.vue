<script setup lang="ts">
import {
  ClusterOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { computed, ref, watch } from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { useDataSource } from "@/composables/useDataSource";
import {
  isProductColorKey,
  useFacilityColors,
} from "@/composables/useFacilityColors";
import { useScheduleDocuments } from "@/composables/useScheduleDocuments";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import { DEFAULT_SCHEDULE_ADAPTER } from "@/adapters";
import type { EliteLevel, Operator } from "@/types/baseData";
import type {
  EfficiencyCatalog,
  EfficiencyResult,
  FacilityEfficiencyResult,
  ProductionValue,
} from "@/types/efficiency";
import type {
  LayoutEntry,
  OperatorState,
  Plan,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
  StoredDocument,
} from "@/types/schedule";
import {
  DEFAULT_SOURCE_MATERIAL,
  PRODUCT_OPTIONS,
  PRODUCT_REPRESENTATIVE_COLORS,
  ROOM_LABELS,
  ROOM_ORDER,
  ROOM_REPRESENTATIVE_COLORS,
  SOURCE_MATERIAL_OPTIONS,
  UNSUPPORTED_PRODUCT_LABELS,
  ScheduleError,
  canAddLayoutEntry,
  cloneSchedule,
  facilityPower,
  roomSlotCount,
  roomLevelRange,
  validateSchedule,
} from "@/utils/schedule";
import { calculateEfficiency, loadEfficiencyCatalog } from "@/utils/efficiency";

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

interface FacilitySlotRef {
  entry: FacilityEntry;
  slotIndex: number;
}

interface PowerSummary {
  used: number;
  provided: number;
  net: number;
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
} = useScheduleDocuments();
const { operators, terms, ready: baseDataReady } = useBaseData();
const { selectedDataSource } = useDataSource();
const { facilityColors, productColors } = useFacilityColors();

const fileInput = ref<HTMLInputElement>();
const errorMessage = ref("");
const successMessage = ref("");
const efficiencyCatalog = ref<EfficiencyCatalog>();
const efficiencyLoading = ref(false);
const efficiencyError = ref("");
const draftOperatorNames = ref<Record<string, string>>({});
const newLayoutType = ref<RoomKey>("trading");
let catalogRequestVersion = 0;

const activeDocument = computed(() => getActiveDocument());
const currentDocument = computed(() => activeDocument.value?.document);

const efficiencyResult = computed<EfficiencyResult | undefined>(() => {
  const document = currentDocument.value;
  const catalog = efficiencyCatalog.value;
  if (!document || !catalog) {
    return undefined;
  }
  return calculateEfficiency(document, catalog);
});

const efficiencySupported = computed(
  () => selectedDataSource.value === "torappu",
);

const operatorOptions = computed(() =>
  operators.value.map((operator) => ({
    value: operator.name,
    label: operator.name,
  })),
);

const layoutAddOptions = computed(() =>
  ROOM_ORDER.map((type) => {
    const result = currentDocument.value
      ? canAddLayoutEntry(currentDocument.value.layout, type)
      : { ok: false, reason: "暂无排班表" };
    return {
      value: type,
      label: ROOM_LABELS[type],
      disabled: !result.ok,
    };
  }),
);

const powerSummary = computed<PowerSummary>(() => {
  const document = currentDocument.value;
  if (!document) {
    return { used: 0, provided: 0, net: 0 };
  }

  return document.layout.reduce<PowerSummary>(
    (summary, entry) => {
      const power = facilityPower(entry.type, entry.level);
      if (power >= 0) {
        summary.provided += power;
      } else {
        summary.used += -power;
      }
      summary.net = summary.provided - summary.used;
      return summary;
    },
    { used: 0, provided: 0, net: 0 },
  );
});

const layoutGroups = computed(() => {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }

  return ROOM_ORDER.map((type) => ({
    type,
    label: ROOM_LABELS[type],
    entries: document.layout.filter((entry) => entry.type === type),
  })).filter((group) => group.entries.length > 0);
});

const facilityRows = computed<FacilityRow[]>(() => {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }

  const rows: FacilityRow[] = [];
  ROOM_ORDER.forEach((type) => {
    const entries = document.layout
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.type === type)
      .map(({ entry, index }, position) => ({ entry, index, position }));
    if (!entries.length) {
      return;
    }

    if (type === "power") {
      rows.push({
        key: type,
        type,
        label: `${ROOM_LABELS[type]}（${entries.length}）`,
        entries,
      });
      return;
    }

    entries.forEach((entry) => {
      const suffix = entries.length > 1 ? ` ${entry.position + 1}` : "";
      rows.push({
        key: `${type}-${entry.position}`,
        type,
        label: `${ROOM_LABELS[type]}${suffix}`,
        entries: [entry],
      });
    });
  });
  return rows;
});

const extraRooms = computed(() => {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }

  return document.plans.flatMap((plan, planIndex) =>
    ROOM_ORDER.flatMap((type) => {
      const rooms = plan.rooms[type];
      if (!Array.isArray(rooms)) {
        return [];
      }
      const expected = document.layout.filter(
        (entry) => entry.type === type,
      ).length;
      return rooms.slice(expected).map((room, offset) => ({
        planIndex,
        planName: plan.name || `队列${planIndex + 1}`,
        type,
        index: expected + offset,
        room: room as RoomAssignment,
      }));
    }),
  );
});

function clearMessages(): void {
  errorMessage.value = "";
  successMessage.value = "";
}

function setError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : "操作失败";
  successMessage.value = "";
}

function updateCurrent(
  mutator: (document: ScheduleDocument) => void,
  options: { markLayoutExplicit?: boolean } = {},
): boolean {
  const document = currentDocument.value;
  const stored = activeDocument.value;
  if (!document || !stored) {
    return false;
  }

  const candidate = cloneSchedule(document);
  try {
    mutator(candidate);
    validateSchedule(candidate);
  } catch (error: unknown) {
    setError(error);
    return false;
  }
  updateDocument(stored.id, (target) => {
    target.document = candidate;
    if (options.markLayoutExplicit) {
      target.inferredLayout = false;
    }
  });
  return true;
}

function updateMeta(key: "title" | "description", value: string): void {
  updateCurrent((document) => {
    document[key] = value;
  });
}

function updatePlanMeta(
  planIndex: number,
  key: "name" | "description",
  value: string,
): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex];
    if (plan) {
      plan[key] = value;
    }
  });
}

function updatePlanDuration(planIndex: number, value: number | null): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex];
    if (plan) {
      plan.duration = value ?? undefined;
    }
  });
}

function roomsForLayout(
  layout: LayoutEntry[],
): Record<string, RoomAssignment[]> {
  const rooms: Record<string, RoomAssignment[]> = {};
  ROOM_ORDER.forEach((type) => {
    const count = layout.filter((entry) => entry.type === type).length;
    if (count > 0) {
      rooms[type] = Array.from({ length: count }, () => ({ skip: true }));
    }
  });
  return rooms;
}

function normalizeRoomCapacity(
  room: RoomAssignment,
  type: RoomKey,
  level: number,
): RoomAssignment {
  const capacity = roomSlotCount(type, level);
  if (!room.operators || room.operators.length <= capacity) {
    return room;
  }

  room.operators = room.operators.slice(0, capacity);
  if (room.operatorStates) {
    room.operatorStates = Object.fromEntries(
      Object.entries(room.operatorStates).filter(([name]) =>
        room.operators?.includes(name),
      ),
    );
    if (Object.keys(room.operatorStates).length === 0) {
      delete room.operatorStates;
    }
  }
  return room;
}

function resizeRoomsForLayout(plan: Plan, layout: LayoutEntry[]): void {
  const nextRooms: Record<string, RoomAssignment[] | unknown> = {
    ...plan.rooms,
  };
  ROOM_ORDER.forEach((type) => {
    const expected = layout.filter((entry) => entry.type === type).length;
    if (expected === 0) {
      delete nextRooms[type];
      return;
    }
    const previous = Array.isArray(plan.rooms[type])
      ? (plan.rooms[type] as RoomAssignment[])
      : [];
    const entries = layout.filter((entry) => entry.type === type);
    nextRooms[type] = Array.from({ length: expected }, (_, index) =>
      normalizeRoomCapacity(
        previous[index] ?? { skip: true },
        type,
        entries[index]?.level ?? 1,
      ),
    );
  });
  plan.rooms = nextRooms;
}

function layoutEntryLevelMax(type: RoomKey): number {
  return roomLevelRange(type).max;
}

function layoutTypeOptions(
  index: number,
): Array<{ value: string; label: string; disabled?: boolean }> {
  const layout = currentDocument.value?.layout;
  if (!layout) {
    return [];
  }

  const baseLayout = layout.filter(
    (_entry, entryIndex) => entryIndex !== index,
  );
  return ROOM_ORDER.map((type) => {
    const result = canAddLayoutEntry(baseLayout, type);
    return {
      value: type,
      label: ROOM_LABELS[type],
      disabled: !result.ok,
    };
  });
}

function addLayoutEntry(): void {
  const type = newLayoutType.value;
  const document = currentDocument.value;
  if (!document) {
    return;
  }
  const result = canAddLayoutEntry(document.layout, type);
  if (!result.ok) {
    setError(new ScheduleError(result.reason));
    return;
  }

  updateCurrent(
    (candidate) => {
      candidate.layout.push({ type, level: layoutEntryLevelMax(type) });
      candidate.plans.forEach((plan) =>
        resizeRoomsForLayout(plan, candidate.layout),
      );
    },
    { markLayoutExplicit: true },
  );
}

function updateLayoutLevel(index: number, value: number | null): void {
  if (value === null) {
    return;
  }
  updateCurrent(
    (document) => {
      const entry = document.layout[index];
      if (entry) {
        entry.level = value;
        document.plans.forEach((plan) =>
          resizeRoomsForLayout(plan, document.layout),
        );
      }
    },
    { markLayoutExplicit: true },
  );
}

function normalizeRoomProduct(type: RoomKey, room: RoomAssignment): void {
  const product = room.product;
  if (type !== "trading" && type !== "manufacture") {
    delete room.product;
    delete room.sourceMaterial;
    return;
  }
  const isValid =
    type === "trading"
      ? product === "LMD" || product === "Orundum"
      : type === "manufacture"
        ? product === "Pure Gold" ||
          product === "Battle Record" ||
          product === "Originium Shard"
        : false;
  if (!isValid) {
    delete room.product;
    delete room.sourceMaterial;
  }
}

function updateLayoutType(index: number, value: string): void {
  if (!ROOM_ORDER.includes(value as RoomKey)) {
    return;
  }

  updateCurrent(
    (document) => {
      const entry = document.layout[index];
      if (!entry) {
        return;
      }
      const nextType = value as RoomKey;
      if (entry.type === nextType) {
        return;
      }
      if (entry.type === "control") {
        throw new ScheduleError("控制中枢不可更换设施类型");
      }

      const baseLayout = document.layout.filter(
        (_layoutEntry, entryIndex) => entryIndex !== index,
      );
      const result = canAddLayoutEntry(baseLayout, nextType);
      if (!result.ok) {
        throw new ScheduleError(result.reason);
      }

      const previousType = entry.type;
      const previousPosition = document.layout
        .slice(0, index)
        .filter((layoutEntry) => layoutEntry.type === previousType).length;
      const nextPosition = document.layout
        .slice(0, index)
        .filter((layoutEntry) => layoutEntry.type === nextType).length;

      document.plans.forEach((plan) => {
        const previousRooms = Array.isArray(plan.rooms[previousType])
          ? [...(plan.rooms[previousType] as RoomAssignment[])]
          : [];
        const movedRoom = previousRooms.splice(previousPosition, 1)[0] ?? {
          skip: true,
        };
        if (previousRooms.length > 0) {
          plan.rooms[previousType] = previousRooms;
        } else {
          delete plan.rooms[previousType];
        }

        const nextRooms = Array.isArray(plan.rooms[nextType])
          ? [...(plan.rooms[nextType] as RoomAssignment[])]
          : [];
        normalizeRoomProduct(nextType, movedRoom);
        nextRooms.splice(nextPosition, 0, movedRoom);
        plan.rooms[nextType] = nextRooms;
      });

      entry.type = nextType;
      entry.level = Math.min(entry.level, layoutEntryLevelMax(nextType));
      document.plans.forEach((plan) =>
        resizeRoomsForLayout(plan, document.layout),
      );
    },
    { markLayoutExplicit: true },
  );
}

function cascadeLayoutTypes(type: RoomKey): RoomKey[] {
  if (type === "meeting") {
    return ["processing", "hire", "training"];
  }
  if (type === "processing") {
    return ["hire", "training"];
  }
  if (type === "hire") {
    return ["training"];
  }
  return [];
}

function removeLayoutEntry(index: number): void {
  const document = currentDocument.value;
  const entry = document?.layout[index];
  if (!document || !entry) {
    return;
  }
  if (entry.type === "control") {
    setError(new ScheduleError("控制中枢不可删除"));
    return;
  }

  const removedTypes = new Set<RoomKey>([
    entry.type,
    ...cascadeLayoutTypes(entry.type),
  ]);
  const cascadedTypes = new Set<RoomKey>(cascadeLayoutTypes(entry.type));
  updateCurrent(
    (candidate) => {
      const removedPositions = new Map<RoomKey, number[]>();
      candidate.layout.forEach((layoutEntry, layoutIndex) => {
        if (!removedTypes.has(layoutEntry.type)) {
          return;
        }
        const positions = removedPositions.get(layoutEntry.type) ?? [];
        const position = candidate.layout
          .slice(0, layoutIndex)
          .filter(
            (previousEntry) => previousEntry.type === layoutEntry.type,
          ).length;
        if (layoutIndex === index || layoutEntry.type !== entry.type) {
          positions.push(position);
        }
        removedPositions.set(layoutEntry.type, positions);
      });

      candidate.plans.forEach((plan) => {
        ROOM_ORDER.forEach((type) => {
          const positions = removedPositions.get(type);
          if (!positions?.length) {
            return;
          }
          const rooms = Array.isArray(plan.rooms[type])
            ? (plan.rooms[type] as RoomAssignment[])
            : [];
          const nextRooms = rooms.filter(
            (_room, position) => !positions.includes(position),
          );
          if (nextRooms.length > 0) {
            plan.rooms[type] = nextRooms;
          } else {
            delete plan.rooms[type];
          }
        });
      });

      candidate.layout = candidate.layout.filter((layoutEntry, layoutIndex) => {
        if (layoutIndex === index) {
          return false;
        }
        return !cascadedTypes.has(layoutEntry.type);
      });
      candidate.plans.forEach((plan) =>
        resizeRoomsForLayout(plan, candidate.layout),
      );
    },
    { markLayoutExplicit: true },
  );
}

function addPlan(): void {
  updateCurrent((document) => {
    const previous = document.plans[document.plans.length - 1];
    const plan = previous
      ? (JSON.parse(JSON.stringify(previous)) as Plan)
      : {
          name: "",
          duration: 720,
          rooms: roomsForLayout(document.layout),
        };
    plan.name = `队列${document.plans.length + 1}`;
    document.plans.push(plan);
  });
}

function duplicatePlan(planIndex: number): void {
  updateCurrent((document) => {
    const source = document.plans[planIndex];
    if (!source) {
      return;
    }
    const copy = JSON.parse(JSON.stringify(source)) as Plan;
    copy.name = `${source.name?.trim() || `队列${planIndex + 1}`} 副本`;
    document.plans.splice(planIndex + 1, 0, copy);
  });
}

function removePlan(planIndex: number): void {
  if ((currentDocument.value?.plans.length ?? 0) <= 1) {
    setError(new ScheduleError("队列数量最少为 1"));
    return;
  }
  updateCurrent((document) => {
    document.plans.splice(planIndex, 1);
  });
}

function roomAt(
  plan: Plan,
  type: RoomKey,
  position: number,
): RoomAssignment | undefined {
  const rooms = plan.rooms[type];
  return Array.isArray(rooms)
    ? (rooms[position] as RoomAssignment | undefined)
    : undefined;
}

function updatePlanRoom(
  planIndex: number,
  type: RoomKey,
  position: number,
  update: (room: RoomAssignment) => void,
): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex];
    if (!plan) {
      return;
    }
    const rooms = Array.isArray(plan.rooms[type])
      ? [...(plan.rooms[type] as RoomAssignment[])]
      : [];
    const expected = document.layout.filter(
      (entry) => entry.type === type,
    ).length;
    while (rooms.length < expected) {
      rooms.push({ skip: true });
    }
    const room = rooms[position];
    if (!room) {
      return;
    }
    update(room);
    plan.rooms[type] = rooms;
  });
}

function roomEntries(
  row: FacilityRow,
  plan: Plan,
): Array<{ entry: FacilityEntry; room?: RoomAssignment }> {
  return row.entries.map((entry) => ({
    entry,
    room: roomAt(plan, row.type, entry.position),
  }));
}

function roomProducts(row: FacilityRow, plan: Plan): string[] {
  return Array.from(
    new Set(
      roomEntries(row, plan)
        .map(({ room }) => room?.product)
        .filter((product): product is string => Boolean(product)),
    ),
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
          (option) => option.value === "LMD" || option.value === "Orundum",
        )
      : PRODUCT_OPTIONS.filter(
          (option) => option.value !== "LMD" && option.value !== "Orundum",
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
      label:
        UNSUPPORTED_PRODUCT_LABELS[currentProduct] ??
        `${currentProduct}（仅保留）`,
      disabled: true,
    });
  }
  return result;
}

function sourceValue(room: RoomAssignment | undefined): string {
  return (
    room?.sourceMaterial ??
    (room?.product === "Originium Shard" ? DEFAULT_SOURCE_MATERIAL : "")
  );
}

function sourceVisible(room: RoomAssignment | undefined): boolean {
  return room?.product === "Originium Shard";
}

function updateRoomSkip(
  planIndex: number,
  type: RoomKey,
  position: number,
  skip: boolean,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    if (skip) {
      room.skip = true;
    } else {
      delete room.skip;
    }
  });
}

function updateRoomProduct(
  planIndex: number,
  type: RoomKey,
  position: number,
  product: string,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    if (!product) {
      delete room.product;
      delete room.sourceMaterial;
      return;
    }
    room.product = product;
    if (product === "Originium Shard") {
      room.sourceMaterial ||= DEFAULT_SOURCE_MATERIAL;
    } else {
      delete room.sourceMaterial;
    }
  });
}

function updateRoomSource(
  planIndex: number,
  type: RoomKey,
  position: number,
  sourceMaterial: string,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    if (sourceMaterial) {
      room.sourceMaterial = sourceMaterial;
    } else {
      delete room.sourceMaterial;
    }
  });
}

function operatorSlotKey(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): string {
  return `${planIndex}-${type}-${position}-${slotIndex}`;
}

function operatorNameAt(
  plan: Plan,
  type: RoomKey,
  position: number,
  slotIndex: number,
): string {
  return roomAt(plan, type, position)?.operators?.[slotIndex] ?? "";
}

function operatorDraftValue(
  plan: Plan,
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): string {
  const key = operatorSlotKey(planIndex, type, position, slotIndex);
  return (
    draftOperatorNames.value[key] ??
    operatorNameAt(plan, type, position, slotIndex)
  );
}

function handleOperatorDraft(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
  value: string,
): void {
  draftOperatorNames.value[
    operatorSlotKey(planIndex, type, position, slotIndex)
  ] = value;
}

function operatorElite(
  room: RoomAssignment | undefined,
  name: string,
): EliteLevel {
  const state = operatorState(room, name);
  if (state.elite === 1 || state.elite === 2) {
    return state.elite;
  }
  return 0;
}

function operatorMood(
  room: RoomAssignment | undefined,
  name: string,
): number | undefined {
  return operatorState(room, name).mood;
}

function operatorEliteValue(
  room: RoomAssignment | undefined,
  name: string,
): number | undefined {
  return operatorState(room, name).elite;
}

function updateOperatorState(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
  key: "mood" | "elite",
  value: number | null,
): void {
  const plan = currentDocument.value?.plans[planIndex];
  const name = plan ? operatorNameAt(plan, type, position, slotIndex) : "";
  if (!name) {
    return;
  }

  updatePlanRoom(planIndex, type, position, (room) => {
    const states = room.operatorStates ?? {};
    const state = states[name] ?? {};
    if (value === null) {
      delete state[key];
    } else {
      state[key] = value;
    }
    if (Object.keys(state).length > 0) {
      states[name] = state;
    } else {
      delete states[name];
    }
    if (Object.keys(states).length > 0) {
      room.operatorStates = states;
    } else {
      delete room.operatorStates;
    }
  });
}

function slotRefs(row: FacilityRow): FacilitySlotRef[] {
  return row.entries.flatMap((entry) =>
    Array.from(
      { length: roomSlotCount(row.type, entry.entry.level) },
      (_, slotIndex) => ({ entry, slotIndex }),
    ),
  );
}

const SIMULATOR_SLOT_WIDTH = 112;
const SIMULATOR_SLOT_GAP = 8;
const SIMULATOR_FACILITY_MIN_WIDTH = 224;

function facilityCardWidth(row: FacilityRow): string {
  const slotCount = Math.max(1, slotRefs(row).length);
  const contentWidth =
    slotCount * SIMULATOR_SLOT_WIDTH + (slotCount - 1) * SIMULATOR_SLOT_GAP;
  return `${Math.max(SIMULATOR_FACILITY_MIN_WIDTH, contentWidth + 40)}px`;
}

function productAccent(product: string): string | undefined {
  if (!isProductColorKey(product)) {
    return undefined;
  }
  return productColors.value[product] ?? PRODUCT_REPRESENTATIVE_COLORS[product];
}

function facilityCardStyle(
  row: FacilityRow,
  plans: Plan[],
): Record<string, string> {
  const planProducts = plans.map((plan) => {
    const products = roomProducts(row, plan);
    return products.length === 1 ? products[0] : "";
  });
  const commonProduct = planProducts[0];
  const commonAccent =
    commonProduct && planProducts.every((product) => product === commonProduct)
      ? productAccent(commonProduct)
      : undefined;

  return {
    "--simulator-facility-accent":
      commonAccent ??
      facilityColors.value[row.type] ??
      ROOM_REPRESENTATIVE_COLORS[row.type],
  };
}

function facilityQueueStyle(
  row: FacilityRow,
  plan: Plan,
): Record<string, string> {
  const products = roomProducts(row, plan);
  const product = products.length === 1 ? products[0] : undefined;
  const accent = product ? productAccent(product) : undefined;

  return {
    "--simulator-facility-accent":
      accent ??
      facilityColors.value[row.type] ??
      ROOM_REPRESENTATIVE_COLORS[row.type],
  };
}

function slotRoom(
  plan: Plan,
  slot: FacilitySlotRef,
): RoomAssignment | undefined {
  return roomAt(plan, slot.entry.entry.type, slot.entry.position);
}

function slotName(
  row: FacilityRow,
  plan: Plan,
  planIndex: number,
  slot: FacilitySlotRef,
): string {
  return operatorDraftValue(
    plan,
    planIndex,
    row.type,
    slot.entry.position,
    slot.slotIndex,
  );
}

function slotOperator(
  row: FacilityRow,
  plan: Plan,
  planIndex: number,
  slot: FacilitySlotRef,
): Operator | undefined {
  return operatorByName(slotName(row, plan, planIndex, slot));
}

function commitOperatorName(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): void {
  const document = currentDocument.value;
  const plan = document?.plans[planIndex];
  if (!document || !plan) {
    return;
  }

  const key = operatorSlotKey(planIndex, type, position, slotIndex);
  const nextName = draftOperatorNames.value[key]?.trim() ?? "";
  const previousName = operatorNameAt(plan, type, position, slotIndex);
  if (nextName === previousName) {
    delete draftOperatorNames.value[key];
    return;
  }

  const updated = updateCurrent((candidate) => {
    const candidatePlan = candidate.plans[planIndex];
    if (!candidatePlan) {
      return;
    }
    const rooms = Array.isArray(candidatePlan.rooms[type])
      ? [...(candidatePlan.rooms[type] as RoomAssignment[])]
      : [];
    const room = rooms[position] ?? {};
    const capacity = candidate.layout.filter((entry) => entry.type === type)[
      position
    ];
    const slotLimit = capacity ? roomSlotCount(type, capacity.level) : 0;
    const names = Array.from(
      { length: slotLimit },
      (_, index) => room.operators?.[index] ?? "",
    );
    names[slotIndex] = nextName;
    const compactNames = names.filter(Boolean);
    if (nextName) {
      const duplicate = Object.entries(candidatePlan.rooms).some(
        ([roomType, roomList]) => {
          if (!Array.isArray(roomList)) {
            return false;
          }
          return roomList.some((candidateRoom, roomPosition) => {
            const otherRoom = candidateRoom as RoomAssignment;
            return (
              (roomType !== type ||
                roomPosition !== position ||
                otherRoom.operators?.indexOf(nextName) !== slotIndex) &&
              otherRoom.operators?.includes(nextName)
            );
          });
        },
      );
      if (duplicate) {
        throw new ScheduleError(
          `干员“${nextName}”已在当前队列的其他设施中配置`,
        );
      }
    }
    const nextStates: Record<string, OperatorState> = {};
    compactNames.forEach((name) => {
      const state = room.operatorStates?.[name];
      if (state) {
        nextStates[name] = state;
      }
    });
    room.operators = compactNames;
    if (compactNames.length === 0) {
      room.skip = true;
    } else {
      delete room.skip;
    }
    if (Object.keys(nextStates).length > 0) {
      room.operatorStates = nextStates;
    } else {
      delete room.operatorStates;
    }
    rooms[position] = room;
    candidatePlan.rooms[type] = rooms;
  });
  if (updated) {
    delete draftOperatorNames.value[key];
  }
}

function planDurationHours(plan: Plan): string {
  const minutes = Number(plan.duration ?? 720);
  return `${(minutes / 60).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 小时`;
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits });
}

function signedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatProduction(value: number): string {
  return formatNumber(value, 3);
}

function planFacilityResult(
  row: FacilityRow,
  planIndex: number,
): FacilityEfficiencyResult | undefined {
  const plan = efficiencyResult.value?.plans[planIndex];
  if (!plan) {
    return undefined;
  }
  const entry = row.entries[0];
  const facilityId =
    row.type === "power"
      ? "power-1"
      : `${row.type}-${(entry?.position ?? 0) + 1}`;
  return plan.facilities.find((result) => result.facility.id === facilityId);
}

function facilityResultLabel(result: FacilityEfficiencyResult): string {
  const { facility } = result;
  if (facility.type === "power") {
    return `${ROOM_LABELS[facility.type]}（合并）`;
  }
  const count =
    currentDocument.value?.layout.filter(
      (entry) => entry.type === facility.type,
    ).length ?? 0;
  return `${ROOM_LABELS[facility.type]}${count > 1 ? ` ${facility.index + 1}` : ""}`;
}

const efficiencyStatLabels: Record<string, string> = {
  tradeSpd: "贸易效率",
  tradeNetEff: "贸易净效率",
  manuProd: "制造效率",
  clueSpeed: "线索速度",
  clueChance: "线索概率",
  hireSpd: "公开招募效率",
  droneCharge: "无人机充能",
  orderLimit: "订单上限",
  storageCap: "仓库容量",
  facBase: "设施基础效率",
  abyssalBoost: "深海效果",
};

function efficiencyStatLabel(stat: string): string {
  return efficiencyStatLabels[stat] ?? stat;
}

function productionMaterials(value: ProductionValue): string[] {
  return Object.entries(value.materialPerHour ?? {}).map(
    ([material, amount]) => `${material} ${signedNumber(amount)}/小时`,
  );
}

async function refreshEfficiencyCatalog(): Promise<void> {
  const requestVersion = ++catalogRequestVersion;
  efficiencyCatalog.value = undefined;
  efficiencyError.value = "";
  if (
    !efficiencySupported.value ||
    !baseDataReady.value ||
    operators.value.length === 0
  ) {
    efficiencyLoading.value = false;
    return;
  }

  efficiencyLoading.value = true;
  try {
    const catalog = await loadEfficiencyCatalog(operators.value, terms.value);
    if (
      requestVersion !== catalogRequestVersion ||
      selectedDataSource.value !== "torappu"
    ) {
      return;
    }
    efficiencyCatalog.value = catalog;
  } catch (error: unknown) {
    if (requestVersion !== catalogRequestVersion) {
      return;
    }
    efficiencyError.value =
      error instanceof Error ? error.message : "效率数据读取失败";
  } finally {
    if (requestVersion === catalogRequestVersion) {
      efficiencyLoading.value = false;
    }
  }
}

function operatorByName(name: string): Operator | undefined {
  return operators.value.find((operator) => operator.name === name);
}

function operatorState(
  room: RoomAssignment | undefined,
  name: string,
): OperatorState {
  return room?.operatorStates?.[name] ?? {};
}

function handleCreate(): void {
  clearMessages();
  createDocument();
  successMessage.value = "已新建排班表。";
}

function openFilePicker(): void {
  fileInput.value?.click();
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }

  clearMessages();
  try {
    const parsed = DEFAULT_SCHEDULE_ADAPTER.parse(await file.text());
    createDocument(parsed.document, parsed.inferredLayout, file.name);
    successMessage.value = parsed.inferredLayout
      ? "已导入，布局由文件内容推断。"
      : "已导入排班 JSON。";
  } catch (error: unknown) {
    setError(error);
  }
}

function handleDuplicate(): void {
  clearMessages();
  const document = activeDocument.value;
  if (!document) {
    return;
  }
  duplicateDocument(document.id);
  successMessage.value = "已复制排班表。";
}

function handleDelete(): void {
  const document = activeDocument.value;
  if (!document) {
    return;
  }
  if (
    !window.confirm(
      `确定删除“${document.document.title || "未命名排班表"}”吗？`,
    )
  ) {
    return;
  }
  removeDocument(document.id);
  successMessage.value = "已删除排班表。";
}

function handleExport(): void {
  const document = currentDocument.value;
  if (!document) {
    return;
  }

  clearMessages();
  try {
    const json = DEFAULT_SCHEDULE_ADAPTER.serialize(document);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${(document.title?.trim() || "排班模拟器").replace(/[\\/:*?"<>|]/g, "_")}.${DEFAULT_SCHEDULE_ADAPTER.fileExtension}`;
    link.click();
    URL.revokeObjectURL(url);
    successMessage.value = "已导出严格 JSON 文件。";
  } catch (error: unknown) {
    setError(error);
  }
}

function isStoredDocument(document: StoredDocument): boolean {
  return document.id === activeDocumentId.value;
}

watch(activeDocumentId, () => {
  draftOperatorNames.value = {};
});

watch(
  [baseDataReady, selectedDataSource],
  () => {
    void refreshEfficiencyCatalog();
  },
  { immediate: true },
);
</script>

<template>
  <div class="page-shell simulator-page">
    <div class="page-heading">
      <div
        class="page-heading-icon simulator-page-heading-icon"
        aria-hidden="true"
      >
        <ClusterOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title"
          >排班模拟器</a-typography-title
        >
        <span class="page-heading-description"
          >按设施与队列查看排班，保留干员状态与布局关系</span
        >
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
          <a-button
            aria-label="新建排班表"
            title="新建排班表"
            type="text"
            @click="handleCreate"
          >
            <template #icon><PlusOutlined /></template>
          </a-button>
        </div>
        <div class="simulator-sidebar-actions">
          <a-button block @click="openFilePicker">
            <template #icon><UploadOutlined /></template>
            导入 JSON
          </a-button>
          <input
            ref="fileInput"
            accept=".json,application/json"
            hidden
            type="file"
            @change="handleFileChange"
          />
        </div>
        <div class="simulator-document-list">
          <button
            v-for="document in documents"
            :key="document.id"
            :class="[
              'simulator-document-item',
              { 'simulator-document-item--active': isStoredDocument(document) },
            ]"
            type="button"
            @click="setActiveDocument(document.id)"
          >
            <span class="simulator-document-item-title">{{
              document.document.title || "未命名排班表"
            }}</span>
            <span class="simulator-document-item-meta">
              {{ document.document.plans.length }} 个队列
              <span v-if="document.inferredLayout"> · 推断布局</span>
            </span>
          </button>
          <a-empty
            v-if="!documents.length"
            :image="undefined"
            description="暂无排班表"
          />
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
            <a-tag color="cyan"
              >{{ currentDocument.plans.length }} 个队列</a-tag
            >
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
                  @update:value="
                    (value: string) => updateMeta('description', value)
                  "
                />
              </a-form-item>
            </div>
          </a-form>
          <div class="simulator-layout-summary">
            <span class="simulator-summary-label">设施布局</span>
            <a-tag
              v-for="group in layoutGroups"
              :key="group.type"
              color="green"
            >
              {{ group.label }} × {{ group.entries.length }}
            </a-tag>
          </div>
          <div class="simulator-power-summary">
            <span class="simulator-summary-label">电力</span>
            <a-tag color="orange">消耗 {{ powerSummary.used }}</a-tag>
            <a-tag color="green">提供 {{ powerSummary.provided }}</a-tag>
            <a-tag :color="powerSummary.net < 0 ? 'red' : 'cyan'">
              净 {{ powerSummary.net >= 0 ? "+" : "" }}{{ powerSummary.net }}
            </a-tag>
          </div>
        </a-card>

        <a-card
          :bordered="false"
          class="simulator-layout-panel"
          title="设施布局"
        >
          <template #extra>
            <a-space :size="6">
              <a-select
                v-model:value="newLayoutType"
                :options="layoutAddOptions"
                class="simulator-layout-add-select"
                placeholder="选择设施"
                size="small"
              />
              <a-button
                :disabled="
                  !currentDocument ||
                  !canAddLayoutEntry(currentDocument.layout, newLayoutType).ok
                "
                size="small"
                @click="addLayoutEntry"
              >
                <template #icon><PlusOutlined /></template>
                添加设施
              </a-button>
            </a-space>
          </template>
          <div class="simulator-layout-list">
            <div
              v-for="(entry, index) in currentDocument.layout"
              :key="`${entry.type}-${index}`"
              class="simulator-layout-row"
            >
              <span class="simulator-layout-order">{{ index + 1 }}</span>
              <a-select
                :disabled="entry.type === 'control'"
                :options="layoutTypeOptions(index)"
                :value="entry.type"
                class="simulator-layout-type"
                @update:value="
                  (value: string) => updateLayoutType(index, value)
                "
              />
              <a-input-number
                :max="layoutEntryLevelMax(entry.type)"
                :min="1"
                :value="entry.level"
                addon-after="级"
                class="simulator-layout-level"
                @update:value="
                  (value: number | null) => updateLayoutLevel(index, value)
                "
              />
              <a-button
                :disabled="entry.type === 'control'"
                aria-label="删除设施"
                danger
                title="删除设施"
                type="text"
                @click="removeLayoutEntry(index)"
              >
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </div>
          </div>
        </a-card>

        <a-row :gutter="[10, 10]" class="simulator-facility-grid">
          <a-col class="simulator-queue-column" flex="0 0 220px">
            <a-card
              :bordered="false"
              class="simulator-column-card simulator-queue-card"
              title="队列信息"
            >
              <template #extra>
                <a-button size="small" @click="addPlan">
                  <template #icon><PlusOutlined /></template>
                  新增
                </a-button>
              </template>
              <div class="simulator-queue-entries">
                <div
                  v-for="(plan, planIndex) in currentDocument.plans"
                  :key="`queue-${planIndex}`"
                  class="simulator-queue-info"
                >
                  <div class="simulator-queue-info-main">
                    <a-input
                      :value="plan.name ?? ''"
                      class="simulator-queue-entry-title"
                      placeholder="队列名称"
                      size="small"
                      @update:value="
                        (value: string) =>
                          updatePlanMeta(planIndex, 'name', value)
                      "
                    />
                    <a-input-number
                      :max="1440"
                      :min="60"
                      :value="plan.duration ?? 720"
                      addon-after="分钟"
                      class="simulator-queue-duration"
                      size="small"
                      @update:value="
                        (value: number | null) =>
                          updatePlanDuration(planIndex, value)
                      "
                    />
                  </div>
                  <span class="simulator-queue-duration-summary">{{
                    planDurationHours(plan)
                  }}</span>
                  <a-input
                    :value="plan.description ?? ''"
                    class="simulator-queue-description"
                    placeholder="队列描述（可选）"
                    size="small"
                    @update:value="
                      (value: string) =>
                        updatePlanMeta(planIndex, 'description', value)
                    "
                  />
                  <div class="simulator-queue-info-actions">
                    <a-button size="small" @click="duplicatePlan(planIndex)">
                      <template #icon><CopyOutlined /></template>
                      复制队列
                    </a-button>
                    <a-button
                      :disabled="currentDocument.plans.length <= 1"
                      danger
                      size="small"
                      @click="removePlan(planIndex)"
                    >
                      <template #icon><DeleteOutlined /></template>
                      删除
                    </a-button>
                  </div>
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
              :style="facilityCardStyle(row, currentDocument.plans)"
            >
              <template #title>
                <div class="simulator-facility-title">
                  <span>{{ row.label }}</span>
                  <a-space :size="4" wrap>
                    <a-tag
                      v-for="entry in row.entries"
                      :key="entry.index"
                      color="gold"
                      >Lv {{ entry.entry.level }}</a-tag
                    >
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
                  :style="facilityQueueStyle(row, plan)"
                >
                  <div class="simulator-facility-queue-content">
                    <div class="simulator-facility-queue-meta">
                      <div class="simulator-room-controls">
                        <div
                          v-for="({ entry, room }, entryIndex) in roomEntries(
                            row,
                            plan,
                          )"
                          :key="`room-controls-${entryIndex}`"
                          class="simulator-room-control"
                        >
                          <span
                            v-if="row.entries.length > 1"
                            class="simulator-room-control-label"
                          >
                            {{ ROOM_LABELS[row.type] }} {{ entry.position + 1 }}
                          </span>
                          <a-select
                            v-if="roomHasProduct(row.type)"
                            :options="productOptions(row.type, room?.product)"
                            :value="room?.product ?? ''"
                            class="simulator-room-product"
                            placeholder="产物"
                            size="small"
                            @update:value="
                              (value: string) =>
                                updateRoomProduct(
                                  planIndex,
                                  row.type,
                                  entry.position,
                                  value,
                                )
                            "
                          />
                          <a-select
                            v-if="
                              roomHasProduct(row.type) && sourceVisible(room)
                            "
                            :options="[
                              { value: '', label: '未指定原料' },
                              ...SOURCE_MATERIAL_OPTIONS,
                            ]"
                            :value="sourceValue(room)"
                            class="simulator-room-source"
                            placeholder="原料"
                            size="small"
                            @update:value="
                              (value: string) =>
                                updateRoomSource(
                                  planIndex,
                                  row.type,
                                  entry.position,
                                  value,
                                )
                            "
                          />
                          <a-checkbox
                            :checked="room?.skip === true"
                            @change="
                              (event: { target: { checked: boolean } }) =>
                                updateRoomSkip(
                                  planIndex,
                                  row.type,
                                  entry.position,
                                  event.target.checked,
                                )
                            "
                          >
                            跳过
                          </a-checkbox>
                        </div>
                      </div>
                    </div>
                    <div class="simulator-slot-grid">
                      <div
                        v-for="slot in slotRefs(row)"
                        :key="`${planIndex}-${slot.entry.position}-${slot.slotIndex}`"
                        class="simulator-slot"
                      >
                        <OperatorAvatarDisplay
                          v-if="slotOperator(row, plan, planIndex, slot)"
                          :data-source="selectedDataSource"
                          :elite-level="
                            operatorElite(
                              slotRoom(plan, slot),
                              slotName(row, plan, planIndex, slot),
                            )
                          "
                          :operator="slotOperator(row, plan, planIndex, slot)!"
                          :show-elite-level="true"
                          :show-name="false"
                          :show-profession="true"
                          :show-rarity="true"
                          :plain="true"
                          :size="72"
                        />
                        <a-avatar
                          v-else
                          :size="72"
                          class="simulator-empty-avatar"
                          shape="square"
                        >
                          {{ slotName(row, plan, planIndex, slot) || "空槽位" }}
                        </a-avatar>
                        <a-auto-complete
                          :options="operatorOptions"
                          :value="slotName(row, plan, planIndex, slot)"
                          class="simulator-slot-input"
                          placeholder="干员名称"
                          @blur="
                            commitOperatorName(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @press-enter="
                            commitOperatorName(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @update:value="
                            (value: string) =>
                              handleOperatorDraft(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                                value,
                              )
                          "
                        />
                        <div class="simulator-slot-state">
                          <a-input-number
                            :disabled="!slotName(row, plan, planIndex, slot)"
                            :max="24"
                            :min="0"
                            :value="
                              operatorMood(
                                slotRoom(plan, slot),
                                slotName(row, plan, planIndex, slot),
                              )
                            "
                            class="simulator-slot-state-input"
                            placeholder="心情"
                            size="small"
                            @update:value="
                              (value: number | null) =>
                                updateOperatorState(
                                  planIndex,
                                  row.type,
                                  slot.entry.position,
                                  slot.slotIndex,
                                  'mood',
                                  value,
                                )
                            "
                          />
                          <a-input-number
                            :disabled="!slotName(row, plan, planIndex, slot)"
                            :max="2"
                            :min="0"
                            :value="
                              operatorEliteValue(
                                slotRoom(plan, slot),
                                slotName(row, plan, planIndex, slot),
                              )
                            "
                            class="simulator-slot-state-input"
                            placeholder="精英"
                            size="small"
                            @update:value="
                              (value: number | null) =>
                                updateOperatorState(
                                  planIndex,
                                  row.type,
                                  slot.entry.position,
                                  slot.slotIndex,
                                  'elite',
                                  value,
                                )
                            "
                          />
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="
                        efficiencySupported &&
                        planFacilityResult(row, planIndex)
                      "
                      class="simulator-efficiency-summary"
                    >
                      <div
                        class="simulator-efficiency-summary-line simulator-efficiency-summary-line--total"
                      >
                        <strong
                          >{{
                            signedNumber(
                              planFacilityResult(row, planIndex)
                                ?.combinationEfficiency ?? 0,
                            )
                          }}
                          /
                          {{
                            formatNumber(
                              planFacilityResult(row, planIndex)?.efficiency ??
                                0,
                            )
                          }}%</strong
                        >
                      </div>
                    </div>
                  </div>
                </a-card>
              </div>
            </a-card>
          </a-col>
        </a-row>

        <a-card
          v-if="efficiencySupported"
          :bordered="false"
          class="simulator-efficiency-panel"
          title="计算结果"
        >
          <a-alert
            v-if="efficiencyLoading"
            message="正在读取干员技能数据并计算效率"
            show-icon
            type="info"
          />
          <a-alert
            v-else-if="efficiencyError"
            :message="efficiencyError"
            show-icon
            type="error"
          />
          <template v-else-if="efficiencyResult">
            <div class="simulator-daily-output">
              <div class="simulator-result-section-heading">
                <div>
                  <span class="simulator-eyebrow">DAILY OUTPUT</span>
                  <h3>排班表每日产出</h3>
                </div>
                <a-tag color="blue">
                  循环 {{ formatNumber(efficiencyResult.dailyHours) }} 小时
                </a-tag>
              </div>
              <div
                v-if="efficiencyResult.dailyProductions.length"
                class="simulator-daily-output-grid"
              >
                <div
                  v-for="production in efficiencyResult.dailyProductions"
                  :key="production.product"
                  class="simulator-daily-output-item"
                >
                  <span class="simulator-daily-output-product">{{
                    production.product
                  }}</span>
                  <strong
                    >{{ formatProduction(production.amountPerDay) }} /
                    天</strong
                  >
                  <span class="simulator-daily-output-rate">
                    {{ formatProduction(production.amountPerHour) }} / 小时
                  </span>
                  <span
                    v-for="material in productionMaterials(production)"
                    :key="material"
                    class="simulator-daily-output-material"
                    >{{ material }}</span
                  >
                </div>
              </div>
              <a-empty
                v-else
                :image="undefined"
                description="当前排班没有可统计的产出"
              />
            </div>

            <div class="simulator-calculation-steps">
              <div class="simulator-result-section-heading">
                <div>
                  <span class="simulator-eyebrow">CALCULATION STEPS</span>
                  <h3>计算步骤</h3>
                </div>
                <span class="simulator-result-hint"
                  >展开设施查看生效技能明细</span
                >
              </div>
              <a-collapse ghost>
                <a-collapse-panel
                  v-for="(
                    result, resultIndex
                  ) in efficiencyResult.plans.flatMap((plan, planIndex) =>
                    plan.facilities.map((facility) => ({
                      plan,
                      planIndex,
                      facility,
                    })),
                  )"
                  :key="`${result.planIndex}-${result.facility.facility.id}-${resultIndex}`"
                >
                  <template #header>
                    <div class="simulator-step-header">
                      <span
                        >{{ result.plan.name }} ·
                        {{ facilityResultLabel(result.facility) }}</span
                      >
                      <strong
                        >{{ formatNumber(result.facility.efficiency) }}%</strong
                      >
                    </div>
                  </template>
                  <div class="simulator-step-content">
                    <div class="simulator-step-formula">
                      {{ formatNumber(result.facility.baseEfficiency) }} +
                      {{ formatNumber(result.facility.operatorEfficiency) }} +
                      {{ formatNumber(result.facility.skillEfficiency) }} =
                      <strong
                        >{{ formatNumber(result.facility.efficiency) }}%</strong
                      >
                    </div>
                    <div class="simulator-step-stat-grid">
                      <span>基础效率</span>
                      <strong>{{
                        formatNumber(result.facility.baseEfficiency)
                      }}</strong>
                      <span>干员效率</span>
                      <strong>{{
                        formatNumber(result.facility.operatorEfficiency)
                      }}</strong>
                      <span>技能/组合效率</span>
                      <strong>{{
                        signedNumber(result.facility.skillEfficiency)
                      }}</strong>
                      <span>组合效率</span>
                      <strong>{{
                        signedNumber(result.facility.combinationEfficiency)
                      }}</strong>
                    </div>
                    <div
                      v-if="result.facility.operatorContributions.length"
                      class="simulator-operator-contribution-list"
                    >
                      <span class="simulator-step-subheading"
                        >干员组合贡献</span
                      >
                      <div
                        v-for="contribution in result.facility
                          .operatorContributions"
                        :key="contribution.operator"
                        class="simulator-operator-contribution"
                      >
                        <span>{{ contribution.operator }}</span>
                        <span
                          >{{ signedNumber(contribution.efficiency) }}（基础
                          {{ signedNumber(contribution.baseEfficiency) }}，技能
                          {{
                            signedNumber(contribution.skillEfficiency)
                          }}）</span
                        >
                      </div>
                    </div>
                    <div
                      v-if="result.facility.details.length"
                      class="simulator-detail-list"
                    >
                      <span class="simulator-step-subheading"
                        >生效技能明细</span
                      >
                      <div
                        v-for="(detail, detailIndex) in result.facility.details"
                        :key="`${detail.operator}-${detail.skill ?? 'skill'}-${detail.stat}-${detailIndex}`"
                        class="simulator-detail-row"
                      >
                        <span
                          >{{ detail.operator
                          }}<template v-if="detail.skill">
                            · {{ detail.skill }}</template
                          ></span
                        >
                        <span
                          >{{ efficiencyStatLabel(detail.stat) }}
                          {{ signedNumber(detail.value) }}</span
                        >
                      </div>
                    </div>
                    <a-empty
                      v-else
                      :image="undefined"
                      class="simulator-step-empty"
                      description="当前设施没有可展开的技能明细"
                    />
                  </div>
                </a-collapse-panel>
              </a-collapse>
            </div>
          </template>
        </a-card>

        <a-alert
          v-else-if="!efficiencySupported"
          message="效率计算暂只支持 Torappu 数据源"
          class="simulator-efficiency-source-alert"
          show-icon
          type="info"
        />

        <a-alert
          v-if="extraRooms.length"
          :message="`发现 ${extraRooms.length} 个未登记设施实例`"
          class="simulator-anomaly-alert"
          show-icon
          type="warning"
        >
          <template #description>
            <div class="simulator-anomaly-list">
              <span
                v-for="item in extraRooms"
                :key="`${item.planIndex}-${item.type}-${item.index}`"
              >
                {{ item.planName }} · {{ ROOM_LABELS[item.type] }}
                {{ item.index + 1 }}
                <template v-if="item.room.operators?.length"
                  >：{{ item.room.operators.join("、") }}</template
                >
              </span>
            </div>
          </template>
        </a-alert>
      </main>

      <a-empty
        v-else
        class="simulator-editor-empty"
        description="导入或新建一个排班表"
      >
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
