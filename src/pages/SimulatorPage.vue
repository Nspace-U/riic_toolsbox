<script setup lang="ts">
import {
  CheckOutlined,
  ClusterOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { useAvatarDisplaySizes } from "@/composables/useAvatarDisplaySizes";
import { useDataSource } from "@/composables/useDataSource";
import { useFacilityCardSettings } from "@/composables/useFacilityCardSettings";
import {
  isProductColorKey,
  useFacilityColors,
} from "@/composables/useFacilityColors";
import { useScheduleDocuments } from "@/composables/useScheduleDocuments";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
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
import type {
  OperatorProgressionNode,
  ResolvedOperatorProgression,
} from "@/types/operatorProgression";
import {
  DEFAULT_SOURCE_MATERIAL,
  BUILD_CHAIN_REQUIRED,
  createDefaultRoomAssignment,
  LAYOUT_INPUT_ROWS,
  LAYOUT_TEXT_ROWS,
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
  facilityProductIconFile,
  isFixedLevelRoom,
  orderedLayoutEntries,
  parseLayoutText,
  roomSlotCount,
  roomLevelRange,
  validateSchedule,
} from "@/utils/schedule";
import { calculateEfficiency, loadEfficiencyCatalog } from "@/utils/efficiency";
import {
  getOperatorAvatarNameFontSize,
  getOperatorAvatarNameMinBandMetrics,
  getOperatorAvatarSkippedLabelFontSize,
  OPERATOR_AVATAR_SOURCE_WIDTH,
} from "@/utils/operatorAvatarLayout";
import {
  progressionNodesForFacility,
  resolveOperatorProgression,
} from "@/utils/operatorProgression";

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

interface OperatorSlotAddress {
  planIndex: number;
  type: RoomKey;
  position: number;
  slotIndex: number;
  key: string;
}

interface SlotNameInputInstance {
  $el?: Element;
}

interface FacilityTitleTagPreset {
  fontSize: number;
  padding: number;
}

interface FacilityContextMenuState extends OperatorSlotAddress {
  positions: number[];
  x: number;
  y: number;
}

interface FacilityContextMenuItem {
  key: string;
  label: string;
  check?: boolean;
  disabled?: boolean;
  divider?: boolean;
  action?: () => void;
}

interface FacilityContextMenuSection {
  key: string;
  title: string;
  items: FacilityContextMenuItem[];
}

interface OperatorContextMenuDetails {
  menu: FacilityContextMenuState;
  name: string;
  operator: Operator;
  room: RoomAssignment;
  progressionNodes: OperatorProgressionNode[];
  currentMood: number;
  currentProgression: ResolvedOperatorProgression;
  hasManualProgression: boolean;
}

interface LayoutDisplayRow {
  key: string;
  entries: FacilityEntry[];
}

interface LayoutAdditionPlan {
  types: RoomKey[];
}

interface PowerSummary {
  used: number;
  provided: number;
  net: number;
}

type SimulatorEditSetting = "layout" | "queue" | "product";

interface SimulatorEditSettings {
  layout: boolean;
  queue: boolean;
  product: boolean;
}

const SIMULATOR_EDIT_SETTINGS_STORAGE_KEY =
  "riic-tools:simulator-edit-settings:v1";
const DEFAULT_SIMULATOR_EDIT_SETTINGS: SimulatorEditSettings = {
  layout: true,
  queue: true,
  product: true,
};

const LAYOUT_DISPLAY_ROWS = LAYOUT_TEXT_ROWS;
const LAYOUT_BUILD_ORDER: RoomKey[] = [
  "control",
  "trading",
  "manufacture",
  "power",
  "meeting",
  "processing",
  "hire",
  "training",
  "dormitory",
];

const {
  documents,
  activeDocumentId,
  layoutLevelNotice,
  clearLayoutLevelNotice,
  createDocument,
  getActiveDocument,
  setActiveDocument,
  updateDocument,
  removeDocument,
  duplicateDocument,
} = useScheduleDocuments();
const { operators, terms, ready: baseDataReady } = useBaseData();
const { avatarDisplaySizes } = useAvatarDisplaySizes();
const { facilityCardSettings, facilityCardIconScale } =
  useFacilityCardSettings();
const { selectedDataSource } = useDataSource();
const { facilityColors, productColors } = useFacilityColors();
const { activeProfile, treatSkillsAsUnlocked } = useOperatorProgression();

const simulatorSlotSize = computed(
  () => avatarDisplaySizes.value.simulatorSlot,
);

const slotGridStyle = computed(() => ({
  "--simulator-slot-size": `${simulatorSlotSize.value}px`,
}));

const slotNameBandHeight = computed(
  () =>
    getOperatorAvatarNameMinBandMetrics(
      OPERATOR_AVATAR_SOURCE_WIDTH,
      simulatorSlotSize.value,
    ).height,
);

const slotNameBandStyle = computed(() => ({
  height: `${slotNameBandHeight.value}px`,
  fontSize: `${getOperatorAvatarNameFontSize(simulatorSlotSize.value)}px`,
  lineHeight: `${slotNameBandHeight.value}px`,
}));

const emptySlotFrameStyle = computed(() => ({
  width: `${simulatorSlotSize.value}px`,
  height: `${simulatorSlotSize.value}px`,
}));

const skippedLabelStyle = computed(() => ({
  fontSize: `${getOperatorAvatarSkippedLabelFontSize(simulatorSlotSize.value)}px`,
}));

function normalizeSimulatorEditSettings(value: unknown): SimulatorEditSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_SIMULATOR_EDIT_SETTINGS };
  }
  const candidate = value as Partial<SimulatorEditSettings>;
  return {
    layout:
      typeof candidate.layout === "boolean"
        ? candidate.layout
        : DEFAULT_SIMULATOR_EDIT_SETTINGS.layout,
    queue:
      typeof candidate.queue === "boolean"
        ? candidate.queue
        : DEFAULT_SIMULATOR_EDIT_SETTINGS.queue,
    product:
      typeof candidate.product === "boolean"
        ? candidate.product
        : DEFAULT_SIMULATOR_EDIT_SETTINGS.product,
  };
}

function readSimulatorEditSettings(): Record<string, SimulatorEditSettings> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(
      SIMULATOR_EDIT_SETTINGS_STORAGE_KEY,
    );
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([id, value]) => [
        id,
        normalizeSimulatorEditSettings(value),
      ]),
    );
  } catch {
    return {};
  }
}

function persistSimulatorEditSettings(
  settings: Record<string, SimulatorEditSettings>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SIMULATOR_EDIT_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {}
}

const fileInput = ref<HTMLInputElement>();
const errorMessage = ref("");
const successMessage = ref("");
const layoutLevelFixNotice = layoutLevelNotice.value;
if (layoutLevelFixNotice) {
  successMessage.value = layoutLevelFixNotice;
  clearLayoutLevelNotice();
}
const efficiencyCatalog = ref<EfficiencyCatalog>();
const efficiencyLoading = ref(false);
const efficiencyError = ref("");
const draftOperatorNames = ref<Record<string, string>>({});
const editingOperatorSlot = ref<OperatorSlotAddress>();
const slotNameInput = ref<SlotNameInputInstance | SlotNameInputInstance[]>();
const contextMenu = ref<FacilityContextMenuState>();
const contextMenuElement = ref<HTMLElement>();
const layoutText = ref("");
const simulatorEditSettings = ref(readSimulatorEditSettings());
const layoutTextHint =
  "修改数字后将自动应用；第 5 行依次为会客室、加工站、办公室、训练室，0 表示不建造，缺少前置设施时会自动补建。";
let layoutApplyTimer: ReturnType<typeof setTimeout> | undefined;
let catalogRequestVersion = 0;

const INITIAL_MOOD_OPTIONS = [0, 12, 24] as const;

const activeDocument = computed(() => getActiveDocument());
const currentDocument = computed(() => activeDocument.value?.document);
const currentSimulatorEditSettings = computed<SimulatorEditSettings>(() => {
  const documentId = activeDocumentId.value;
  return documentId
    ? (simulatorEditSettings.value[documentId] ??
        DEFAULT_SIMULATOR_EDIT_SETTINGS)
    : DEFAULT_SIMULATOR_EDIT_SETTINGS;
});

const efficiencyResult = computed<EfficiencyResult | undefined>(() => {
  const document = currentDocument.value;
  const catalog = efficiencyCatalog.value;
  if (!document || !catalog) {
    return undefined;
  }
  return calculateEfficiency(document, catalog, {
    progressionProfile: activeProfile.value,
    treatSkillsAsUnlocked: treatSkillsAsUnlocked.value,
  });
});

const calculationSteps = computed(
  () =>
    efficiencyResult.value?.plans.flatMap((plan, planIndex) =>
      plan.facilities
        .filter(
          (facility) =>
            facility.production !== undefined ||
            facility.capacity !== undefined ||
            facility.details.length > 0 ||
            facility.operatorContributions.length > 0,
        )
        .map((facility) => ({ plan, planIndex, facility })),
    ) ?? [],
);

const efficiencySupported = computed(
  () => selectedDataSource.value === "torappu",
);

const operatorOptions = computed(() =>
  operators.value.map((operator) => ({
    value: operator.name,
    label: operator.name,
  })),
);

function filterOperatorOption(
  input: string,
  option: { value?: string | number | null },
): boolean {
  const query = input.trim().toLowerCase();
  if (!query) {
    return true;
  }
  const value = typeof option.value === "string" ? option.value : "";
  return value.toLowerCase().includes(query);
}

const layoutAddOptions = computed(() =>
  ROOM_ORDER.map((type) => {
    const result = currentDocument.value
      ? canAddLayoutEntry(currentDocument.value.layout, type)
      : { ok: false, reason: "暂无排班表" };
    const plan = currentDocument.value
      ? layoutAdditionPlan(currentDocument.value.layout, type)
      : undefined;
    const extraTypes = plan?.types.filter((entryType) => entryType !== type);
    return {
      type,
      label: ROOM_LABELS[type],
      disabled: !plan,
      reason: !plan
        ? result.ok
          ? "当前设施无法添加"
          : result.reason
        : extraTypes?.length
          ? `点击添加，将自动补建：${extraTypes
              .map((entryType) => ROOM_LABELS[entryType])
              .join("、")}`
          : "点击添加",
    };
  }),
);

const layoutRows = computed<LayoutDisplayRow[]>(() => {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }

  const indexedEntries = orderedLayoutEntries(document.layout);
  return LAYOUT_DISPLAY_ROWS.map((types, rowIndex) => ({
    key: `layout-row-${rowIndex}`,
    entries: types.flatMap((type) =>
      indexedEntries
        .filter((item) => item.entry.type === type)
        .map(({ entry, index }, position) => ({ entry, index, position })),
    ),
  }));
});

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

function updateSimulatorEditSetting(
  setting: SimulatorEditSetting,
  enabled: boolean,
): void {
  const documentId = activeDocumentId.value;
  if (!documentId) {
    return;
  }
  simulatorEditSettings.value = {
    ...simulatorEditSettings.value,
    [documentId]: {
      ...currentSimulatorEditSettings.value,
      [setting]: enabled,
    },
  };
  persistSimulatorEditSettings(simulatorEditSettings.value);
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

function updatePlanDurationHours(
  planIndex: number,
  value: number | null,
): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex];
    if (plan) {
      if (value === null || !Number.isFinite(value)) {
        plan.duration = undefined;
      } else {
        const hours = Math.min(24, Math.max(1, Number(value.toFixed(2))));
        plan.duration = Math.round(hours * 60);
      }
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
      rooms[type] = Array.from({ length: count }, () =>
        createDefaultRoomAssignment(type),
      );
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
        previous[index] ?? createDefaultRoomAssignment(type),
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

function layoutTextFor(layout: LayoutEntry[]): string {
  return LAYOUT_INPUT_ROWS.map((types) => {
    if (types.length === 1) {
      return layout
        .filter((entry) => entry.type === types[0])
        .map((entry) => entry.level)
        .join("");
    }

    return types
      .map(
        (type) =>
          layout.find((entry) => entry.type === type)?.level.toString() ?? "0",
      )
      .join("");
  }).join("\n");
}

function layoutFacilityStyle(type: RoomKey): Record<string, string> {
  return {
    "--simulator-facility-accent":
      facilityColors.value[type] ?? ROOM_REPRESENTATIVE_COLORS[type],
  };
}

function layoutBuildChain(type: RoomKey): RoomKey[] {
  const requiredType = BUILD_CHAIN_REQUIRED[type];
  return requiredType ? [...layoutBuildChain(requiredType), type] : [type];
}

function layoutAdditionPlan(
  layout: LayoutEntry[],
  type: RoomKey,
): LayoutAdditionPlan | undefined {
  const candidateLayout = [...layout];
  const chain = layoutBuildChain(type);
  const typesToAdd = chain.filter(
    (entryType, index) =>
      index === chain.length - 1 ||
      !candidateLayout.some((entry) => entry.type === entryType),
  );

  for (const entryType of typesToAdd) {
    const result = canAddLayoutEntry(candidateLayout, entryType);
    if (!result.ok) {
      return undefined;
    }
    candidateLayout.push({
      type: entryType,
      level: layoutEntryLevelMax(entryType),
    });
  }

  return { types: typesToAdd };
}

function layoutWithBuildChain(requestedLayout: LayoutEntry[]): LayoutEntry[] {
  const requestedByType = new Map<RoomKey, LayoutEntry[]>();
  const includedTypes = new Set<RoomKey>();

  requestedLayout.forEach((entry) => {
    const entries = requestedByType.get(entry.type) ?? [];
    entries.push(entry);
    requestedByType.set(entry.type, entries);
    includedTypes.add(entry.type);
    layoutBuildChain(entry.type)
      .slice(0, -1)
      .forEach((requiredType) => includedTypes.add(requiredType));
  });

  return LAYOUT_BUILD_ORDER.flatMap((type) => {
    if (!includedTypes.has(type)) {
      return [];
    }
    const requestedEntries = requestedByType.get(type);
    return requestedEntries?.length
      ? requestedEntries.map((entry) => ({ ...entry }))
      : [{ type, level: layoutEntryLevelMax(type) }];
  });
}

function validateAddedLayout(layout: LayoutEntry[]): LayoutEntry[] {
  const validatedLayout: LayoutEntry[] = [];
  layout.forEach((entry) => {
    const result = canAddLayoutEntry(validatedLayout, entry.type);
    if (!result.ok) {
      throw new ScheduleError(result.reason);
    }
    validatedLayout.push(entry);
  });
  return validatedLayout;
}

function addLayoutEntry(type: RoomKey): void {
  const document = currentDocument.value;
  if (!document) {
    return;
  }
  const plan = layoutAdditionPlan(document.layout, type);
  if (!plan) {
    const result = canAddLayoutEntry(document.layout, type);
    setError(new ScheduleError(result.ok ? "设施无法添加" : result.reason));
    return;
  }

  updateCurrent(
    (candidate) => {
      const candidatePlan = layoutAdditionPlan(candidate.layout, type);
      if (!candidatePlan) {
        throw new ScheduleError("设施无法添加");
      }
      candidatePlan.types.forEach((entryType) => {
        candidate.layout.push({
          type: entryType,
          level: layoutEntryLevelMax(entryType),
        });
      });
      candidate.plans.forEach((plan) =>
        resizeRoomsForLayout(plan, candidate.layout),
      );
    },
    { markLayoutExplicit: true },
  );
}

function applyLayoutText(): void {
  clearMessages();
  try {
    const requestedLayout = parseLayoutText(layoutText.value);
    const nextLayout = validateAddedLayout(
      layoutWithBuildChain(requestedLayout),
    );
    const updated = updateCurrent(
      (document) => {
        document.layout = nextLayout.map((entry) => ({ ...entry }));
        document.plans.forEach((plan) =>
          resizeRoomsForLayout(plan, document.layout),
        );
      },
      { markLayoutExplicit: true },
    );
    if (updated) {
      layoutText.value = layoutTextFor(nextLayout);
      successMessage.value = "已按输入内容更新设施布局。";
    }
  } catch (error: unknown) {
    setError(error);
  }
}

function scheduleLayoutTextApply(text: string): void {
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
  }
  if (
    !currentDocument.value ||
    text === layoutTextFor(currentDocument.value.layout)
  ) {
    layoutApplyTimer = undefined;
    return;
  }

  layoutApplyTimer = setTimeout(() => {
    layoutApplyTimer = undefined;
    if (layoutText.value === text) {
      applyLayoutText();
    }
  }, 300);
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

  const cascadedEntries = cascadeLayoutTypes(entry.type).flatMap((type) =>
    document.layout.filter((layoutEntry) => layoutEntry.type === type),
  );
  if (cascadedEntries.length > 0) {
    const cascadedLabels = Array.from(
      new Set(
        cascadedEntries.map((layoutEntry) => ROOM_LABELS[layoutEntry.type]),
      ),
    ).join("、");
    if (
      !window.confirm(
        `删除${ROOM_LABELS[entry.type]}后，将同时删除${cascadedLabels}，确定吗？`,
      )
    ) {
      return;
    }
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
      rooms.push(createDefaultRoomAssignment(type));
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

function operatorSlotAddress(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): OperatorSlotAddress {
  return {
    planIndex,
    type,
    position,
    slotIndex,
    key: operatorSlotKey(planIndex, type, position, slotIndex),
  };
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

function isEditingOperatorSlot(slot: OperatorSlotAddress): boolean {
  return editingOperatorSlot.value?.key === slot.key;
}

function selectOperatorName(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
  value: string,
): void {
  handleOperatorDraft(planIndex, type, position, slotIndex, value);
  commitOperatorName(planIndex, type, position, slotIndex);
}

function finishOperatorNameEdit(key: string): void {
  delete draftOperatorNames.value[key];
  if (editingOperatorSlot.value?.key === key) {
    editingOperatorSlot.value = undefined;
  }
}

function beginOperatorNameEdit(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): void {
  const nextSlot = operatorSlotAddress(planIndex, type, position, slotIndex);
  if (
    editingOperatorSlot.value &&
    editingOperatorSlot.value.key !== nextSlot.key
  ) {
    const previous = editingOperatorSlot.value;
    if (
      !commitOperatorName(
        previous.planIndex,
        previous.type,
        previous.position,
        previous.slotIndex,
      )
    ) {
      return;
    }
  }
  editingOperatorSlot.value = nextSlot;
  draftOperatorNames.value[nextSlot.key] = currentDocument.value?.plans[
    planIndex
  ]
    ? operatorNameAt(
        currentDocument.value.plans[planIndex],
        type,
        position,
        slotIndex,
      )
    : "";
  contextMenu.value = undefined;
  void focusSlotNameInput();
}

async function focusSlotNameInput(): Promise<void> {
  await nextTick();
  const target = slotNameInput.value;
  const instance = Array.isArray(target) ? target[0] : target;
  const element = instance?.$el;
  const input =
    element instanceof Element ? element.querySelector("input") : null;
  if (!input) {
    return;
  }
  input.focus();
  input.select();
}

function cancelOperatorNameEdit(): void {
  const slot = editingOperatorSlot.value;
  if (!slot) {
    return;
  }
  finishOperatorNameEdit(slot.key);
}

function operatorElite(
  room: RoomAssignment | undefined,
  name: string,
  type: RoomKey,
): EliteLevel {
  const operator = operatorByName(name);
  const profile = operator
    ? efficiencyCatalog.value?.operators[operator.name]
    : undefined;
  return resolveOperatorProgression({
    operatorId: operator?.id ?? name,
    facility: type,
    operatorSkillFile: profile?.skillFile,
    maxEliteLevel: operator?.maxEliteLevel,
    manualElite: operatorState(room, name).elite,
    manualLevel: operatorState(room, name).level,
    profile: activeProfile.value,
    treatSkillsAsUnlocked: treatSkillsAsUnlocked.value,
  }).elite;
}

function operatorOwned(
  room: RoomAssignment | undefined,
  name: string,
): boolean {
  if (!activeProfile.value) {
    return true;
  }
  const operator = operatorByName(name);
  const entry = operator ? activeProfile.value.entries[operator.id] : undefined;
  return entry?.owned === true;
}

function operatorTrainingUpgraded(
  room: RoomAssignment | undefined,
  name: string,
  type: RoomKey,
): boolean {
  if (!treatSkillsAsUnlocked.value) {
    return false;
  }
  const operator = operatorByName(name);
  const profile = operator
    ? efficiencyCatalog.value?.operators[operator.name]
    : undefined;
  return resolveOperatorProgression({
    operatorId: operator?.id ?? name,
    facility: type,
    operatorSkillFile: profile?.skillFile,
    maxEliteLevel: operator?.maxEliteLevel,
    manualElite: operatorState(room, name).elite,
    manualLevel: operatorState(room, name).level,
    profile: activeProfile.value,
    treatSkillsAsUnlocked: true,
  }).upgraded;
}

function updateOperatorState(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
  key: "mood" | "elite" | "level",
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

const FACILITY_TITLE_HEAD_SPACE = 34;
const FACILITY_TITLE_TAG_TEXT = "Lv 9";
const FACILITY_TITLE_TAG_GAP = 4;
const FACILITY_TITLE_MAX_FONT_SIZE = 14;
const FACILITY_TITLE_MIN_FONT_SIZE = 11;
const FACILITY_TITLE_MAX_GAP = 8;
const FACILITY_TITLE_MIN_GAP = 4;
const FACILITY_TITLE_TAG_PRESETS: [
  FacilityTitleTagPreset,
  ...FacilityTitleTagPreset[],
] = [
  { fontSize: 12, padding: 7 },
  { fontSize: 10, padding: 5 },
  { fontSize: 9, padding: 4 },
];
const FACILITY_CARD_HORIZONTAL_OVERHEAD = 29;
const QUEUE_MIN_HEIGHT_EXTRA = 30;
const FACILITY_ICON_URL_BASE = "assets/raw/item_icon/";
const EFFICIENCY_SUMMARY_MAX_FONT_SIZE = 16;
const EFFICIENCY_SUMMARY_MIN_FONT_SIZE = 8;
const EFFICIENCY_SUMMARY_TEXT_SAFETY_RATIO = 0.9;

function slotRefCount(row: FacilityRow): number {
  return Math.max(1, slotRefs(row).length);
}

function facilityCardWidthValue(row: FacilityRow): number {
  return (
    slotRefCount(row) * avatarDisplaySizes.value.simulatorSlot +
    FACILITY_CARD_HORIZONTAL_OVERHEAD
  );
}

function facilityCardWidth(row: FacilityRow): string {
  return `${facilityCardWidthValue(row)}px`;
}

function facilityColumnStyle(row: FacilityRow): Record<string, string> {
  return { "--simulator-column-width": facilityCardWidth(row) };
}

const facilityGridStyle = computed(() => ({
  "--simulator-queue-min-height": `${
    simulatorSlotSize.value + slotNameBandHeight.value + QUEUE_MIN_HEIGHT_EXTRA
  }px`,
}));

function showsFacilityLevelTags(type: RoomKey): boolean {
  return !isFixedLevelRoom(type);
}

function estimateTextEm(text: string): number {
  let em = 0;
  for (const character of text) {
    em += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(character)
      ? 1
      : 0.56;
  }
  return Math.max(0.5, em);
}

function facilityTitleTagWidth(
  tagCount: number,
  preset: { fontSize: number; padding: number },
  tagTextEm: number,
): number {
  if (tagCount === 0) {
    return 0;
  }
  return (
    tagCount * (2 * preset.padding + tagTextEm * preset.fontSize) +
    (tagCount - 1) * FACILITY_TITLE_TAG_GAP
  );
}

function facilityTitleStyle(row: FacilityRow): Record<string, string> {
  const availableWidth = Math.max(
    24,
    facilityCardWidthValue(row) - FACILITY_TITLE_HEAD_SPACE,
  );
  const titleEm = estimateTextEm(row.label);
  const tagCount = showsFacilityLevelTags(row.type) ? row.entries.length : 0;
  const tagTextEm = estimateTextEm(FACILITY_TITLE_TAG_TEXT);

  let fontSize = FACILITY_TITLE_MIN_FONT_SIZE;
  let tagWidth = 0;
  let tagPreset = FACILITY_TITLE_TAG_PRESETS[0];

  for (const preset of FACILITY_TITLE_TAG_PRESETS) {
    const width = facilityTitleTagWidth(tagCount, preset, tagTextEm);
    const fitted = Math.min(
      FACILITY_TITLE_MAX_FONT_SIZE,
      Math.floor((availableWidth - width - FACILITY_TITLE_MIN_GAP) / titleEm),
    );
    fontSize = Math.max(FACILITY_TITLE_MIN_FONT_SIZE, fitted);
    tagWidth = width;
    tagPreset = preset;
    if (fitted >= FACILITY_TITLE_MIN_FONT_SIZE || tagCount === 0) {
      break;
    }
  }

  const gap = Math.min(
    FACILITY_TITLE_MAX_GAP,
    Math.max(
      FACILITY_TITLE_MIN_GAP,
      availableWidth - titleEm * fontSize - tagWidth,
    ),
  );
  return {
    "--simulator-facility-title-size": `${fontSize}px`,
    "--simulator-facility-title-gap": `${gap}px`,
    "--simulator-facility-tag-font-size": `${tagPreset.fontSize}px`,
    "--simulator-facility-tag-padding": `${tagPreset.padding}px`,
  };
}

function facilityIconUrl(fileName: string | undefined): string | undefined {
  return fileName
    ? `${import.meta.env.BASE_URL}${FACILITY_ICON_URL_BASE}${fileName}`
    : undefined;
}

function facilityCardIconUrl(row: FacilityRow, plan: Plan): string | undefined {
  const products = roomProducts(row, plan);
  return facilityIconUrl(
    facilityProductIconFile(
      row.type,
      products.length === 1 ? products[0] : undefined,
    ),
  );
}

function facilityIconClasses(): string[] {
  return [
    "simulator-facility-icon",
    `simulator-facility-icon--${facilityCardSettings.value.iconStyle}`,
  ];
}

function facilityIconStyle(): Record<string, string> {
  const size = Math.round(
    simulatorSlotSize.value *
      facilityCardIconScale(facilityCardSettings.value.iconStyle),
  );
  return { "--simulator-facility-icon-size": `${size}px` };
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

function roomSkipped(room: RoomAssignment | undefined): boolean {
  return room?.skip === true;
}

function commitOperatorName(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): boolean {
  const document = currentDocument.value;
  const plan = document?.plans[planIndex];
  if (!document || !plan) {
    return false;
  }

  const key = operatorSlotKey(planIndex, type, position, slotIndex);
  if (editingOperatorSlot.value?.key !== key) {
    return false;
  }
  const nextName = draftOperatorNames.value[key]?.trim() ?? "";
  const previousName = operatorNameAt(plan, type, position, slotIndex);
  if (nextName === previousName) {
    finishOperatorNameEdit(key);
    return true;
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
    finishOperatorNameEdit(key);
  }
  return updated;
}

function planDurationHoursValue(plan: Plan): number {
  const minutes = Number(plan.duration ?? 720);
  return Number((minutes / 60).toFixed(2));
}

function planDurationHours(plan: Plan): string {
  return `${planDurationHoursValue(plan).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 小时`;
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits });
}

function formatEfficiencyNumber(value: number): string {
  return value < 0 ? `-${formatNumber(Math.abs(value))}` : formatNumber(value);
}

function efficiencySummaryText(row: FacilityRow, planIndex: number): string {
  const result = planFacilityResult(row, planIndex);
  if (!result) {
    return "";
  }
  return `${formatEfficiencyNumber(result.combinationEfficiency)}% / ${formatEfficiencyNumber(result.efficiency)}%`;
}

function efficiencySummaryStyle(
  row: FacilityRow,
  planIndex: number,
): Record<string, string> {
  const text = efficiencySummaryText(row, planIndex);
  if (!text) {
    return {};
  }
  const availableWidth = slotRefCount(row) * simulatorSlotSize.value;
  const fontSize = Math.min(
    EFFICIENCY_SUMMARY_MAX_FONT_SIZE,
    Math.max(
      EFFICIENCY_SUMMARY_MIN_FONT_SIZE,
      (availableWidth / estimateTextEm(text)) *
        EFFICIENCY_SUMMARY_TEXT_SAFETY_RATIO,
    ),
  );
  return { fontSize: `${fontSize}px` };
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

function effectiveProductionRate(value: ProductionValue): number {
  return value.effectiveAmountPerHour ?? value.amountPerHour;
}

function productionMaterialsForDisplay(
  value: ProductionValue,
  effective = false,
): string[] {
  const materials = effective
    ? (value.effectiveMaterialPerHour ?? value.materialPerHour)
    : value.materialPerHour;
  return Object.entries(materials ?? {}).map(
    ([material, amount]) => `${material} ${signedNumber(amount)}/小时`,
  );
}

function formatDurationHours(value: number): string {
  return `${formatNumber(value)} 小时`;
}

function productionRateLabel(value: ProductionValue): string {
  return value.itemRate === undefined
    ? ""
    : `${formatProduction(value.itemRate)} / 小时`;
}

function facilityOverflowLabel(value: ProductionValue): string {
  if (value.overflowed === undefined) {
    return "未启用容量模拟";
  }
  return value.overflowed ? "计划内会爆仓" : "计划内不爆仓";
}

function inheritedSourceLabel(result: FacilityEfficiencyResult): string {
  if (!result.inherited || result.inheritedFromPlanIndex === undefined) {
    return "";
  }
  const source = efficiencyResult.value?.plans[result.inheritedFromPlanIndex];
  return `继承自 ${source?.name || `队列${result.inheritedFromPlanIndex + 1}`}`;
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

function progressionMenuNodes(
  operator: Operator,
  type: RoomKey,
): OperatorProgressionNode[] {
  if (type === "meeting") {
    const maxEliteLevel = operator.maxEliteLevel ?? 0;
    return Array.from({ length: maxEliteLevel + 1 }, (_, value) => ({
      key: `elite-${value}`,
      type: "elite" as const,
      value,
      label: `精英${value}`,
      facilities: [type],
    }));
  }
  return progressionNodesForFacility(
    efficiencyCatalog.value?.operators[operator.name]?.skillFile,
    type,
    operator.rarity,
  );
}

const operatorContextMenuDetails = computed<
  OperatorContextMenuDetails | undefined
>(() => {
  const menu = contextMenu.value;
  const document = currentDocument.value;
  if (!menu || !document) {
    return undefined;
  }
  const plan = document.plans[menu.planIndex];
  const room = plan ? roomAt(plan, menu.type, menu.position) : undefined;
  const name = plan
    ? operatorNameAt(plan, menu.type, menu.position, menu.slotIndex)
    : "";
  const operator = operatorByName(name);
  if (!room || !name || !operator) {
    return undefined;
  }
  const state = operatorState(room, name);
  const skillFile =
    efficiencyCatalog.value?.operators[operator.name]?.skillFile;
  return {
    menu,
    name,
    operator,
    room,
    progressionNodes: progressionMenuNodes(operator, menu.type),
    currentMood: state.mood ?? 24,
    currentProgression: resolveOperatorProgression({
      operatorId: operator.id,
      facility: menu.type,
      operatorSkillFile: skillFile,
      maxEliteLevel: operator.maxEliteLevel,
      manualElite: state.elite,
      manualLevel: state.level,
      profile: activeProfile.value,
      treatSkillsAsUnlocked: treatSkillsAsUnlocked.value,
    }),
    hasManualProgression:
      state.elite !== undefined || state.level !== undefined,
  };
});

function isCurrentProgressionNode(node: OperatorProgressionNode): boolean {
  const details = operatorContextMenuDetails.value;
  if (!details) {
    return false;
  }
  if (details.menu.type === "meeting") {
    return details.currentProgression.elite === node.value;
  }
  return node.type === "elite"
    ? details.currentProgression.elite === node.value
    : details.currentProgression.level === node.value;
}

function contextMenuStyle(): Record<string, string> {
  const menu = contextMenu.value;
  if (!menu) {
    return {};
  }
  return {
    insetInlineStart: `${menu.x}px`,
    insetBlockStart: `${menu.y}px`,
  };
}

function commitPendingOperatorNameEdit(): boolean {
  const currentEditing = editingOperatorSlot.value;
  if (!currentEditing) {
    return true;
  }
  return commitOperatorName(
    currentEditing.planIndex,
    currentEditing.type,
    currentEditing.position,
    currentEditing.slotIndex,
  );
}

function contextMenuPosition(event: MouseEvent): { x: number; y: number } {
  return {
    x: Math.min(event.clientX, Math.max(8, window.innerWidth - 240)),
    y: Math.min(event.clientY, Math.max(8, window.innerHeight - 320)),
  };
}

async function clampContextMenuPosition(): Promise<void> {
  await nextTick();
  const menu = contextMenu.value;
  const element = contextMenuElement.value;
  if (!menu || !element) {
    return;
  }
  const maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8);
  if (menu.y > maxTop) {
    contextMenu.value = { ...menu, y: maxTop };
  }
}

function openOperatorContextMenu(
  event: MouseEvent,
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): void {
  if (!commitPendingOperatorNameEdit()) {
    return;
  }
  contextMenu.value = {
    ...operatorSlotAddress(planIndex, type, position, slotIndex),
    positions: [position],
    ...contextMenuPosition(event),
  };
  void clampContextMenuPosition();
}

function openFacilityContextMenu(
  event: MouseEvent,
  planIndex: number,
  type: RoomKey,
  positions: number[],
): void {
  if (!commitPendingOperatorNameEdit()) {
    return;
  }
  contextMenu.value = {
    ...operatorSlotAddress(planIndex, type, positions[0] ?? 0, 0),
    positions,
    ...contextMenuPosition(event),
  };
  void clampContextMenuPosition();
}

function closeContextMenu(): void {
  contextMenu.value = undefined;
}

function roomContextMenuItems(
  planIndex: number,
  type: RoomKey,
  position: number,
): FacilityContextMenuItem[] {
  const plan = currentDocument.value?.plans[planIndex];
  const room = plan ? roomAt(plan, type, position) : undefined;
  const items: FacilityContextMenuItem[] = [
    {
      key: `skip-${position}`,
      label: "跳过",
      check: room?.skip === true,
      action: () => {
        updateRoomSkip(planIndex, type, position, room?.skip !== true);
        closeContextMenu();
      },
    },
  ];

  if (!roomHasProduct(type) || !currentSimulatorEditSettings.value.product) {
    return items;
  }

  items.push({ key: `product-divider-${position}`, label: "", divider: true });
  const availableProducts = productOptions(type, room?.product).filter(
    (option) => option.value !== "",
  );
  availableProducts.forEach((option) => {
    items.push({
      key: `product-${position}-${option.value}`,
      label: option.label,
      check: (room?.product ?? "") === option.value,
      disabled: option.disabled,
      action: () => {
        updateRoomProduct(planIndex, type, position, option.value);
        closeContextMenu();
      },
    });
  });

  if (!sourceVisible(room)) {
    return items;
  }

  const currentSourceMaterial = sourceValue(room);
  items.push({ key: `source-divider-${position}`, label: "", divider: true });
  SOURCE_MATERIAL_OPTIONS.forEach((option) => {
    items.push({
      key: `source-${position}-${option.value}`,
      label: option.label,
      check: currentSourceMaterial === option.value,
      action: () => {
        updateRoomSource(planIndex, type, position, option.value);
        closeContextMenu();
      },
    });
  });

  return items;
}

const contextMenuSections = computed<FacilityContextMenuSection[]>(() => {
  const menu = contextMenu.value;
  if (!menu) {
    return [];
  }
  const multipleRooms = menu.positions.length > 1;
  return menu.positions.map((position) => ({
    key: `${menu.type}-${position}`,
    title: multipleRooms
      ? `${ROOM_LABELS[menu.type]} ${position + 1}`
      : ROOM_LABELS[menu.type],
    items: roomContextMenuItems(menu.planIndex, menu.type, position),
  }));
});

const contextMenuIsFlat = computed(() => contextMenuSections.value.length <= 1);

function updateOperatorMoodQuickly(value: number): void {
  const menu = operatorContextMenuDetails.value;
  if (!menu) {
    return;
  }
  updateOperatorState(
    menu.menu.planIndex,
    menu.menu.type,
    menu.menu.position,
    menu.menu.slotIndex,
    "mood",
    value === 24 ? null : value,
  );
  closeContextMenu();
}

function updateOperatorProgression(node: OperatorProgressionNode): void {
  const menu = operatorContextMenuDetails.value;
  if (!menu) {
    return;
  }
  if (node.type === "elite") {
    updateOperatorState(
      menu.menu.planIndex,
      menu.menu.type,
      menu.menu.position,
      menu.menu.slotIndex,
      "elite",
      node.value,
    );
    updateOperatorState(
      menu.menu.planIndex,
      menu.menu.type,
      menu.menu.position,
      menu.menu.slotIndex,
      "level",
      1,
    );
  } else {
    if (menu.operator.rarity <= 2) {
      updateOperatorState(
        menu.menu.planIndex,
        menu.menu.type,
        menu.menu.position,
        menu.menu.slotIndex,
        "elite",
        0,
      );
    }
    updateOperatorState(
      menu.menu.planIndex,
      menu.menu.type,
      menu.menu.position,
      menu.menu.slotIndex,
      "level",
      node.value,
    );
  }
  closeContextMenu();
}

function resetOperatorProgression(): void {
  const menu = operatorContextMenuDetails.value;
  if (!menu) {
    return;
  }
  updatePlanRoom(
    menu.menu.planIndex,
    menu.menu.type,
    menu.menu.position,
    (room) => {
      const state = room.operatorStates?.[menu.name];
      if (!state) {
        return;
      }
      delete state.elite;
      delete state.level;
      if (Object.keys(state).length === 0) {
        delete room.operatorStates?.[menu.name];
      }
      if (
        room.operatorStates &&
        Object.keys(room.operatorStates).length === 0
      ) {
        delete room.operatorStates;
      }
    },
  );
  closeContextMenu();
}

function handleWindowClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest(".simulator-context-menu")) {
    return;
  }
  closeContextMenu();
}

function handleWindowWheel() {
  closeContextMenu();
}

function handleWindowScroll() {
  closeContextMenu();
}

function handleWindowResize() {
  closeContextMenu();
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    if (editingOperatorSlot.value) {
      event.preventDefault();
      cancelOperatorNameEdit();
    }
    closeContextMenu();
  }
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
  const nextSettings = { ...simulatorEditSettings.value };
  delete nextSettings[document.id];
  simulatorEditSettings.value = nextSettings;
  persistSimulatorEditSettings(nextSettings);
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
  editingOperatorSlot.value = undefined;
  contextMenu.value = undefined;
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
    layoutApplyTimer = undefined;
  }
});

watch(layoutText, (text) => {
  scheduleLayoutTextApply(text);
});

watch(
  () => currentDocument.value?.layout,
  (layout) => {
    layoutText.value = layout ? layoutTextFor(layout) : "";
  },
  { deep: true, immediate: true },
);

watch(
  [baseDataReady, selectedDataSource],
  () => {
    void refreshEfficiencyCatalog();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("click", handleWindowClick);
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener("wheel", handleWindowWheel, { passive: true });
  window.addEventListener("scroll", handleWindowScroll, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", handleWindowResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleWindowClick);
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener("wheel", handleWindowWheel);
  window.removeEventListener("scroll", handleWindowScroll, { capture: true });
  window.removeEventListener("resize", handleWindowResize);
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
  }
});
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
          <div aria-label="编辑选项" class="simulator-edit-settings">
            <span class="simulator-summary-label">编辑</span>
            <a-checkbox
              :checked="currentSimulatorEditSettings.layout"
              @change="
                (event: { target: { checked: boolean } }) =>
                  updateSimulatorEditSetting('layout', event.target.checked)
              "
            >
              编辑布局
            </a-checkbox>
            <a-checkbox
              :checked="currentSimulatorEditSettings.queue"
              @change="
                (event: { target: { checked: boolean } }) =>
                  updateSimulatorEditSetting('queue', event.target.checked)
              "
            >
              编辑队列
            </a-checkbox>
            <a-checkbox
              :checked="currentSimulatorEditSettings.product"
              @change="
                (event: { target: { checked: boolean } }) =>
                  updateSimulatorEditSetting('product', event.target.checked)
              "
            >
              编辑产物
            </a-checkbox>
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
          v-if="currentSimulatorEditSettings.layout"
          :bordered="false"
          class="simulator-layout-panel"
          title="设施布局"
        >
          <div class="simulator-layout-add">
            <div class="simulator-layout-add-heading">
              <span class="simulator-summary-label">添加设施</span>
              <span class="simulator-layout-add-hint"
                >点击设施卡片直接添加</span
              >
            </div>
            <a-config-provider :auto-insert-space-in-button="false">
              <div class="simulator-layout-add-grid">
                <a-button
                  v-for="option in layoutAddOptions"
                  :key="option.type"
                  :class="[
                    'simulator-layout-add-card',
                    {
                      'simulator-layout-add-card--disabled': option.disabled,
                    },
                  ]"
                  :disabled="option.disabled"
                  :style="layoutFacilityStyle(option.type)"
                  :title="option.reason"
                  @click="addLayoutEntry(option.type)"
                >
                  {{ option.label }}
                </a-button>
              </div>
            </a-config-provider>
          </div>
          <div class="simulator-layout-text-editor">
            <div class="simulator-layout-add-heading">
              <span class="simulator-summary-label">按数字批量设置</span>
              <span class="simulator-layout-add-hint"
                >六行分别表示各类设施等级</span
              >
            </div>
            <a-textarea
              v-model:value="layoutText"
              :auto-size="{ minRows: 6, maxRows: 6 }"
              class="simulator-layout-text-input"
              placeholder="5\n32\n33222\n33\n3333\n2111"
            />
            <div class="simulator-layout-text-footer">
              <span>{{ layoutTextHint }}</span>
            </div>
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
                :style="layoutFacilityStyle(item.entry.type)"
              >
                <span class="simulator-layout-card-name">
                  {{ ROOM_LABELS[item.entry.type] }}
                </span>
                <div class="simulator-layout-card-actions">
                  <span
                    v-if="isFixedLevelRoom(item.entry.type)"
                    class="simulator-layout-card-level-text"
                    >Lv{{ item.entry.level }}</span
                  >
                  <a-input-number
                    v-else
                    :max="layoutEntryLevelMax(item.entry.type)"
                    :min="roomLevelRange(item.entry.type).min"
                    :value="item.entry.level"
                    addon-after="级"
                    class="simulator-layout-card-level"
                    @update:value="
                      (value: number | null) =>
                        updateLayoutLevel(item.index, value)
                    "
                  />
                  <a-button
                    :disabled="item.entry.type === 'control'"
                    aria-label="删除设施"
                    danger
                    :title="
                      item.entry.type === 'control'
                        ? '控制中枢不可删除'
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
        </a-card>

        <a-row
          :gutter="[10, 10]"
          :style="facilityGridStyle"
          class="simulator-facility-grid"
        >
          <a-col class="simulator-queue-column" flex="0 0 220px">
            <a-card
              :bordered="false"
              class="simulator-column-card simulator-queue-card"
              title="队列信息"
            >
              <template #extra>
                <a-button
                  v-if="currentSimulatorEditSettings.queue"
                  size="small"
                  @click="addPlan"
                >
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
                    <template v-if="currentSimulatorEditSettings.queue">
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
                    </template>
                    <template v-else>
                      <span
                        class="simulator-queue-entry-title simulator-readonly-value"
                        >{{ plan.name?.trim() || "未命名队列" }}</span
                      >
                    </template>
                  </div>
                  <template v-if="currentSimulatorEditSettings.queue">
                    <a-input-number
                      :max="24"
                      :min="1"
                      :precision="2"
                      :step="0.01"
                      :value="planDurationHoursValue(plan)"
                      addon-after="小时"
                      class="simulator-queue-duration"
                      size="small"
                      @update:value="
                        (value: number | null) =>
                          updatePlanDurationHours(planIndex, value)
                      "
                    />
                  </template>
                  <template v-else>
                    <span
                      class="simulator-queue-duration simulator-readonly-value"
                      >{{ planDurationHours(plan) }}</span
                    >
                  </template>
                  <a-input
                    v-if="currentSimulatorEditSettings.queue"
                    :value="plan.description ?? ''"
                    class="simulator-queue-description"
                    placeholder="队列描述（可选）"
                    size="small"
                    @update:value="
                      (value: string) =>
                        updatePlanMeta(planIndex, 'description', value)
                    "
                  />
                  <span
                    v-else
                    class="simulator-queue-description simulator-readonly-value"
                    >{{ plan.description?.trim() || "未填写描述" }}</span
                  >
                  <div
                    v-if="currentSimulatorEditSettings.queue"
                    class="simulator-queue-info-actions"
                  >
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
            :style="facilityColumnStyle(row)"
            class="simulator-facility-column"
          >
            <a-card
              :bordered="false"
              :class="['simulator-column-card', 'simulator-facility-card']"
              :style="facilityCardStyle(row, currentDocument.plans)"
            >
              <template #title>
                <div
                  :style="facilityTitleStyle(row)"
                  class="simulator-facility-title"
                >
                  <span>{{ row.label }}</span>
                  <a-space
                    v-if="showsFacilityLevelTags(row.type)"
                    :size="4"
                    wrap
                  >
                    <a-tag
                      v-for="entry in row.entries"
                      :key="entry.index"
                      color="gold"
                      >Lv {{ entry.entry.level }}</a-tag
                    >
                  </a-space>
                </div>
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
                  <img
                    v-if="facilityCardIconUrl(row, plan)"
                    :alt="`${row.label}产物图标`"
                    :class="facilityIconClasses()"
                    :src="facilityCardIconUrl(row, plan) ?? ''"
                    :style="facilityIconStyle()"
                    aria-hidden="true"
                  />
                  <div
                    class="simulator-facility-queue-content"
                    @contextmenu.stop.prevent="
                      openFacilityContextMenu(
                        $event,
                        planIndex,
                        row.type,
                        row.entries.map((item) => item.position),
                      )
                    "
                  >
                    <div class="simulator-slot-grid" :style="slotGridStyle">
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
                              row.type,
                            )
                          "
                          :operator="slotOperator(row, plan, planIndex, slot)!"
                          :operator-owned="
                            operatorOwned(
                              slotRoom(plan, slot),
                              slotName(row, plan, planIndex, slot),
                            )
                          "
                          :operator-training-upgraded="
                            operatorTrainingUpgraded(
                              slotRoom(plan, slot),
                              slotName(row, plan, planIndex, slot),
                              row.type,
                            )
                          "
                          :show-elite-level="true"
                          :show-name="true"
                          :show-profession="true"
                          :show-rarity="true"
                          :name-editing="
                            isEditingOperatorSlot(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            )
                          "
                          :plain="true"
                          :proportional-layout="true"
                          :size="simulatorSlotSize"
                          :skipped="roomSkipped(slotRoom(plan, slot))"
                          @click.stop="
                            beginOperatorNameEdit(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @contextmenu.stop.prevent="
                            openOperatorContextMenu(
                              $event,
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                        />
                        <template v-else>
                          <div
                            :style="emptySlotFrameStyle"
                            class="simulator-empty-slot-frame"
                            @click.stop="
                              beginOperatorNameEdit(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              )
                            "
                            @contextmenu.stop.prevent="
                              openFacilityContextMenu(
                                $event,
                                planIndex,
                                row.type,
                                [slot.entry.position],
                              )
                            "
                          >
                            <template v-if="roomSkipped(slotRoom(plan, slot))">
                              <span class="operator-avatar-skipped-overlay" />
                              <span
                                :style="skippedLabelStyle"
                                class="operator-avatar-skipped-label"
                                >跳过</span
                              >
                            </template>
                          </div>
                          <span
                            :class="{
                              'simulator-empty-slot-name--editing':
                                isEditingOperatorSlot(
                                  operatorSlotAddress(
                                    planIndex,
                                    row.type,
                                    slot.entry.position,
                                    slot.slotIndex,
                                  ),
                                ),
                            }"
                            :style="slotNameBandStyle"
                            class="simulator-empty-slot-name"
                            @click.stop="
                              beginOperatorNameEdit(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              )
                            "
                            @contextmenu.stop.prevent="
                              openFacilityContextMenu(
                                $event,
                                planIndex,
                                row.type,
                                [slot.entry.position],
                              )
                            "
                          >
                            {{
                              slotName(row, plan, planIndex, slot) || "空槽位"
                            }}
                          </span>
                        </template>
                        <a-auto-complete
                          v-if="
                            isEditingOperatorSlot(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            )
                          "
                          ref="slotNameInput"
                          :filter-option="filterOperatorOption"
                          :options="operatorOptions"
                          :style="slotNameBandStyle"
                          :value="slotName(row, plan, planIndex, slot)"
                          class="simulator-slot-name-input"
                          @blur="
                            commitOperatorName(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @click.stop
                          @press-enter="
                            commitOperatorName(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @select="
                            (value: string) =>
                              selectOperatorName(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                                value,
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
                      </div>
                    </div>
                    <div
                      v-if="efficiencySupported"
                      class="simulator-efficiency-summary"
                    >
                      <div
                        class="simulator-efficiency-summary-line simulator-efficiency-summary-line--total"
                      >
                        <strong
                          v-if="planFacilityResult(row, planIndex)"
                          :style="efficiencySummaryStyle(row, planIndex)"
                          >{{ efficiencySummaryText(row, planIndex) }}</strong
                        >
                      </div>
                    </div>
                  </div>
                </a-card>
              </div>
            </a-card>
          </a-col>
        </a-row>

        <div
          v-if="contextMenu"
          ref="contextMenuElement"
          :class="[
            'simulator-context-menu',
            { 'simulator-context-menu--flat': contextMenuIsFlat },
          ]"
          :style="contextMenuStyle()"
          @click.stop
        >
          <a-menu :selectable="false">
            <template v-if="operatorContextMenuDetails">
              <a-menu-item
                v-for="mood in INITIAL_MOOD_OPTIONS"
                :key="`mood-${mood}`"
                @click="updateOperatorMoodQuickly(mood)"
              >
                <span class="simulator-context-menu-marker">
                  <CheckOutlined
                    v-if="operatorContextMenuDetails.currentMood === mood"
                  />
                </span>
                心情 {{ mood }}<span v-if="mood === 24">（默认）</span>
              </a-menu-item>
              <a-menu-divider
                v-if="operatorContextMenuDetails.progressionNodes.length"
              />
              <a-menu-item
                v-for="node in operatorContextMenuDetails.progressionNodes"
                :key="node.key"
                @click="updateOperatorProgression(node)"
              >
                <span class="simulator-context-menu-marker">
                  <CheckOutlined v-if="isCurrentProgressionNode(node)" />
                </span>
                {{ node.label }}
              </a-menu-item>
              <a-menu-item
                v-if="operatorContextMenuDetails.hasManualProgression"
                key="reset-progression"
                danger
                @click="resetOperatorProgression"
              >
                <span class="simulator-context-menu-marker" />
                恢复默认练度
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
                  <span class="simulator-context-menu-marker">
                    <CheckOutlined v-if="item.check" />
                  </span>
                  {{ item.label }}
                </a-menu-item>
              </template>
            </a-menu-item-group>
          </a-menu>
        </div>

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
            <a-alert
              class="simulator-efficiency-scope-alert"
              message="当前版本暂不模拟精 0 孑订单逐单衰减与 orderProgress；爆仓展示仅按容量速率和首件进度设置计算。"
              show-icon
              type="info"
            />
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
                    实际 {{ formatProduction(production.amountPerHour) }} / 小时
                  </span>
                  <span class="simulator-daily-output-rate">
                    基础
                    {{
                      formatProduction(
                        production.baseAmountPerHour ??
                          production.amountPerHour,
                      )
                    }}
                    / 小时
                  </span>
                  <span
                    v-if="production.effectiveAmountPerHour !== undefined"
                    class="simulator-daily-output-rate simulator-daily-output-rate--effective"
                  >
                    有效
                    {{ formatProduction(effectiveProductionRate(production)) }}
                    / 小时
                  </span>
                  <span
                    v-for="material in productionMaterialsForDisplay(
                      production,
                    )"
                    :key="material"
                    class="simulator-daily-output-material"
                    >{{ material }}</span
                  >
                  <template
                    v-if="production.effectiveAmountPerHour !== undefined"
                  >
                    <span
                      v-for="material in productionMaterialsForDisplay(
                        production,
                        true,
                      )"
                      :key="`effective-${material}`"
                      class="simulator-daily-output-material simulator-daily-output-material--effective"
                      >有效 {{ material }}</span
                    >
                  </template>
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
                  v-for="(result, resultIndex) in calculationSteps"
                  :key="`${result.planIndex}-${result.facility.facility.id}-${resultIndex}`"
                >
                  <template #header>
                    <div class="simulator-step-header">
                      <span>
                        {{ result.plan.name }} ·
                        {{ facilityResultLabel(result.facility) }}
                        <small v-if="inheritedSourceLabel(result.facility)">
                          · {{ inheritedSourceLabel(result.facility) }}
                        </small>
                      </span>
                      <strong
                        >{{ formatNumber(result.facility.efficiency) }}%</strong
                      >
                    </div>
                  </template>
                  <div class="simulator-step-content">
                    <div class="simulator-step-formula">
                      基础 {{ formatNumber(result.facility.baseEfficiency) }} +
                      心情 {{ formatNumber(result.facility.moodEfficiency) }} +
                      组合 {{ formatNumber(result.facility.skillEfficiency) }} =
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
                        formatNumber(result.facility.moodEfficiency)
                      }}</strong>
                      <span>技能/组合效率</span>
                      <strong>{{
                        signedNumber(result.facility.skillEfficiency)
                      }}</strong>
                      <span>组合效率</span>
                      <strong
                        >{{
                          formatEfficiencyNumber(
                            result.facility.combinationEfficiency,
                          )
                        }}%</strong
                      >
                    </div>
                    <div
                      v-if="result.facility.inherited"
                      class="simulator-inherited-note"
                    >
                      本队列为跳过队列，已继承
                      {{
                        inheritedSourceLabel(result.facility).replace(
                          /^继承自 /,
                          "",
                        )
                      }}
                      的干员与练度；心情按当前队列重新计算。
                    </div>
                    <div
                      v-if="
                        result.facility.capacity || result.facility.production
                      "
                      class="simulator-production-panel"
                    >
                      <span class="simulator-step-subheading">产出与容量</span>
                      <div class="simulator-production-summary">
                        <template v-if="result.facility.production">
                          <span>产物</span>
                          <strong>{{
                            result.facility.production.product
                          }}</strong>
                          <span>基础速率</span>
                          <strong>
                            {{
                              formatProduction(
                                result.facility.production.baseAmountPerHour ??
                                  result.facility.production.amountPerHour,
                              )
                            }}/小时
                          </strong>
                          <span>实际速率</span>
                          <strong>
                            {{
                              formatProduction(
                                result.facility.production.amountPerHour,
                              )
                            }}/小时
                          </strong>
                          <span>容量单位速率</span>
                          <strong>{{
                            productionRateLabel(result.facility.production)
                          }}</strong>
                          <template v-if="result.facility.production.orderRule">
                            <span>订单规则</span>
                            <strong>{{
                              result.facility.production.orderRule
                            }}</strong>
                          </template>
                        </template>
                        <template v-if="result.facility.capacity">
                          <span>{{ result.facility.capacity.label }}</span>
                          <strong>
                            {{ formatNumber(result.facility.capacity.total) }}
                            {{ result.facility.capacity.unit }}
                            <small>
                              （基础
                              {{
                                formatNumber(result.facility.capacity.base)
                              }}，技能
                              {{
                                signedNumber(result.facility.capacity.skill)
                              }}）
                            </small>
                          </strong>
                        </template>
                        <template
                          v-if="
                            result.facility.production?.breachTime !== undefined
                          "
                        >
                          <span>爆仓</span>
                          <strong>
                            {{
                              facilityOverflowLabel(result.facility.production)
                            }}
                            ·
                            {{
                              formatDurationHours(
                                result.facility.production.breachTime,
                              )
                            }}
                          </strong>
                        </template>
                      </div>
                      <div
                        v-if="result.facility.production?.orders?.length"
                        class="simulator-order-list"
                      >
                        <span class="simulator-step-subheading">订单摘要</span>
                        <div
                          v-for="order in result.facility.production.orders"
                          :key="`${order.name}-${order.time}-${order.quantity}`"
                          class="simulator-order-row"
                        >
                          <span>
                            {{ order.name }} ·
                            {{ formatNumber(order.probability * 100) }}%
                          </span>
                          <span>
                            {{ formatNumber(order.quantity) }} /
                            {{ formatNumber(order.time) }} 小时
                            <template v-if="order.material">
                              · {{ order.material }} ×
                              {{ formatNumber(order.amount ?? 0) }}
                            </template>
                          </span>
                        </div>
                      </div>
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
                    <div
                      v-if="result.facility.moodDetails.length"
                      class="simulator-detail-list"
                    >
                      <span class="simulator-step-subheading"
                        >心情修正明细</span
                      >
                      <div
                        v-for="(detail, detailIndex) in result.facility
                          .moodDetails"
                        :key="`mood-${detail.operator}-${detail.skill ?? 'skill'}-${detail.stat}-${detailIndex}`"
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
                          {{ signedNumber(detail.value) }}/小时</span
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
