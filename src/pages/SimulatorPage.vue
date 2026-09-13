<script setup lang="ts">
import {
  CheckOutlined,
  ClusterOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { useBasePointDisplaySettings } from "@/composables/useBasePointDisplaySettings";
import { useAvatarDisplaySizes } from "@/composables/useAvatarDisplaySizes";
import { useDataSource } from "@/composables/useDataSource";
import { useFacilityCardSettings } from "@/composables/useFacilityCardSettings";
import {
  isProductColorKey,
  useFacilityColors,
} from "@/composables/useFacilityColors";
import { useScheduleDocuments } from "@/composables/useScheduleDocuments";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import { useOperatorPickerSettings } from "@/composables/useOperatorPickerSettings";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import { DEFAULT_SCHEDULE_ADAPTER } from "@/adapters";
import type { EliteLevel, Operator } from "@/types/baseData";
import type {
  BasePointDetail,
  BasePointSource,
  EfficiencyCatalog,
  EfficiencyNotice,
  EfficiencyPlanResult,
  EfficiencyResult,
  FacilityEfficiencyResult,
  CluePreference,
  MoodRateDetail,
  MoodSnapshot,
  OperatorEfficiencyDetail,
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
  formatDuplicateOperatorWarnings,
  isFixedLevelRoom,
  orderedLayoutEntries,
  parseLayoutText,
  roomSlotCount,
  roomLevelRange,
  validateSchedule,
} from "@/utils/schedule";
import { calculateEfficiency, loadEfficiencyCatalog } from "@/utils/efficiency";
import { facilityId } from "@/utils/efficiency/baseRules";
import {
  getOperatorAvatarNameFontSize,
  getOperatorAvatarNameMinBandMetrics,
  getOperatorAvatarSkippedLabelFontSize,
  OPERATOR_AVATAR_SOURCE_WIDTH,
} from "@/utils/operatorAvatarLayout";
import {
  nodesForOperator,
  progressionNodesForFacility,
  resolveOperatorProgression,
} from "@/utils/operatorProgression";
import { sortProfessionValues } from "@/utils/operatorOrdering";

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

interface SimulatorCalculationStep {
  plan: EfficiencyPlanResult;
  planIndex: number;
  facility?: FacilityEfficiencyResult;
  moods: MoodSnapshot[];
}

interface ExtraRoom {
  planIndex: number;
  planName: string;
  type: RoomKey;
  index: number;
  room: RoomAssignment;
}

interface OperatorSlotAddress {
  planIndex: number;
  type: RoomKey;
  position: number;
  slotIndex: number;
  key: string;
}

interface FacilityTitleTagPreset {
  fontSize: number;
  padding: number;
}

interface FacilityContextMenuState extends OperatorSlotAddress {
  scope: "queue" | "facility";
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

interface OperatorPickerCandidate {
  index: number;
  operator: Operator;
}

interface OperatorPickerState extends OperatorSlotAddress {
  side: "left" | "right";
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

interface UpdateCurrentOptions {
  markLayoutExplicit?: boolean;
  recordHistory?: boolean;
}

interface OperatorRoomAddress {
  type: RoomKey;
  position: number;
  slotCount: number;
}

interface OperatorClipboardEntry {
  name: string;
  state?: OperatorState;
}

interface OperatorClipboard {
  mode: "copy" | "cut";
  entries: OperatorClipboardEntry[];
  sourceAddresses: OperatorSlotAddress[];
}

interface OperatorSlotSnapshot {
  name: string;
  state?: OperatorState;
}

interface OperatorPointerInteraction {
  mode: "press" | "box" | "move";
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startAddress?: OperatorSlotAddress;
  sourceAddresses: OperatorSlotAddress[];
  additive: boolean;
}

interface PendingOperatorPointerMove {
  pointerId: number;
  clientX: number;
  clientY: number;
}

interface ScheduleHistoryEntry {
  before: ScheduleDocument;
  after: ScheduleDocument;
  beforeInferredLayout: boolean;
  afterInferredLayout: boolean;
}

interface ScheduleHistory {
  undo: ScheduleHistoryEntry[];
  redo: ScheduleHistoryEntry[];
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
const { isBasePointVisible } = useBasePointDisplaySettings();
const { avatarDisplaySizes } = useAvatarDisplaySizes();
const { facilityCardSettings, facilityCardIconScale } =
  useFacilityCardSettings();
const { selectedDataSource } = useDataSource();
const { facilityColors, productColors } = useFacilityColors();
const {
  activeProfile,
  dormitoryDefaultIncludesMoodRecovery,
  treatSkillsAsUnlocked,
} = useOperatorProgression();
const { operatorPickerColumns } = useOperatorPickerSettings();

const simulatorSlotSize = computed(
  () => avatarDisplaySizes.value.simulatorSlot,
);

const slotGridStyle = computed(() => ({
  "--simulator-slot-size": `${simulatorSlotSize.value}px`,
}));

const operatorPickerGridStyle = computed(() => ({
  "--simulator-operator-picker-columns": `${operatorPickerColumns.value}`,
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
const warningMessage = ref("");
const importedScheduleNotice = ref<EfficiencyNotice>();
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
const slotNameInput = ref<HTMLInputElement | HTMLInputElement[]>();
const contextMenu = ref<FacilityContextMenuState>();
const contextMenuElement = ref<HTMLElement>();
const operatorPicker = ref<OperatorPickerState>();
const operatorPickerElement = ref<HTMLElement>();
const operatorDragPreviewElement = ref<HTMLElement>();
const operatorPickerStyle = ref<Record<string, string>>({});
const facilityOperatorOverrides = ref<Partial<Record<RoomKey, string[]>>>({});
const warnedFacilityOperatorOverrideIds = new Set<string>();
const layoutText = ref("");
const simulatorEditSettings = ref(readSimulatorEditSettings());
const showScheduleSidebar = ref(true);
const selectedOperatorSlots = ref<Set<string>>(new Set());
const operatorSelectionAnchor = ref<OperatorSlotAddress>();
const hoveredOperatorSlot = ref<OperatorSlotAddress>();
const operatorSelectAllStage = ref<0 | 1 | 2>(0);
const operatorPointerInteraction = ref<OperatorPointerInteraction>();
let operatorDragTarget: OperatorSlotAddress | undefined;
let operatorDragHoveredSlotKey: string | undefined;
const suppressNextOperatorClick = ref(false);
const operatorClipboard = ref<OperatorClipboard>();
const operatorPasteHighlightKeys = ref<Set<string>>(new Set());
const scheduleHistory = new Map<string, ScheduleHistory>();
const layoutTextHint =
  "修改数字后自动应用；第 1 行为空格分隔的贸易站、制造站，第 2 行前 4 位依次为会客室、加工站、办公室、训练室，宿舍与其用空格分隔，0 表示不建造";
let layoutApplyTimer: ReturnType<typeof setTimeout> | undefined;
let operatorPasteHighlightTimer: ReturnType<typeof setTimeout> | undefined;
let catalogRequestVersion = 0;

const MAX_SCHEDULE_HISTORY = 100;

const INITIAL_MOOD_OPTIONS = [0, 12, 24] as const;
let pendingOperatorPointerMove: PendingOperatorPointerMove | undefined;
let operatorPointerMoveFrame: number | undefined;

const operatorSelectionMarqueeStyle = computed<Record<string, string>>(() => {
  const interaction = operatorPointerInteraction.value;
  if (!interaction || interaction.mode !== "box") {
    return {} as Record<string, string>;
  }
  const left = Math.min(interaction.startX, interaction.currentX);
  const top = Math.min(interaction.startY, interaction.currentY);
  return {
    insetInlineStart: `${left - 1}px`,
    insetBlockStart: `${top - 1}px`,
    width: `${Math.abs(interaction.currentX - interaction.startX) + 2}px`,
    height: `${Math.abs(interaction.currentY - interaction.startY) + 2}px`,
  };
});

function operatorDragPreviewData():
  | {
      count: number;
      name: string;
      operator: Operator;
      room: RoomAssignment | undefined;
      type: RoomKey;
      planIndex: number;
      position: number;
      slotIndex: number;
    }
  | undefined {
  const interaction = operatorPointerInteraction.value;
  const document = currentDocument.value;
  if (!interaction || interaction.mode !== "move" || !document) {
    return undefined;
  }
  const entries = interaction.sourceAddresses.flatMap((address) => {
    const plan = document.plans[address.planIndex];
    const name = plan
      ? operatorNameAt(plan, address.type, address.position, address.slotIndex)
      : "";
    const operator = operatorByName(name);
    if (!plan || !name || !operator) {
      return [];
    }
    return [
      {
        count: 0,
        name,
        operator,
        room: roomAt(plan, address.type, address.position),
        type: address.type,
        planIndex: address.planIndex,
        position: address.position,
        slotIndex: address.slotIndex,
      },
    ];
  });
  const first = entries[0];
  return first ? { ...first, count: entries.length } : undefined;
}

const operatorDragPreview = computed(operatorDragPreviewData);

const activeDocument = computed(() => getActiveDocument());
const currentDocument = computed(() => activeDocument.value?.document);
const operatorAddressMap = computed(
  () =>
    new Map(
      orderedOperatorSlotAddresses().map((address) => [address.key, address]),
    ),
);
const operatorClipboardSourceKeys = computed(() => {
  const clipboard = operatorClipboard.value;
  if (!clipboard || clipboard.sourceAddresses.length === 0) {
    return new Set<string>();
  }
  if (
    clipboard.sourceAddresses.some(
      (address) => !operatorAddressMap.value.has(address.key),
    )
  ) {
    return new Set<string>();
  }
  return new Set(clipboard.sourceAddresses.map((address) => address.key));
});
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
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  });
});

const efficiencyNotices = computed<EfficiencyNotice[]>(() => {
  const notices: EfficiencyNotice[] = [];
  if (!efficiencySupported.value) {
    notices.push({
      code: "unsupported-data-source",
      level: "info",
      message: "效率计算暂只支持 Torappu 数据源",
      details: [],
    });
    return notices;
  }
  if (efficiencyError.value) {
    notices.push({
      code: "efficiency-data-error",
      level: "error",
      message: "效率数据读取失败",
      details: [efficiencyError.value],
    });
    return notices;
  }
  const result = efficiencyResult.value;
  if (!result) {
    return notices;
  }
  notices.push({
    code: "unsupported-order-state",
    level: "info",
    message:
      "当前版本暂不模拟精 0 孑订单逐单衰减与 orderProgress；爆仓展示仅按容量速率和首件进度设置计算。",
    details: [],
  });
  if (result.warnings.length > 0) {
    notices.push({
      code: "missing-skill-data",
      level: "error",
      message: "找不到干员技能数据",
      details: result.warnings,
    });
  }
  const moodDetails = result.plans.flatMap((plan, planIndex) =>
    plan.moodWarnings.map(
      (warning) =>
        `${plan.name || `队列${planIndex + 1}`} · ${ROOM_LABELS[warning.facility]} ${warning.facilityIndex + 1} · ${warning.operator}：上一队列结束心情 ${formatNumber(warning.previousEnd)}，当前手动设置为 ${formatNumber(warning.configuredStart)}`,
    ),
  );
  if (moodDetails.length > 0) {
    notices.push({
      code: "mood-inheritance",
      level: "warning",
      message: "发现心情继承异常",
      details: moodDetails,
    });
  }
  const overflowDetails = result.plans.flatMap((plan, planIndex) =>
    plan.facilities.flatMap((facility) => {
      const production = facility.production;
      if (!production?.overflowed || production.breachTime === undefined) {
        return [];
      }
      const operators = operatorsForFacilityResult(plan, facility);
      const timing =
        production.breachTime <= 0
          ? "将立即爆仓"
          : `将在工作 ${formatDurationHours(production.breachTime)}后爆仓`;
      return [
        `${plan.name || `队列${planIndex + 1}`} · ${facilityResultLabel(facility)} · ${operators.join("、") || "无干员"}：${timing}`,
      ];
    }),
  );
  if (overflowDetails.length > 0) {
    notices.push({
      code: "overflow-risk",
      level: "warning",
      message: "发现爆仓风险",
      details: overflowDetails,
    });
  }
  return notices;
});

const simulatorNotices = computed<EfficiencyNotice[]>(() => {
  const notices = [...efficiencyNotices.value];
  if (importedScheduleNotice.value) {
    notices.push(importedScheduleNotice.value);
  }
  return notices;
});

const efficiencySettingsModalOpen = ref(false);
const currentEfficiencySettings = computed(() => {
  const settings = currentDocument.value?.settings;
  const firstItemProgress = settings?.firstItemProgress;
  return {
    clueExchanging: settings?.clueExchanging !== false,
    dormFullTreat: settings?.dormFullTreat !== false,
    simulateOverflow: settings?.overflowMode === "zero",
    firstItemProgress:
      typeof firstItemProgress === "number"
        ? Math.max(0, Math.min(100, firstItemProgress * 100))
        : undefined,
  };
});

const calculationSteps = computed<SimulatorCalculationStep[]>(() => {
  const plans = efficiencyResult.value?.plans ?? [];
  return plans.flatMap((plan, planIndex) => {
    const facilitySteps = plan.facilities
      .filter(
        (facility) =>
          facility.production !== undefined ||
          facility.capacity !== undefined ||
          facility.details.length > 0 ||
          facility.operatorContributions.length > 0,
      )
      .map((facility) => ({
        plan,
        planIndex,
        facility,
        moods: moodSnapshotsForFacility(plan, facility),
      }));
    const controlMoods = plan.moods.filter(
      (mood) => mood.facility === "control" && mood.working,
    );
    return controlMoods.length > 0
      ? [{ plan, planIndex, moods: controlMoods }, ...facilitySteps]
      : facilitySteps;
  });
});

const plansWithBasePoints = computed(() =>
  (efficiencyResult.value?.plans ?? []).flatMap((plan, planIndex) =>
    plan.basePointDetails.some((point) => isBasePointVisible(point.term))
      ? [{ plan, planIndex }]
      : [],
  ),
);

function displayedBasePointDetails(
  plan: EfficiencyPlanResult,
): BasePointDetail[] {
  return plan.basePointDetails.filter((point) =>
    isBasePointVisible(point.term),
  );
}

const efficiencySupported = computed(
  () => selectedDataSource.value === "torappu",
);

const operatorPickerRoom = computed(() => {
  const picker = operatorPicker.value;
  const document = currentDocument.value;
  const plan = document?.plans[picker?.planIndex ?? -1];
  return picker && plan
    ? roomAt(plan, picker.type, picker.position)
    : undefined;
});

const selectedOperatorPickerProfession = ref("");
const operatorPickerShowAll = ref(false);

const operatorPickerProfessionOptions = computed(() =>
  sortProfessionValues(
    operators.value.map((operator) => operator.profession).filter(Boolean),
  ),
);

const operatorPickerQuery = computed(() => {
  const picker = operatorPicker.value;
  const document = currentDocument.value;
  const plan = document?.plans[picker?.planIndex ?? -1];
  if (!picker || !plan) {
    return "";
  }
  if (operatorPickerShowAll.value) {
    return "";
  }
  return operatorDraftValue(
    plan,
    picker.planIndex,
    picker.type,
    picker.position,
    picker.slotIndex,
  )
    .trim()
    .toLocaleLowerCase();
});

const operatorPickerCandidates = computed<OperatorPickerCandidate[]>(() => {
  const picker = operatorPicker.value;
  if (!picker) {
    return [];
  }
  const overrideIds = new Set(
    facilityOperatorOverrides.value[picker.type] ?? [],
  );
  const query = operatorPickerQuery.value;
  const profession = selectedOperatorPickerProfession.value;
  return operators.value
    .map((operator, index) => ({ operator, index }))
    .filter(
      ({ operator }) =>
        (operatorHasFacilitySkill(operator, picker.type) ||
          overrideIds.has(operator.id)) &&
        (!profession || operator.profession === profession) &&
        (!query || operator.name.toLocaleLowerCase().includes(query)),
    )
    .sort(compareOperatorPickerCandidates);
});

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

function extraRoomsForDocument(document: ScheduleDocument): ExtraRoom[] {
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
}

function extraRoomNoticeDetail(item: ExtraRoom): string {
  const operators = item.room.operators?.filter((name): name is string =>
    Boolean(name),
  );
  const operatorDetail = operators?.length ? `：${operators.join("、")}` : "";
  return `${item.planName} · ${ROOM_LABELS[item.type]} ${item.index + 1}${operatorDetail}`;
}

function operatorsForFacilityResult(
  plan: EfficiencyPlanResult,
  result: FacilityEfficiencyResult,
): string[] {
  if (result.facility.type === "power") {
    return plan.moods
      .filter((mood) => mood.facility === "power")
      .map((mood) => mood.operator);
  }
  return plan.moods
    .filter((mood) => mood.facilityId === result.facility.id)
    .map((mood) => mood.operator);
}

function clearImportedScheduleNotice(): void {
  importedScheduleNotice.value = undefined;
}

function closeSimulatorNotice(notice: EfficiencyNotice): void {
  if (notice.code === "import-extra-rooms") {
    clearImportedScheduleNotice();
  }
}

function selectDocument(documentId: string): void {
  if (documentId !== activeDocumentId.value) {
    clearImportedScheduleNotice();
  }
  setActiveDocument(documentId);
}

function clearMessages(): void {
  errorMessage.value = "";
  successMessage.value = "";
  warningMessage.value = "";
}

function setError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : "操作失败";
  successMessage.value = "";
  warningMessage.value = "";
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

function toggleScheduleSidebar() {
  showScheduleSidebar.value = !showScheduleSidebar.value;
}

function updateCurrent(
  mutator: (document: ScheduleDocument) => void,
  options: UpdateCurrentOptions = {},
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
  if (JSON.stringify(document) === JSON.stringify(candidate)) {
    return true;
  }
  if (options.recordHistory !== false) {
    const history = scheduleHistoryFor(stored.id);
    history.undo.push({
      before: cloneSchedule(document),
      after: cloneSchedule(candidate),
      beforeInferredLayout: stored.inferredLayout,
      afterInferredLayout: options.markLayoutExplicit
        ? false
        : stored.inferredLayout,
    });
    if (history.undo.length > MAX_SCHEDULE_HISTORY) {
      history.undo.shift();
    }
    history.redo = [];
  }
  updateDocument(stored.id, (target) => {
    target.document = candidate;
    if (options.markLayoutExplicit) {
      target.inferredLayout = false;
    }
  });
  operatorClipboardIsUsable();
  return true;
}

function scheduleHistoryFor(documentId: string): ScheduleHistory {
  const existing = scheduleHistory.get(documentId);
  if (existing) {
    return existing;
  }
  const created: ScheduleHistory = { undo: [], redo: [] };
  scheduleHistory.set(documentId, created);
  return created;
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
        const hours = Math.min(24, Math.max(1, value));
        const totalMinutes = hours * 60;
        const roundedMinutes = Math.round(totalMinutes);
        if (Math.abs(totalMinutes - roundedMinutes) > 1e-9) {
          message.warning(
            `输入的 ${hours} 小时无法精确换算为整分钟，将按 ${roundedMinutes} 分钟保存`,
          );
        }
        plan.duration = roundedMinutes;
      }
    }
  });
}

function updateEfficiencyBooleanSetting(
  key: "clueExchanging" | "dormFullTreat",
  value: boolean,
): void {
  updateCurrent((document) => {
    document.settings = { ...(document.settings ?? {}), [key]: value };
  });
}

function updateEfficiencyOverflowSetting(value: boolean): void {
  updateCurrent((document) => {
    document.settings = {
      ...(document.settings ?? {}),
      overflowMode: value ? "zero" : "continue",
    };
  });
}

function updateEfficiencyFirstItemProgress(value: number | null): void {
  updateCurrent((document) => {
    const settings = { ...(document.settings ?? {}) };
    if (value === null || !Number.isFinite(value)) {
      delete settings.firstItemProgress;
    } else {
      settings.firstItemProgress = Math.max(0, Math.min(1, value / 100));
    }
    document.settings = settings;
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
  function levelsFor(type: RoomKey): string {
    const levels = layout
      .filter((entry) => entry.type === type)
      .map((entry) => entry.level)
      .join("");
    return levels || "0";
  }

  const coreTypes = LAYOUT_INPUT_ROWS[0] ?? [];
  const functionalTypes = LAYOUT_INPUT_ROWS[1]?.slice(0, 4) ?? [];
  const dormitoryType = LAYOUT_INPUT_ROWS[1]?.[4];
  return [
    coreTypes.map((type) => levelsFor(type)).join(" "),
    `${functionalTypes.map((type) => levelsFor(type)).join("")} ${dormitoryType ? levelsFor(dormitoryType) : "0"}`,
  ].join("\n");
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
  options: UpdateCurrentOptions = {},
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
  }, options);
}

function updateAllPlanRooms(
  type: RoomKey,
  position: number,
  update: (room: RoomAssignment) => void,
) {
  updateCurrent((document) => {
    const expected = document.layout.filter(
      (entry) => entry.type === type,
    ).length;
    document.plans.forEach((plan) => {
      const rooms = Array.isArray(plan.rooms[type])
        ? [...(plan.rooms[type] as RoomAssignment[])]
        : [];
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

function trimOperatorSlots(names: string[]): string[] {
  let end = names.length;
  while (end > 0 && !names[end - 1]) {
    end -= 1;
  }
  return names.slice(0, end);
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
  operatorPickerShowAll.value = false;
}

function isEditingOperatorSlot(slot: OperatorSlotAddress): boolean {
  return editingOperatorSlot.value?.key === slot.key;
}

function isOperatorNameInputVisible(slot: OperatorSlotAddress): boolean {
  return (
    isEditingOperatorSlot(slot) ||
    (!contextMenu.value &&
      selectedOperatorSlots.value.size === 1 &&
      selectedOperatorSlots.value.has(slot.key))
  );
}

function ensureOperatorNameEdit(slot: OperatorSlotAddress): boolean {
  if (editingOperatorSlot.value?.key === slot.key) {
    return true;
  }
  if (editingOperatorSlot.value && !commitPendingOperatorNameEdit()) {
    return false;
  }
  editingOperatorSlot.value = slot;
  contextMenu.value = undefined;
  closeOperatorPicker();
  return true;
}

function handleOperatorNameInput(
  event: Event,
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): void {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    const slot = operatorSlotAddress(planIndex, type, position, slotIndex);
    if (!ensureOperatorNameEdit(slot)) {
      return;
    }
    handleOperatorDraft(planIndex, type, position, slotIndex, input.value);
  }
}

function updateOperatorPickerSelection(input: HTMLInputElement): void {
  const picker = operatorPicker.value;
  if (!picker || picker.key !== editingOperatorSlot.value?.key) {
    operatorPickerShowAll.value = false;
    return;
  }
  operatorPickerShowAll.value =
    input.value.length > 0 &&
    input.selectionStart === 0 &&
    input.selectionEnd === input.value.length;
}

function handleOperatorNameSelection(event: Event): void {
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    updateOperatorPickerSelection(input);
  }
}

function closeOperatorPicker(): void {
  operatorPicker.value = undefined;
  operatorPickerStyle.value = {};
  operatorPickerShowAll.value = false;
  selectedOperatorPickerProfession.value = "";
}

function operatorPickerSlotElement(key: string): HTMLElement | undefined {
  return [
    ...window.document.querySelectorAll<HTMLElement>(
      ".simulator-slot[data-key]",
    ),
  ].find((element) => element.dataset.key === key);
}

async function updateOperatorPickerPosition(): Promise<void> {
  const picker = operatorPicker.value;
  const element = operatorPickerElement.value;
  if (!picker || !element) {
    return;
  }
  await nextTick();
  const currentPicker = operatorPicker.value;
  const currentElement = operatorPickerElement.value;
  if (!currentPicker || currentPicker.key !== picker.key || !currentElement) {
    return;
  }
  const slot = operatorPickerSlotElement(currentPicker.key);
  if (!slot) {
    return;
  }

  const slotRect = slot.getBoundingClientRect();
  const panelWidth = currentElement.offsetWidth;
  const panelHeight = currentElement.offsetHeight;
  const padding = 8;
  const maxTop = Math.max(padding, window.innerHeight - panelHeight - padding);
  const rightLeft = slotRect.right + padding;
  const leftLeft = slotRect.left - panelWidth - padding;
  const rightSpace = window.innerWidth - slotRect.right - padding;
  const leftSpace = slotRect.left - padding;
  const rightFits = rightSpace >= panelWidth;
  const leftFits = leftSpace >= panelWidth;
  const side: OperatorPickerState["side"] = rightFits
    ? "right"
    : leftFits
      ? "left"
      : rightSpace >= leftSpace
        ? "right"
        : "left";
  const maxLeft = Math.max(padding, window.innerWidth - panelWidth - padding);
  const left = Math.min(
    Math.max(padding, side === "right" ? rightLeft : leftLeft),
    maxLeft,
  );
  const top = Math.min(Math.max(padding, slotRect.top), maxTop);

  operatorPicker.value = { ...currentPicker, side };
  operatorPickerStyle.value = {
    insetInlineStart: `${left}px`,
    insetBlockStart: `${top}px`,
  };
}

function openOperatorPicker(slot: OperatorSlotAddress): void {
  selectedOperatorPickerProfession.value = "";
  operatorPickerShowAll.value = false;
  operatorPicker.value = { ...slot, side: "right" };
  operatorPickerStyle.value = {};
  void nextTick(updateOperatorPickerPosition);
}

function finishOperatorNameEdit(key: string): void {
  delete draftOperatorNames.value[key];
  if (editingOperatorSlot.value?.key === key) {
    editingOperatorSlot.value = undefined;
  }
  if (operatorPicker.value?.key === key) {
    closeOperatorPicker();
  }
}

function beginOperatorNameEdit(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
  initialValue?: string,
  openPicker = false,
): boolean {
  const nextSlot = operatorSlotAddress(planIndex, type, position, slotIndex);
  if (editingOperatorSlot.value?.key === nextSlot.key) {
    contextMenu.value = undefined;
    if (openPicker) {
      openOperatorPicker(nextSlot);
    }
    void focusSlotNameInput();
    return true;
  }
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
      return false;
    }
  }
  editingOperatorSlot.value = nextSlot;
  draftOperatorNames.value[nextSlot.key] =
    initialValue ??
    (currentDocument.value?.plans[planIndex]
      ? operatorNameAt(
          currentDocument.value.plans[planIndex],
          type,
          position,
          slotIndex,
        )
      : "");
  contextMenu.value = undefined;
  if (openPicker) {
    openOperatorPicker(nextSlot);
  } else {
    closeOperatorPicker();
  }
  void focusSlotNameInput(initialValue === undefined);
  return true;
}

async function focusSlotNameInput(selectText = true): Promise<void> {
  await nextTick();
  const target = slotNameInput.value;
  const instance = Array.isArray(target) ? target[0] : target;
  if (!(instance instanceof HTMLInputElement)) {
    return;
  }
  instance.focus();
  if (selectText) {
    instance.select();
    updateOperatorPickerSelection(instance);
  } else {
    const cursor = instance.value.length;
    instance.setSelectionRange(cursor, cursor);
    operatorPickerShowAll.value = false;
  }
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
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
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

function operatorMissing(
  room: RoomAssignment | undefined,
  name: string,
): boolean {
  return !operatorOwned(room, name);
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
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  }).upgraded;
}

function updateOperatorState(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
  key: "mood" | "elite" | "level",
  value: number | null,
  recordHistory = true,
): void {
  const plan = currentDocument.value?.plans[planIndex];
  const name = plan ? operatorNameAt(plan, type, position, slotIndex) : "";
  if (!name) {
    return;
  }

  updatePlanRoom(
    planIndex,
    type,
    position,
    (room) => {
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
    },
    { recordHistory },
  );
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

function slotCommittedName(
  row: FacilityRow,
  plan: Plan,
  slot: FacilitySlotRef,
): string {
  return operatorNameAt(plan, row.type, slot.entry.position, slot.slotIndex);
}

function slotOperator(
  row: FacilityRow,
  plan: Plan,
  planIndex: number,
  slot: FacilitySlotRef,
): Operator | undefined {
  return operatorByName(slotCommittedName(row, plan, slot));
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
    resetOperatorSelectAllCycle();
    finishOperatorNameEdit(key);
    return true;
  }

  const updated = updateCurrent(
    (candidate) => {
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
      setRoomOperators(room, names);
      rooms[position] = room;
      candidatePlan.rooms[type] = rooms;
    },
    { recordHistory: true },
  );
  if (updated) {
    resetOperatorSelectAllCycle();
    finishOperatorNameEdit(key);
  }
  return updated;
}

function selectOperatorPickerCandidate(candidate: Operator): void {
  const picker = operatorPicker.value;
  if (!picker || editingOperatorSlot.value?.key !== picker.key) {
    closeOperatorPicker();
    return;
  }
  draftOperatorNames.value[picker.key] = candidate.name;
  commitOperatorName(
    picker.planIndex,
    picker.type,
    picker.position,
    picker.slotIndex,
  );
}

function showOperatorMessage(message: string): void {
  errorMessage.value = "";
  successMessage.value = message;
}

function cloneOperatorState(state: OperatorState): OperatorState {
  return JSON.parse(JSON.stringify(state)) as OperatorState;
}

function operatorRoomAtDocument(
  document: ScheduleDocument,
  address: OperatorSlotAddress,
  ensure: boolean,
): RoomAssignment | undefined {
  const plan = document.plans[address.planIndex];
  if (!plan) {
    return undefined;
  }
  const currentRooms = plan.rooms[address.type];
  const rooms = Array.isArray(currentRooms)
    ? [...(currentRooms as RoomAssignment[])]
    : [];
  if (!ensure && !Array.isArray(currentRooms)) {
    return undefined;
  }
  if (ensure) {
    const expected = document.layout.filter(
      (entry) => entry.type === address.type,
    ).length;
    while (rooms.length < expected) {
      rooms.push(createDefaultRoomAssignment(address.type));
    }
    plan.rooms[address.type] = rooms;
  }
  return rooms[address.position];
}

function operatorRoomCapacity(
  document: ScheduleDocument,
  type: RoomKey,
  position: number,
): number {
  const entry = document.layout.filter((item) => item.type === type)[position];
  return entry ? roomSlotCount(type, entry.level) : 0;
}

function operatorRoomAddresses(): OperatorRoomAddress[] {
  return facilityRows.value.flatMap((row) =>
    row.entries.map((entry) => ({
      type: row.type,
      position: entry.position,
      slotCount: roomSlotCount(row.type, entry.entry.level),
    })),
  );
}

function operatorFacilityRow(
  type: RoomKey,
  position: number,
): FacilityRow | undefined {
  return facilityRows.value.find(
    (row) =>
      row.type === type &&
      (row.type === "power" ||
        row.entries.some((entry) => entry.position === position)),
  );
}

function operatorFacilityKey(type: RoomKey, position: number): string {
  return operatorFacilityRow(type, position)?.key ?? `${type}-${position}`;
}

function operatorFacilityKeyForAddress(address: OperatorSlotAddress): string {
  return operatorFacilityKey(address.type, address.position);
}

function operatorFacilitySlotIndex(
  address: OperatorSlotAddress,
): number | undefined {
  const row = operatorFacilityRow(address.type, address.position);
  if (!row) {
    return undefined;
  }
  let offset = 0;
  for (const entry of row.entries) {
    const slotCount = roomSlotCount(row.type, entry.entry.level);
    if (entry.position === address.position) {
      return offset + address.slotIndex;
    }
    offset += slotCount;
  }
  return undefined;
}

function operatorAddressAtFacilitySlot(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): OperatorSlotAddress | undefined {
  const row = operatorFacilityRow(type, position);
  const document = currentDocument.value;
  if (!row || !document?.plans[planIndex] || slotIndex < 0) {
    return undefined;
  }
  let offset = 0;
  for (const entry of row.entries) {
    const slotCount = roomSlotCount(row.type, entry.entry.level);
    if (slotIndex < offset + slotCount) {
      return operatorSlotAddress(
        planIndex,
        row.type,
        entry.position,
        slotIndex - offset,
      );
    }
    offset += slotCount;
  }
  return undefined;
}

function operatorSlotAddressesForPlan(
  planIndex: number,
): OperatorSlotAddress[] {
  return operatorRoomAddresses().flatMap((room) =>
    Array.from({ length: room.slotCount }, (_, slotIndex) =>
      operatorSlotAddress(planIndex, room.type, room.position, slotIndex),
    ),
  );
}

function orderedOperatorSlotAddresses(): OperatorSlotAddress[] {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }
  return document.plans.flatMap((_, planIndex) =>
    operatorSlotAddressesForPlan(planIndex),
  );
}

function operatorNameAtAddress(
  document: ScheduleDocument,
  address: OperatorSlotAddress,
): string {
  const plan = document.plans[address.planIndex];
  return plan
    ? operatorNameAt(plan, address.type, address.position, address.slotIndex)
    : "";
}

function selectedOperatorSlotAddresses(): OperatorSlotAddress[] {
  const selected = selectedOperatorSlots.value;
  return orderedOperatorSlotAddresses().filter((address) =>
    selected.has(address.key),
  );
}

function isOperatorSlotSelected(key: string): boolean {
  return selectedOperatorSlots.value.has(key);
}

function isOperatorSlotHovered(key: string): boolean {
  return hoveredOperatorSlot.value?.key === key;
}

function resetOperatorSelectAllCycle(): void {
  operatorSelectAllStage.value = 0;
}

function operatorAddressByKey(key: string): OperatorSlotAddress | undefined {
  return operatorAddressMap.value.get(key);
}

function setOperatorSlotDataFlag(
  key: string,
  attribute: "data-drag-target" | "data-hovered",
  enabled: boolean,
): void {
  const slot = window.document.querySelector<HTMLElement>(
    `.simulator-slot[data-key="${key}"]`,
  );
  if (enabled) {
    slot?.setAttribute(attribute, "");
  } else {
    slot?.removeAttribute(attribute);
  }
}

function focusSelectedOperatorNameInput(): void {
  if (selectedOperatorSlots.value.size !== 1 || contextMenu.value) {
    return;
  }
  void focusSlotNameInput();
}

function setOperatorDragTarget(
  nextTarget: OperatorSlotAddress | undefined,
): void {
  if (operatorDragTarget?.key === nextTarget?.key) {
    return;
  }
  if (operatorDragTarget) {
    setOperatorSlotDataFlag(operatorDragTarget.key, "data-drag-target", false);
  }
  operatorDragTarget = nextTarget;
  if (nextTarget) {
    setOperatorSlotDataFlag(nextTarget.key, "data-drag-target", true);
  }
}

function setOperatorDragHoveredSlot(
  nextSlot: OperatorSlotAddress | undefined,
): void {
  if (operatorDragHoveredSlotKey === nextSlot?.key) {
    return;
  }
  if (operatorDragHoveredSlotKey) {
    setOperatorSlotDataFlag(operatorDragHoveredSlotKey, "data-hovered", false);
  }
  operatorDragHoveredSlotKey = nextSlot?.key;
  if (nextSlot) {
    setOperatorSlotDataFlag(nextSlot.key, "data-hovered", true);
  }
}

function operatorAddressFromTarget(
  target: EventTarget | null,
): OperatorSlotAddress | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const slot = target.closest<HTMLElement>(".simulator-slot");
  const key = slot?.dataset.key;
  return key ? operatorAddressByKey(key) : undefined;
}

function operatorAddressAtPoint(
  clientX: number,
  clientY: number,
): OperatorSlotAddress | undefined {
  const slots = window.document.elementsFromPoint(clientX, clientY);
  for (const element of slots) {
    const address = operatorAddressFromTarget(element);
    if (address) {
      return address;
    }
  }
  return undefined;
}

function operatorFacilitySlotAddresses(
  type: RoomKey,
  position: number,
): OperatorSlotAddress[] {
  const facilityKey = operatorFacilityKey(type, position);
  return orderedOperatorSlotAddresses().filter(
    (address) => operatorFacilityKeyForAddress(address) === facilityKey,
  );
}

function isOperatorClipboardSource(key: string): boolean {
  return operatorClipboardSourceKeys.value.has(key);
}

function isOperatorPasteHighlighted(key: string): boolean {
  return operatorPasteHighlightKeys.value.has(key);
}

function setHoveredOperatorSlot(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): void {
  const address = operatorSlotAddress(planIndex, type, position, slotIndex);
  if (operatorPointerInteraction.value?.mode === "move") {
    setOperatorDragHoveredSlot(address);
    return;
  }
  hoveredOperatorSlot.value = address;
}

function clearHoveredOperatorSlot(key: string): void {
  if (operatorPointerInteraction.value?.mode === "move") {
    if (operatorDragHoveredSlotKey === key) {
      setOperatorDragHoveredSlot(undefined);
    }
    return;
  }
  if (hoveredOperatorSlot.value?.key === key) {
    hoveredOperatorSlot.value = undefined;
  }
}

function selectOperatorSlot(
  event: MouseEvent,
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): void {
  if (suppressNextOperatorClick.value) {
    suppressNextOperatorClick.value = false;
    return;
  }
  const address = operatorSlotAddress(planIndex, type, position, slotIndex);
  const wasEditingSelectedSlot = editingOperatorSlot.value?.key === address.key;
  const shouldSwitchPicker =
    operatorPicker.value !== undefined &&
    operatorPicker.value.key !== address.key;
  if (!commitPendingOperatorNameEdit()) {
    return;
  }
  const nextSelection = new Set(selectedOperatorSlots.value);
  const anchor = operatorSelectionAnchor.value;
  const addressFacilityKey = operatorFacilityKeyForAddress(address);
  const anchorFacilityKey = anchor
    ? operatorFacilityKeyForAddress(anchor)
    : undefined;
  const anchorFacilitySlotIndex = anchor
    ? operatorFacilitySlotIndex(anchor)
    : undefined;
  const addressFacilitySlotIndex = operatorFacilitySlotIndex(address);
  if (
    event.shiftKey &&
    anchor &&
    anchorFacilityKey === addressFacilityKey &&
    anchorFacilitySlotIndex !== undefined &&
    addressFacilitySlotIndex !== undefined
  ) {
    const startPlanIndex = Math.min(anchor.planIndex, planIndex);
    const endPlanIndex = Math.max(anchor.planIndex, planIndex);
    const startSlotIndex = Math.min(
      anchorFacilitySlotIndex,
      addressFacilitySlotIndex,
    );
    const endSlotIndex = Math.max(
      anchorFacilitySlotIndex,
      addressFacilitySlotIndex,
    );
    operatorFacilitySlotAddresses(type, position).forEach((item) => {
      const itemSlotIndex = operatorFacilitySlotIndex(item);
      if (
        itemSlotIndex !== undefined &&
        item.planIndex >= startPlanIndex &&
        item.planIndex <= endPlanIndex &&
        itemSlotIndex >= startSlotIndex &&
        itemSlotIndex <= endSlotIndex
      ) {
        nextSelection.add(item.key);
      }
    });
  } else if (event.shiftKey) {
    nextSelection.clear();
    nextSelection.add(address.key);
  } else if (event.ctrlKey || event.metaKey) {
    if (nextSelection.has(address.key)) {
      nextSelection.delete(address.key);
    } else {
      nextSelection.add(address.key);
    }
  } else {
    nextSelection.clear();
    nextSelection.add(address.key);
  }
  resetOperatorSelectAllCycle();
  selectedOperatorSlots.value = nextSelection;
  operatorSelectionAnchor.value = address;
  if (shouldSwitchPicker) {
    beginOperatorNameEdit(
      planIndex,
      type,
      position,
      slotIndex,
      undefined,
      true,
    );
  }
  if (!wasEditingSelectedSlot) {
    focusSelectedOperatorNameInput();
  }
}

function operatorNameInputFromTarget(
  target: EventTarget | null,
): HTMLInputElement | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const input = target.closest("input.simulator-slot-name-input");
  return input instanceof HTMLInputElement ? input : undefined;
}

function keyboardShortcutKey(event: KeyboardEvent): string {
  const codeKeys: Record<string, string> = {
    KeyC: "c",
    KeyX: "x",
    KeyV: "v",
    KeyZ: "z",
    KeyY: "y",
  };
  return codeKeys[event.code] ?? event.key.toLowerCase();
}

function currentOperatorTarget(): OperatorSlotAddress | undefined {
  return selectedOperatorSlotAddresses()[0] ?? hoveredOperatorSlot.value;
}

function operatorShortcutSource(): OperatorSlotAddress[] {
  const selected = selectedOperatorSlotAddresses();
  if (selected.length > 0) {
    return selected;
  }
  const target = currentOperatorTarget();
  return target ? [target] : [];
}

function operatorSelectAllAddresses(
  stage: 0 | 1 | 2,
  anchor: OperatorSlotAddress,
): OperatorSlotAddress[] {
  if (stage === 0) {
    const plan = currentDocument.value?.plans[anchor.planIndex];
    const facilityKey = operatorFacilityKeyForAddress(anchor);
    return plan
      ? operatorSlotAddressesForPlan(anchor.planIndex).filter(
          (address) => operatorFacilityKeyForAddress(address) === facilityKey,
        )
      : [];
  }
  if (stage === 1) {
    return operatorFacilitySlotAddresses(anchor.type, anchor.position);
  }
  return orderedOperatorSlotAddresses();
}

function selectAllOperators(): boolean {
  if (!commitPendingOperatorNameEdit()) {
    return false;
  }
  const anchor = currentOperatorTarget();
  if (!anchor) {
    return false;
  }
  const addresses = operatorSelectAllAddresses(
    operatorSelectAllStage.value,
    anchor,
  );
  if (addresses.length === 0) {
    return false;
  }
  selectedOperatorSlots.value = new Set(
    addresses.map((address) => address.key),
  );
  operatorSelectionAnchor.value = anchor;
  operatorSelectAllStage.value = Math.min(
    2,
    operatorSelectAllStage.value + 1,
  ) as 0 | 1 | 2;
  return true;
}

function clearOperatorSelection(): void {
  selectedOperatorSlots.value = new Set();
  operatorSelectionAnchor.value = undefined;
  resetOperatorSelectAllCycle();
}

function operatorSlotSnapshotAt(
  document: ScheduleDocument,
  address: OperatorSlotAddress,
): OperatorSlotSnapshot {
  const plan = document.plans[address.planIndex];
  const room = plan
    ? operatorRoomAtDocument(document, address, false)
    : undefined;
  const name = plan
    ? operatorNameAt(plan, address.type, address.position, address.slotIndex)
    : "";
  const state = name ? room?.operatorStates?.[name] : undefined;
  return {
    name,
    ...(state ? { state: cloneOperatorState(state) } : {}),
  };
}

function operatorSlotSnapshotsEqual(
  left: OperatorSlotSnapshot,
  right: OperatorSlotSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operatorRoomAddressKey(address: OperatorSlotAddress): string {
  return `${address.planIndex}-${address.type}-${address.position}`;
}

function operatorTransferPairs(
  sourceAddresses: OperatorSlotAddress[],
  target: OperatorSlotAddress,
): Array<[OperatorSlotAddress, OperatorSlotAddress]> {
  const sources = sourceAddresses.filter((address) =>
    operatorAddressByKey(address.key),
  );
  if (sources.length === 0) {
    return [];
  }
  const sourceFacilityKey = operatorFacilityKeyForAddress(sources[0]!);
  const sourceCoordinates: Array<{
    source: OperatorSlotAddress;
    slotIndex: number;
  }> = [];
  if (
    sources.every(
      (source) => operatorFacilityKeyForAddress(source) === sourceFacilityKey,
    )
  ) {
    for (const source of sources) {
      const slotIndex = operatorFacilitySlotIndex(source);
      if (slotIndex === undefined) {
        sourceCoordinates.length = 0;
        break;
      }
      sourceCoordinates.push({ source, slotIndex });
    }
  }
  const targetSlotIndex = operatorFacilitySlotIndex(target);
  if (
    sourceCoordinates.length === sources.length &&
    sourceCoordinates.length > 0 &&
    targetSlotIndex !== undefined
  ) {
    const firstPlanIndex = Math.min(
      ...sourceCoordinates.map(({ source }) => source.planIndex),
    );
    const firstSlotIndex = Math.min(
      ...sourceCoordinates.map(({ slotIndex }) => slotIndex),
    );
    return sourceCoordinates.flatMap(({ source, slotIndex }) => {
      const destination = operatorAddressAtFacilitySlot(
        target.planIndex + source.planIndex - firstPlanIndex,
        target.type,
        target.position,
        targetSlotIndex + slotIndex - firstSlotIndex,
      );
      return destination ? [[source, destination] as const] : [];
    });
  }

  const addresses = operatorSlotAddressesForPlan(target.planIndex);
  const startIndex = addresses.findIndex(
    (address) => address.key === target.key,
  );
  if (startIndex < 0) {
    return [];
  }
  return sources.flatMap((source, index) => {
    const destination = addresses[startIndex + index];
    return destination ? [[source, destination] as const] : [];
  });
}

function swapOperatorAddressPairs(
  pairs: Array<[OperatorSlotAddress, OperatorSlotAddress]>,
): OperatorSlotAddress[] {
  const document = currentDocument.value;
  if (!document || pairs.length === 0) {
    return [];
  }

  const snapshots = new Map<string, OperatorSlotSnapshot>();
  pairs.forEach(([source, destination]) => {
    if (!snapshots.has(source.key)) {
      snapshots.set(source.key, operatorSlotSnapshotAt(document, source));
    }
    if (!snapshots.has(destination.key)) {
      snapshots.set(
        destination.key,
        operatorSlotSnapshotAt(document, destination),
      );
    }
  });

  const assignments = new Map<string, OperatorSlotSnapshot>();
  const sourceKeys = new Set(pairs.map(([source]) => source.key));
  const destinationKeys = new Set(
    pairs.map(([, destination]) => destination.key),
  );
  const overlaps = [...sourceKeys].some((key) => destinationKeys.has(key));
  if (overlaps) {
    pairs.forEach(([source, destination]) => {
      const sourceSnapshot = snapshots.get(source.key);
      if (sourceSnapshot) {
        assignments.set(destination.key, sourceSnapshot);
      }
    });
    sourceKeys.forEach((key) => {
      if (!destinationKeys.has(key)) {
        assignments.set(key, { name: "" });
      }
    });
  } else {
    pairs.forEach(([source, destination]) => {
      const sourceSnapshot = snapshots.get(source.key);
      const destinationSnapshot = snapshots.get(destination.key);
      if (sourceSnapshot && destinationSnapshot) {
        assignments.set(source.key, destinationSnapshot);
        assignments.set(destination.key, sourceSnapshot);
      }
    });
  }

  const changed = [...assignments.entries()].some(([key, snapshot]) => {
    const current = snapshots.get(key);
    return current ? !operatorSlotSnapshotsEqual(current, snapshot) : false;
  });
  if (!changed) {
    return [];
  }

  const updated = updateCurrent((candidate) => {
    const changesByRoom = new Map<
      string,
      Array<{ address: OperatorSlotAddress; snapshot: OperatorSlotSnapshot }>
    >();
    assignments.forEach((snapshot, key) => {
      const address = operatorAddressByKey(key);
      if (!address) {
        return;
      }
      const roomKey = operatorRoomAddressKey(address);
      const changes = changesByRoom.get(roomKey) ?? [];
      changes.push({ address, snapshot });
      changesByRoom.set(roomKey, changes);
    });

    changesByRoom.forEach((changes) => {
      const firstChange = changes[0];
      if (!firstChange) {
        return;
      }
      const room = operatorRoomAtDocument(candidate, firstChange.address, true);
      if (!room) {
        return;
      }
      const capacity = operatorRoomCapacity(
        candidate,
        firstChange.address.type,
        firstChange.address.position,
      );
      const names = Array.from(
        { length: capacity },
        (_, index) => room.operators?.[index] ?? "",
      );
      const stateOverrides = new Map<string, OperatorState>();
      changes.forEach(({ address, snapshot }) => {
        names[address.slotIndex] = snapshot.name;
        if (snapshot.name && snapshot.state) {
          stateOverrides.set(snapshot.name, snapshot.state);
        }
      });
      setRoomOperators(room, names, stateOverrides);
    });
  });

  if (!updated) {
    return [];
  }
  const destinationAddresses = pairs
    .map(([, destination]) => destination)
    .filter(
      (address, index, addresses) =>
        addresses.findIndex((item) => item.key === address.key) === index,
    );
  resetOperatorSelectAllCycle();
  selectedOperatorSlots.value = new Set(
    destinationAddresses.map((address) => address.key),
  );
  operatorSelectionAnchor.value = destinationAddresses[0];
  return destinationAddresses;
}

function selectOperatorSlotsInBox(
  interaction: OperatorPointerInteraction,
): void {
  const left = Math.min(interaction.startX, interaction.currentX);
  const right = Math.max(interaction.startX, interaction.currentX);
  const top = Math.min(interaction.startY, interaction.currentY);
  const bottom = Math.max(interaction.startY, interaction.currentY);
  const addresses = Array.from(
    window.document.querySelectorAll<HTMLElement>(
      ".simulator-facility-grid .simulator-slot[data-key]",
    ),
  )
    .filter((slot) => {
      const rect = slot.getBoundingClientRect();
      return (
        rect.right >= left &&
        rect.left <= right &&
        rect.bottom >= top &&
        rect.top <= bottom
      );
    })
    .map((slot) => operatorAddressByKey(slot.dataset.key ?? ""))
    .filter((address): address is OperatorSlotAddress => Boolean(address));
  const nextSelection = new Set(
    interaction.additive
      ? selectedOperatorSlots.value
      : addresses.map((address) => address.key),
  );
  addresses.forEach((address) => nextSelection.add(address.key));
  resetOperatorSelectAllCycle();
  selectedOperatorSlots.value = nextSelection;
  const anchor = addresses[0] ?? interaction.startAddress;
  if (anchor) {
    operatorSelectionAnchor.value = anchor;
  }
}

function operatorGridPointerTarget(
  target: EventTarget | null,
): Element | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  if (
    target.closest(
      ".ant-card-head, button, input, textarea, select, a, .simulator-context-menu",
    )
  ) {
    return undefined;
  }
  const grid = target.closest(".simulator-facility-grid");
  const queue = target.closest(".simulator-facility-queue");
  return grid && queue ? target : undefined;
}

function updateOperatorDragPreviewPosition(
  clientX: number,
  clientY: number,
): void {
  const element = operatorDragPreviewElement.value;
  if (!element) {
    return;
  }
  element.style.insetInlineStart = `${clientX}px`;
  element.style.insetBlockStart = `${clientY}px`;
}

function applyOperatorGridPointerMove(
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  const interaction = operatorPointerInteraction.value;
  if (!interaction || interaction.pointerId !== pointerId) {
    return;
  }
  const previousMode = interaction.mode;
  if (
    interaction.mode === "press" &&
    (interaction.startX !== clientX || interaction.startY !== clientY)
  ) {
    interaction.mode = interaction.sourceAddresses.length > 0 ? "move" : "box";
  }
  if (interaction.mode === "move") {
    if (previousMode !== "move") {
      const previousHoveredSlot = hoveredOperatorSlot.value;
      hoveredOperatorSlot.value = undefined;
      setOperatorDragHoveredSlot(previousHoveredSlot);
      interaction.currentX = clientX;
      interaction.currentY = clientY;
    }
    updateOperatorDragPreviewPosition(clientX, clientY);
    if (previousMode !== "move") {
      void nextTick(() => {
        if (operatorPointerInteraction.value?.pointerId === pointerId) {
          updateOperatorDragPreviewPosition(clientX, clientY);
        }
      });
    }
  } else {
    interaction.currentX = clientX;
    interaction.currentY = clientY;
  }
  if (interaction.mode !== "move") {
    return;
  }
  const nextTarget = operatorAddressAtPoint(clientX, clientY);
  setOperatorDragTarget(nextTarget);
}

function cancelOperatorPointerMoveFrame(): void {
  pendingOperatorPointerMove = undefined;
  if (operatorPointerMoveFrame !== undefined) {
    cancelAnimationFrame(operatorPointerMoveFrame);
    operatorPointerMoveFrame = undefined;
  }
}

function flushOperatorPointerMove(): void {
  const pending = pendingOperatorPointerMove;
  cancelOperatorPointerMoveFrame();
  if (pending) {
    applyOperatorGridPointerMove(
      pending.pointerId,
      pending.clientX,
      pending.clientY,
    );
  }
}

function handleOperatorGridPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !operatorGridPointerTarget(event.target)) {
    return;
  }
  if (!commitPendingOperatorNameEdit()) {
    return;
  }
  const startAddress = operatorAddressFromTarget(event.target);
  const hasOperator = startAddress
    ? Boolean(
        currentDocument.value &&
        operatorNameAtAddress(currentDocument.value, startAddress),
      )
    : false;
  const sourceAddresses =
    startAddress && event.shiftKey && hasOperator
      ? selectedOperatorSlots.value.has(startAddress.key)
        ? selectedOperatorSlotAddresses()
        : [startAddress]
      : [];
  const mode = startAddress ? "press" : "box";
  operatorPointerInteraction.value = {
    mode,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    startAddress,
    sourceAddresses,
    additive: event.ctrlKey || event.metaKey,
  };
  suppressNextOperatorClick.value = false;
  if (mode !== "press") {
    event.preventDefault();
  }
}

function handleOperatorGridPointerMove(event: PointerEvent): void {
  const interaction = operatorPointerInteraction.value;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }
  const startsPointerInteraction =
    interaction.mode === "press" &&
    (interaction.startX !== event.clientX ||
      interaction.startY !== event.clientY);
  if (interaction.mode !== "press" || startsPointerInteraction) {
    event.preventDefault();
  }
  pendingOperatorPointerMove = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  };
  if (operatorPointerMoveFrame === undefined) {
    operatorPointerMoveFrame = requestAnimationFrame(() => {
      operatorPointerMoveFrame = undefined;
      const pending = pendingOperatorPointerMove;
      pendingOperatorPointerMove = undefined;
      if (pending) {
        applyOperatorGridPointerMove(
          pending.pointerId,
          pending.clientX,
          pending.clientY,
        );
      }
    });
  }
}

function handleOperatorGridPointerUp(event: PointerEvent): void {
  const interaction = operatorPointerInteraction.value;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }
  let finalHoveredSlot: OperatorSlotAddress | undefined;
  flushOperatorPointerMove();
  interaction.currentX = event.clientX;
  interaction.currentY = event.clientY;
  if (interaction.mode === "box") {
    selectOperatorSlotsInBox(interaction);
    suppressNextOperatorClick.value = true;
  } else if (interaction.mode === "move") {
    finalHoveredSlot = operatorDragHoveredSlotKey
      ? operatorAddressByKey(operatorDragHoveredSlotKey)
      : undefined;
    const target =
      operatorDragTarget ??
      operatorAddressAtPoint(event.clientX, event.clientY);
    if (target) {
      const pairs = operatorTransferPairs(interaction.sourceAddresses, target);
      const destinations = swapOperatorAddressPairs(pairs);
      if (destinations.length > 0) {
        showOperatorMessage(
          destinations.length < interaction.sourceAddresses.length
            ? `已交换 ${destinations.length} 个槽位，超出目标槽位的内容已截断`
            : `已交换 ${destinations.length} 个槽位`,
        );
      }
    }
    suppressNextOperatorClick.value = true;
  }
  operatorPointerInteraction.value = undefined;
  setOperatorDragTarget(undefined);
  setOperatorDragHoveredSlot(undefined);
  if (interaction.mode === "move") {
    hoveredOperatorSlot.value = finalHoveredSlot;
  }
}

function handleOperatorGridPointerCancel(event: PointerEvent): void {
  const interaction = operatorPointerInteraction.value;
  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }
  cancelOperatorPointerMoveFrame();
  operatorPointerInteraction.value = undefined;
  setOperatorDragTarget(undefined);
  if (interaction.mode === "move") {
    const hoveredSlot = operatorDragHoveredSlotKey
      ? operatorAddressByKey(operatorDragHoveredSlotKey)
      : undefined;
    setOperatorDragHoveredSlot(undefined);
    hoveredOperatorSlot.value = hoveredSlot;
  }
  suppressNextOperatorClick.value = true;
}

function handleWindowSelectStart(event: Event): void {
  const mode = operatorPointerInteraction.value?.mode;
  const target = event.target;
  const slot =
    target instanceof Element
      ? target.closest<HTMLElement>(".simulator-slot")
      : undefined;
  const editableTarget =
    target instanceof Element
      ? target.closest("input, textarea, select")
      : undefined;
  if ((mode === "box" || mode === "move" || slot) && !editableTarget) {
    event.preventDefault();
  }
}

function clearOperatorClipboard(): void {
  operatorClipboard.value = undefined;
  operatorPasteHighlightKeys.value = new Set();
  if (operatorPasteHighlightTimer !== undefined) {
    clearTimeout(operatorPasteHighlightTimer);
    operatorPasteHighlightTimer = undefined;
  }
}

function setOperatorClipboard(
  mode: "copy" | "cut",
  entries: OperatorClipboardEntry[],
  addresses: OperatorSlotAddress[],
): void {
  operatorPasteHighlightKeys.value = new Set();
  if (operatorPasteHighlightTimer !== undefined) {
    clearTimeout(operatorPasteHighlightTimer);
    operatorPasteHighlightTimer = undefined;
  }
  operatorClipboard.value = {
    mode,
    entries,
    sourceAddresses: addresses.map((address) => ({ ...address })),
  };
}

function showOperatorPasteHighlight(addresses: OperatorSlotAddress[]): void {
  operatorPasteHighlightKeys.value = new Set(
    addresses.map((address) => address.key),
  );
  if (operatorPasteHighlightTimer !== undefined) {
    clearTimeout(operatorPasteHighlightTimer);
  }
  operatorPasteHighlightTimer = setTimeout(() => {
    operatorPasteHighlightKeys.value = new Set();
    operatorPasteHighlightTimer = undefined;
  }, 700);
}

function operatorClipboardIsUsable(): boolean {
  const clipboard = operatorClipboard.value;
  if (!clipboard || clipboard.entries.length === 0) {
    return false;
  }
  const validKeys = new Set(
    orderedOperatorSlotAddresses().map((address) => address.key),
  );
  if (
    clipboard.sourceAddresses.length !== clipboard.entries.length ||
    clipboard.sourceAddresses.some((address) => !validKeys.has(address.key))
  ) {
    clearOperatorClipboard();
    return false;
  }
  return true;
}

function operatorClipboardEntries(
  addresses: OperatorSlotAddress[],
): OperatorClipboardEntry[] {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }
  return addresses.map((address) => {
    const name = operatorNameAtAddress(document, address);
    const room = operatorRoomAtDocument(document, address, false);
    const state = name ? room?.operatorStates?.[name] : undefined;
    return {
      name,
      ...(state ? { state: cloneOperatorState(state) } : {}),
    };
  });
}

function copyOperators(): boolean {
  if (!commitPendingOperatorNameEdit()) {
    return false;
  }
  const addresses = operatorShortcutSource();
  const entries = operatorClipboardEntries(addresses);
  if (entries.length === 0) {
    return false;
  }
  const operatorCount = entries.filter((entry) => entry.name).length;
  setOperatorClipboard("copy", entries, addresses);
  clearOperatorSelection();
  showOperatorMessage(
    operatorCount > 0
      ? `已复制 ${operatorCount} 名干员`
      : `已复制 ${entries.length} 个空槽位`,
  );
  return true;
}

function clearOperatorSlots(addresses: OperatorSlotAddress[]): boolean {
  const document = currentDocument.value;
  if (!document) {
    return false;
  }
  const effectiveAddresses = addresses.filter((address) =>
    operatorNameAtAddress(document, address),
  );
  if (effectiveAddresses.length === 0) {
    showOperatorMessage("当前目标没有可删除的干员");
    return false;
  }
  if (editingOperatorSlot.value) {
    finishOperatorNameEdit(editingOperatorSlot.value.key);
  }
  const groups = new Map<string, OperatorSlotAddress[]>();
  effectiveAddresses.forEach((address) => {
    const key = `${address.planIndex}-${address.type}-${address.position}`;
    const group = groups.get(key) ?? [];
    group.push(address);
    groups.set(key, group);
  });
  const updated = updateCurrent(
    (candidate) => {
      groups.forEach((group) => {
        const first = group[0];
        if (!first) {
          return;
        }
        const room = operatorRoomAtDocument(candidate, first, true);
        if (!room) {
          return;
        }
        const indexes = new Set(group.map((address) => address.slotIndex));
        const names = room.operators ?? [];
        const nextNames = names.map((name, index) =>
          indexes.has(index) ? "" : name,
        );
        if (nextNames.length !== names.length) {
          setRoomOperators(room, nextNames);
        } else if (nextNames.some((name, index) => name !== names[index])) {
          setRoomOperators(room, nextNames);
        }
      });
    },
    { recordHistory: true },
  );
  if (!updated) {
    return false;
  }
  return true;
}

function setRoomOperators(
  room: RoomAssignment,
  names: string[],
  stateOverrides: Map<string, OperatorState> = new Map(),
): void {
  const normalizedNames = trimOperatorSlots(names);
  const occupiedNames = normalizedNames.filter(Boolean);
  if (occupiedNames.length === 0) {
    delete room.operators;
    delete room.operatorStates;
    return;
  }
  const nextStates: Record<string, OperatorState> = {};
  normalizedNames.forEach((name) => {
    if (!name) {
      return;
    }
    const state = stateOverrides.get(name) ?? room.operatorStates?.[name];
    if (state) {
      nextStates[name] = cloneOperatorState(state);
    }
  });
  room.operators = normalizedNames;
  delete room.skip;
  if (Object.keys(nextStates).length > 0) {
    room.operatorStates = nextStates;
  } else {
    delete room.operatorStates;
  }
}

function cutOperators(): boolean {
  if (!commitPendingOperatorNameEdit()) {
    return false;
  }
  const addresses = operatorShortcutSource();
  const entries = operatorClipboardEntries(addresses);
  const operatorCount = entries.filter((entry) => entry.name).length;
  if (entries.length === 0) {
    return false;
  }
  setOperatorClipboard("cut", entries, addresses);
  if (operatorCount > 0) {
    clearOperatorSlots(addresses);
  }
  clearOperatorSelection();
  showOperatorMessage(
    operatorCount > 0
      ? `已剪切 ${operatorCount} 名干员`
      : `已剪切 ${entries.length} 个空槽位`,
  );
  return true;
}

function pasteOperators(): boolean {
  if (!operatorClipboardIsUsable()) {
    return false;
  }
  const clipboard = operatorClipboard.value;
  if (!clipboard) {
    return false;
  }
  if (!commitPendingOperatorNameEdit()) {
    return false;
  }
  const target = currentOperatorTarget();
  const document = currentDocument.value;
  if (!target || !document) {
    showOperatorMessage("请先选择要粘贴到的干员槽位");
    return false;
  }
  const sourceEntries = new Map<string, OperatorClipboardEntry>();
  clipboard.sourceAddresses.forEach((address, index) => {
    const entry = clipboard.entries[index];
    if (entry) {
      sourceEntries.set(address.key, entry);
    }
  });
  const transferEntries = operatorTransferPairs(
    clipboard.sourceAddresses,
    target,
  ).flatMap(([source, address]) => {
    const entry = sourceEntries.get(source.key);
    return entry ? [{ address, entry }] : [];
  });
  const pastedAddresses = transferEntries.map(({ address }) => address);
  if (transferEntries.length === 0) {
    return false;
  }
  if (editingOperatorSlot.value) {
    finishOperatorNameEdit(editingOperatorSlot.value.key);
  }
  const updated = updateCurrent(
    (candidate) => {
      const changesByRoom = new Map<
        string,
        Array<{ address: OperatorSlotAddress; entry: OperatorClipboardEntry }>
      >();
      transferEntries.forEach(({ address, entry }) => {
        const roomKey = operatorRoomAddressKey(address);
        const changes = changesByRoom.get(roomKey) ?? [];
        changes.push({ address, entry });
        changesByRoom.set(roomKey, changes);
      });

      changesByRoom.forEach((changes) => {
        const firstChange = changes[0];
        if (!firstChange) {
          return;
        }
        const room = operatorRoomAtDocument(
          candidate,
          firstChange.address,
          true,
        );
        if (!room) {
          return;
        }
        const targetCapacity = operatorRoomCapacity(
          candidate,
          firstChange.address.type,
          firstChange.address.position,
        );
        const names = Array.from(
          { length: targetCapacity },
          (_, index) => room.operators?.[index] ?? "",
        );
        const stateOverrides = new Map<string, OperatorState>();
        changes.forEach(({ address, entry }) => {
          names[address.slotIndex] = entry.name;
          if (entry.name && entry.state) {
            stateOverrides.set(entry.name, entry.state);
          }
        });
        setRoomOperators(room, names, stateOverrides);
      });
    },
    { recordHistory: true },
  );
  if (!updated) {
    return false;
  }
  resetOperatorSelectAllCycle();
  selectedOperatorSlots.value = new Set(
    pastedAddresses.map((address) => address.key),
  );
  operatorSelectionAnchor.value = pastedAddresses[0] ?? target;
  const operatorCount = transferEntries.filter(
    ({ entry }) => entry.name,
  ).length;
  const truncated = transferEntries.length < clipboard.entries.length;
  if (clipboard.mode === "cut") {
    clearOperatorClipboard();
  }
  showOperatorPasteHighlight(pastedAddresses);
  showOperatorMessage(
    truncated
      ? `已粘贴 ${operatorCount} 名干员，超出目标槽位的内容已截断`
      : `已粘贴 ${operatorCount} 名干员`,
  );
  return true;
}

function operatorDeletionTargets(): OperatorSlotAddress[] {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }
  const selected = selectedOperatorSlotAddresses();
  if (selected.length > 0) {
    return selected;
  }
  const hovered = hoveredOperatorSlot.value;
  return hovered && operatorNameAtAddress(document, hovered) ? [hovered] : [];
}

function deleteOperators(): boolean {
  const targets = operatorDeletionTargets();
  if (targets.length === 0) {
    showOperatorMessage("当前没有可删除的干员");
    return false;
  }
  const count = targets.filter((address) => {
    const document = currentDocument.value;
    return document ? Boolean(operatorNameAtAddress(document, address)) : false;
  }).length;
  const updated = clearOperatorSlots(targets);
  if (updated) {
    resetOperatorSelectAllCycle();
    showOperatorMessage(`已删除 ${count} 名干员`);
  }
  return updated;
}

function pruneOperatorSelection(): void {
  const validKeys = new Set(
    orderedOperatorSlotAddresses().map((address) => address.key),
  );
  selectedOperatorSlots.value = new Set(
    [...selectedOperatorSlots.value].filter((key) => validKeys.has(key)),
  );
}

function restoreScheduleHistory(action: "undo" | "redo"): void {
  const documentId = activeDocumentId.value;
  const stored = activeDocument.value;
  if (!documentId || !stored) {
    return;
  }
  const history = scheduleHistoryFor(documentId);
  const source = action === "undo" ? history.undo : history.redo;
  const destination = action === "undo" ? history.redo : history.undo;
  const entry = source.pop();
  if (!entry) {
    showOperatorMessage(
      action === "undo" ? "没有可撤销的排班表修改" : "没有可还原的排班表修改",
    );
    return;
  }
  const snapshot = action === "undo" ? entry.before : entry.after;
  const inferredLayout =
    action === "undo" ? entry.beforeInferredLayout : entry.afterInferredLayout;
  const candidate = cloneSchedule(snapshot);
  try {
    validateSchedule(candidate);
  } catch (error: unknown) {
    source.push(entry);
    setError(error);
    return;
  }
  destination.push(entry);
  if (destination.length > MAX_SCHEDULE_HISTORY) {
    destination.shift();
  }
  if (editingOperatorSlot.value) {
    finishOperatorNameEdit(editingOperatorSlot.value.key);
  }
  draftOperatorNames.value = {};
  resetOperatorSelectAllCycle();
  updateDocument(documentId, (target) => {
    target.document = candidate;
    target.inferredLayout = inferredLayout;
  });
  operatorClipboardIsUsable();
  pruneOperatorSelection();
  showOperatorMessage(
    action === "undo" ? "已撤销排班表修改" : "已还原排班表修改",
  );
}

function selectOperatorAddress(address: OperatorSlotAddress): void {
  resetOperatorSelectAllCycle();
  selectedOperatorSlots.value = new Set([address.key]);
  operatorSelectionAnchor.value = address;
  focusSelectedOperatorNameInput();
}

function navigateOperatorSlot(
  action: "tab" | "enter" | "left" | "right" | "up" | "down",
): boolean {
  const current =
    editingOperatorSlot.value ??
    selectedOperatorSlotAddresses()[0] ??
    hoveredOperatorSlot.value;
  const document = currentDocument.value;
  if (!current || !document) {
    return false;
  }
  if (editingOperatorSlot.value && !commitPendingOperatorNameEdit()) {
    return false;
  }
  let target: OperatorSlotAddress | undefined;
  if (action === "enter") {
    const nextPlanIndex =
      document.plans.length > 0
        ? (current.planIndex + 1) % document.plans.length
        : current.planIndex;
    const capacity = operatorRoomCapacity(
      document,
      current.type,
      current.position,
    );
    if (capacity <= 0) {
      return false;
    }
    const nextRoom = operatorRoomAtDocument(
      document,
      operatorSlotAddress(nextPlanIndex, current.type, current.position, 0),
      false,
    );
    const nextNames = nextRoom?.operators ?? [];
    const firstEmpty = Array.from(
      { length: capacity },
      (_, index) => index,
    ).find((index) => !nextNames[index]);
    const targetIndex =
      firstEmpty ?? Math.min(current.slotIndex, Math.max(0, capacity - 1));
    target = operatorSlotAddress(
      nextPlanIndex,
      current.type,
      current.position,
      targetIndex,
    );
  } else if (action === "tab" || action === "left" || action === "right") {
    const slots = operatorSlotAddressesForPlan(current.planIndex);
    const currentIndex = slots.findIndex(
      (address) => address.key === current.key,
    );
    if (currentIndex < 0 || slots.length === 0) {
      return false;
    }
    const direction = action === "left" ? -1 : 1;
    const targetIndex = currentIndex + direction;
    if (action === "tab") {
      target = slots[(targetIndex + slots.length) % slots.length];
    } else if (targetIndex >= 0 && targetIndex < slots.length) {
      target = slots[targetIndex];
    }
  } else {
    const rooms = operatorRoomAddresses();
    const currentRoomIndex = rooms.findIndex(
      (room) =>
        room.type === current.type && room.position === current.position,
    );
    if (currentRoomIndex < 0 || document.plans.length === 0) {
      return false;
    }
    const direction = action === "up" ? -1 : 1;
    let nextRoomIndex = currentRoomIndex;
    let nextPlanIndex = current.planIndex + direction;
    if (nextPlanIndex < 0 || nextPlanIndex >= document.plans.length) {
      nextRoomIndex += direction;
      if (nextRoomIndex < 0 || nextRoomIndex >= rooms.length) {
        return false;
      }
      nextPlanIndex = direction > 0 ? 0 : document.plans.length - 1;
    }
    const nextRoom = rooms[nextRoomIndex];
    if (!nextRoom) {
      return false;
    }
    target = operatorSlotAddress(
      nextPlanIndex,
      nextRoom.type,
      nextRoom.position,
      Math.min(current.slotIndex, nextRoom.slotCount - 1),
    );
  }
  if (target && target.key !== current.key) {
    selectOperatorAddress(target);
  }
  return Boolean(target);
}

function planDurationHoursValue(plan: Plan): number {
  const minutes = Number(plan.duration ?? 720);
  return Math.round((minutes / 60) * 100) / 100;
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
  return `${formatEfficiencyNumber(result.operatorSkillEfficiency)}% / ${formatEfficiencyNumber(result.efficiency)}%`;
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

function operatorCalculationLines(detail: OperatorEfficiencyDetail): string[] {
  const calculation = detail.calculation;
  if (!calculation) {
    return [];
  }
  if (calculation.type === "workHours") {
    const efficiencyLine =
      calculation.durationHours > 0
        ? `效率：${formatNumber(calculation.baseValue)}% × ${formatNumber(
            calculation.activeHours,
          )} ÷ ${formatNumber(calculation.durationHours)} = ${formatNumber(
            detail.value,
          )}%`
        : "效率：队列时长为 0，结果为 0%";
    return [
      `累计工作时长：${formatNumber(
        calculation.beforeHours,
      )} + ${formatNumber(calculation.durationHours)} = ${formatNumber(
        calculation.beforeHours + calculation.durationHours,
      )} 小时（阈值 ${formatNumber(calculation.threshold)} 小时）`,
      `生效时长：max(0, min(${formatNumber(
        calculation.durationHours,
      )}, ${formatNumber(calculation.beforeHours)} + ${formatNumber(
        calculation.durationHours,
      )} - ${formatNumber(calculation.threshold)})) = ${formatNumber(
        calculation.activeHours,
      )} 小时`,
      efficiencyLine,
    ];
  }
  const capIndex = calculation.steps.findIndex(
    (step) => step.value >= calculation.cap,
  );
  const uncappedSteps =
    capIndex >= 0 ? calculation.steps.slice(0, capIndex) : calculation.steps;
  const cappedWeight =
    capIndex >= 0
      ? calculation.steps
          .slice(capIndex)
          .reduce((total, step) => total + step.weight, 0)
      : 0;
  const weightedTerms = [
    ...uncappedSteps.map(
      (step) => `${formatNumber(step.value)} × ${formatNumber(step.weight)}`,
    ),
    ...(capIndex >= 0
      ? [`${formatNumber(calculation.cap)} × ${formatNumber(cappedWeight)}`]
      : []),
  ].join(" + ");
  const weightedTotal = calculation.steps.reduce(
    (total, step) => total + step.value * step.weight,
    0,
  );
  const weightedAverage =
    calculation.durationHours > 0
      ? weightedTotal / calculation.durationHours
      : 0;
  const lines = [
    `累计工作时长：${formatNumber(
      calculation.beforeHours,
    )} + ${formatNumber(calculation.durationHours)} = ${formatNumber(
      calculation.beforeHours + calculation.durationHours,
    )} 小时`,
    `档位公式：min(${formatNumber(
      calculation.startValue,
    )} + (累计时长 + h - ${formatNumber(
      calculation.startHours,
    )}) × ${formatNumber(calculation.step)}, ${formatNumber(calculation.cap)})`,
    calculation.durationHours > 0
      ? `加权平均：(${weightedTerms || "0"}) ÷ ${formatNumber(
          calculation.durationHours,
        )} = ${formatNumber(detail.value)}%`
      : "加权平均：队列时长为 0，结果为 0%",
  ];
  if (calculation.workHours) {
    const efficiencyLine =
      calculation.durationHours > 0
        ? `效率：${formatNumber(weightedAverage)}% × ${formatNumber(
            calculation.workHours.activeHours,
          )} ÷ ${formatNumber(calculation.durationHours)} = ${formatNumber(
            detail.value,
          )}%`
        : "效率：队列时长为 0，结果为 0%";
    lines.push(
      `工作时长条件：生效 ${formatNumber(
        calculation.workHours.activeHours,
      )} 小时 / ${formatNumber(calculation.durationHours)} 小时`,
      efficiencyLine,
    );
  }
  return lines;
}

function formatProduction(value: number): string {
  return formatNumber(value, 3);
}

function productionLabel(product: string): string {
  return product === "Clue" ? "线索" : product;
}

function cluePreferenceText(preferences: CluePreference[] | undefined): string {
  if (!preferences?.length) {
    return "";
  }
  return `更容易获得${preferences
    .map((preference) => {
      if (typeof preference === "number") {
        return `线索${preference}`;
      }
      return preference === "unowned" ? "尚未拥有的线索" : "已经拥有的线索";
    })
    .join("、")}`;
}

function convertedProductionAmount(
  value: ProductionValue,
  amount: number,
): number {
  return amount * (value.conversion?.amountPerUnit ?? 1);
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

function moodSnapshotsForFacility(
  plan: EfficiencyPlanResult,
  result: FacilityEfficiencyResult,
): MoodSnapshot[] {
  return plan.moods.filter(
    (mood) =>
      mood.working &&
      (mood.facilityId === result.facility.id ||
        (result.facility.type === "power" && mood.facility === "power")),
  );
}

function operatorMoodRemaining(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): number | undefined {
  return efficiencyResult.value?.plans[planIndex]?.moods.find(
    (mood) =>
      mood.facilityId === facilityId(type, position) &&
      mood.slotIndex === slotIndex,
  )?.end;
}

function moodRateDetailLabel(detail: MoodRateDetail): string {
  if (detail.kind === "base") {
    return "基础消耗速度";
  }
  if (detail.kind === "controlWorkers") {
    return `控制中枢干员减耗（${detail.count ?? 0}人）`;
  }
  if (detail.kind === "facilityWorkers") {
    return `同设施干员减耗（${detail.count ?? 0}人）`;
  }
  const source = [detail.operator, detail.skill].filter(Boolean).join(" · ");
  return `${source || "技能"}${detail.stat === "moodRecover" ? "恢复" : "消耗"}`;
}

function moodRateFormula(mood: MoodSnapshot): string {
  const [first, ...rest] = mood.rateDetails;
  if (!first) {
    return `0 = ${formatNumber(mood.costRate)}/小时`;
  }
  return `${formatNumber(first.value)}${rest
    .map(
      (detail) =>
        ` ${detail.value >= 0 ? "+" : "-"} ${formatNumber(Math.abs(detail.value))}`,
    )
    .join("")} = ${formatNumber(mood.costRate)}/小时`;
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

function basePointLabel(term: string): string {
  return terms.value[term]?.name ?? term;
}

function basePointSourceText(source: BasePointSource): string {
  const operator = [source.operator, source.skill].filter(Boolean).join(" · ");
  const facility = ROOM_LABELS[source.facility] ?? source.facility;
  if (source.kind === "convert" && source.from) {
    return `${operator}（${facility}，由${basePointLabel(source.from)} × ${formatNumber(source.rate ?? 0)}派生）`;
  }
  return `${operator}（${facility}）`;
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

function operatorHasFacilitySkill(operator: Operator, type: RoomKey): boolean {
  const skillFile =
    efficiencyCatalog.value?.operators[operator.name]?.skillFile;
  if (skillFile) {
    return nodesForOperator(skillFile).some((node) =>
      node.facilities.includes(type),
    );
  }
  return operator.skills.some(
    (skill) => skill.facility === ROOM_LABELS[type] || skill.facility === type,
  );
}

function compareOperatorPickerCandidates(
  left: OperatorPickerCandidate,
  right: OperatorPickerCandidate,
): number {
  const leftOrder = left.operator.implementationOrder;
  const rightOrder = right.operator.implementationOrder;
  if (leftOrder === undefined || rightOrder === undefined) {
    if (leftOrder === undefined && rightOrder === undefined) {
      return left.index - right.index;
    }
    return leftOrder === undefined ? -1 : 1;
  }
  return rightOrder - leftOrder || left.index - right.index;
}

function warnFacilityOperatorOverride(message: string): void {
  if (import.meta.env.DEV) {
    console.warn(`[facility-operator-overrides] ${message}`);
  }
}

function validateFacilityOperatorOverrides(): void {
  if (operators.value.length === 0) {
    return;
  }
  const availableIds = new Set(operators.value.map((operator) => operator.id));
  Object.entries(facilityOperatorOverrides.value).forEach(([, ids]) => {
    (ids ?? []).forEach((id) => {
      if (!availableIds.has(id) && !warnedFacilityOperatorOverrideIds.has(id)) {
        warnFacilityOperatorOverride(`未知干员 ID：${id}`);
        warnedFacilityOperatorOverrideIds.add(id);
      }
    });
  });
}

async function loadFacilityOperatorOverrides(): Promise<void> {
  try {
    const response = await fetch(
      `${import.meta.env.BASE_URL}assets/facility-operator-overrides.json`,
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed: unknown = await response.json();
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("根节点必须是对象");
    }

    const overrides: Partial<Record<RoomKey, string[]>> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(
      ([type, value]) => {
        if (!ROOM_ORDER.includes(type as RoomKey)) {
          warnFacilityOperatorOverride(`未知设施：${type}`);
          return;
        }
        if (!Array.isArray(value)) {
          warnFacilityOperatorOverride(`${type} 的干员列表必须是数组`);
          return;
        }
        const ids = value.filter((id): id is string => {
          if (typeof id === "string" && id.trim()) {
            return true;
          }
          warnFacilityOperatorOverride(`${type} 中存在无效干员 ID`);
          return false;
        });
        if (ids.length > 0) {
          overrides[type as RoomKey] = [...new Set(ids)];
        }
      },
    );
    facilityOperatorOverrides.value = overrides;
    validateFacilityOperatorOverrides();
  } catch (error: unknown) {
    warnFacilityOperatorOverride(
      `读取人工覆盖文件失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}

function operatorState(
  room: RoomAssignment | undefined,
  name: string,
): OperatorState {
  return room?.operatorStates?.[name] ?? {};
}

function operatorMoodScattered(
  room: RoomAssignment | undefined,
  name: string,
): boolean {
  return operatorState(room, name).mood === 0;
}

function progressionMenuNodes(
  operator: Operator,
  type: RoomKey,
): OperatorProgressionNode[] {
  const skillFile =
    efficiencyCatalog.value?.operators[operator.name]?.skillFile;
  const nodes = progressionNodesForFacility(skillFile, type, operator.rarity);
  if (type !== "meeting" || operator.rarity <= 2) {
    return nodes;
  }

  const maxEliteLevel = Math.min(
    operator.maxEliteLevel ?? 0,
    operator.rarity === 3 ? 1 : 2,
  );
  const nodeMap = new Map(nodes.map((node) => [node.key, node]));
  Array.from({ length: maxEliteLevel + 1 }, (_, value) =>
    nodeMap.set(`elite-${value}`, {
      key: `elite-${value}`,
      type: "elite" as const,
      value,
      label: `精英${value}`,
      facilities: [type],
    }),
  );
  return [...nodeMap.values()].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "elite" ? -1 : 1;
    }
    return left.value - right.value;
  });
}

const operatorContextMenuDetails = computed<
  OperatorContextMenuDetails | undefined
>(() => {
  const menu = contextMenu.value;
  const document = currentDocument.value;
  if (!menu || menu.scope !== "queue" || !document) {
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
      dormitoryDefaultIncludesMoodRecovery:
        dormitoryDefaultIncludesMoodRecovery.value,
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
    y: event.clientY,
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
  const clampedTop = Math.min(Math.max(8, menu.y), maxTop);
  if (menu.y !== clampedTop) {
    contextMenu.value = { ...menu, y: clampedTop };
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
  const address = operatorSlotAddress(planIndex, type, position, slotIndex);
  selectedOperatorSlots.value = new Set([address.key]);
  operatorSelectionAnchor.value = address;
  contextMenu.value = {
    ...address,
    scope: "queue",
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
    scope: "queue",
    positions,
    ...contextMenuPosition(event),
  };
  void clampContextMenuPosition();
}

function openFacilityCardContextMenu(event: MouseEvent, row: FacilityRow) {
  if (
    event.target instanceof Element &&
    event.target.closest(".simulator-facility-queue")
  ) {
    return;
  }
  const position = row.entries[0]?.position;
  if (
    position === undefined ||
    !roomHasProduct(row.type) ||
    !currentSimulatorEditSettings.value.product
  ) {
    return;
  }
  if (!commitPendingOperatorNameEdit()) {
    return;
  }
  event.preventDefault();
  contextMenu.value = {
    ...operatorSlotAddress(0, row.type, position, 0),
    scope: "facility",
    positions: [position],
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

function facilityCardContextMenuItems(
  type: RoomKey,
  position: number,
): FacilityContextMenuItem[] {
  const document = currentDocument.value;
  if (!document || !roomHasProduct(type)) {
    return [];
  }
  const rooms = document.plans.map((plan) => roomAt(plan, type, position));
  const currentProduct = rooms.every(
    (room) => (room?.product ?? "") === (rooms[0]?.product ?? ""),
  )
    ? rooms[0]?.product
    : undefined;
  const items: FacilityContextMenuItem[] = [];

  productOptions(type, currentProduct)
    .filter((option) => option.value !== "")
    .forEach((option) => {
      items.push({
        key: `facility-product-${position}-${option.value}`,
        label: option.label,
        check: rooms.every((room) => (room?.product ?? "") === option.value),
        disabled: option.disabled,
        action: () => {
          updateAllPlanRooms(type, position, (room) => {
            if (option.value === "Originium Shard") {
              room.product = option.value;
              room.sourceMaterial ||= DEFAULT_SOURCE_MATERIAL;
            } else {
              room.product = option.value;
              delete room.sourceMaterial;
            }
          });
          closeContextMenu();
        },
      });
    });

  if (
    !rooms.length ||
    !rooms.every((room) => room?.product === "Originium Shard")
  ) {
    return items;
  }

  items.push({
    key: `facility-source-divider-${position}`,
    label: "",
    divider: true,
  });
  SOURCE_MATERIAL_OPTIONS.forEach((option) => {
    items.push({
      key: `facility-source-${position}-${option.value}`,
      label: option.label,
      check: rooms.every((room) => sourceValue(room) === option.value),
      action: () => {
        updateAllPlanRooms(type, position, (room) => {
          room.sourceMaterial = option.value;
        });
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
  if (menu.scope === "facility") {
    const position = menu.positions[0];
    return position === undefined
      ? []
      : [
          {
            key: `${menu.type}-${position}`,
            title: ROOM_LABELS[menu.type],
            items: facilityCardContextMenuItems(menu.type, position),
          },
        ];
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
  updatePlanRoom(
    menu.menu.planIndex,
    menu.menu.type,
    menu.menu.position,
    (room) => {
      const states = room.operatorStates ?? {};
      const state = states[menu.name] ?? {};
      if (node.type === "elite") {
        state.elite = node.value;
        state.level = 1;
      } else {
        if (menu.operator.rarity <= 2) {
          state.elite = 0;
        }
        state.level = node.value;
      }
      if (Object.keys(state).length > 0) {
        states[menu.name] = state;
      } else {
        delete states[menu.name];
      }
      if (Object.keys(states).length > 0) {
        room.operatorStates = states;
      } else {
        delete room.operatorStates;
      }
    },
    { recordHistory: true },
  );
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
    { recordHistory: true },
  );
  closeContextMenu();
}

function handleWindowPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest(".simulator-context-menu")) {
    return;
  }
  closeContextMenu();
}

function handleWindowClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest(".simulator-context-menu")) {
    return;
  }
  if (target instanceof Node && operatorPickerElement.value?.contains(target)) {
    return;
  }
  const slotElement =
    target instanceof Element
      ? target.closest<HTMLElement>(".simulator-slot[data-key]")
      : undefined;
  if (slotElement?.dataset.key === operatorPicker.value?.key) {
    return;
  }
  if (suppressNextOperatorClick.value) {
    suppressNextOperatorClick.value = false;
    closeContextMenu();
    return;
  }
  if (!(target instanceof Element) || !target.closest(".simulator-slot")) {
    clearOperatorSelection();
  }
  if (operatorPicker.value) {
    commitPendingOperatorNameEdit();
    closeOperatorPicker();
  }
  closeContextMenu();
}

function handleWindowWheel() {
  closeContextMenu();
}

function handleWindowScroll() {
  closeContextMenu();
  void updateOperatorPickerPosition();
}

function handleWindowResize() {
  closeContextMenu();
  void updateOperatorPickerPosition();
}

function handleWindowKeydown(event: KeyboardEvent): void {
  const isImeEvent =
    event.isComposing || event.key === "Process" || event.keyCode === 229;
  const operatorInput = operatorNameInputFromTarget(event.target);
  const pendingOperatorInput = operatorInput?.classList.contains(
    "simulator-slot-name-input--pending",
  );
  if (operatorInput && !pendingOperatorInput) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelOperatorNameEdit();
      closeContextMenu();
      return;
    }
    if (
      isImeEvent ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const navigation = event.key === "Enter" ? "enter" : "tab";
      if (navigateOperatorSlot(navigation)) {
        event.preventDefault();
      }
    }
    return;
  }

  if (pendingOperatorInput && event.key === "Backspace") {
    event.preventDefault();
    return;
  }

  if (pendingOperatorInput && event.key === "Delete") {
    event.preventDefault();
    if (operatorDeletionTargets().length > 0) {
      deleteOperators();
    }
    return;
  }

  if (event.key === "Escape") {
    if (pendingOperatorInput) {
      operatorInput?.blur();
    }
    clearOperatorClipboard();
    resetOperatorSelectAllCycle();
    closeOperatorPicker();
    closeContextMenu();
    return;
  }

  const target = event.target instanceof Element ? event.target : undefined;
  const editableTarget = target?.closest("input, textarea, select");
  if (editableTarget && !pendingOperatorInput) {
    return;
  }

  const primaryModifier =
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  if (primaryModifier) {
    const key = keyboardShortcutKey(event);
    if (!["a", "c", "x", "v", "z", "y"].includes(key)) {
      return;
    }
    if (key === "a") {
      if (selectAllOperators()) {
        event.preventDefault();
      }
      return;
    }
    if (key === "z" || key === "y") {
      event.preventDefault();
      restoreScheduleHistory(key === "z" ? "undo" : "redo");
      return;
    }
    if (key === "v" && !operatorClipboardIsUsable()) {
      return;
    }
    if (!currentOperatorTarget()) {
      return;
    }
    event.preventDefault();
    if (key === "c") {
      copyOperators();
    } else if (key === "x") {
      cutOperators();
    } else if (key === "v") {
      pasteOperators();
    } else {
      restoreScheduleHistory(key === "z" ? "undo" : "redo");
    }
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return;
  }

  const navigationKeys: Record<
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
  const navigation = navigationKeys[event.key];
  if (navigation) {
    if (navigateOperatorSlot(navigation)) {
      event.preventDefault();
    }
    return;
  }

  if (pendingOperatorInput && !isImeEvent && event.key.length === 1) {
    return;
  }

  if (!operatorPicker.value && !isImeEvent && event.key.length === 1) {
    const selected = selectedOperatorSlotAddresses();
    if (selected.length === 1) {
      const target = selected[0];
      if (target) {
        event.preventDefault();
        beginOperatorNameEdit(
          target.planIndex,
          target.type,
          target.position,
          target.slotIndex,
          event.key,
        );
      }
      return;
    }
  }

  if (event.key === "Delete" && operatorDeletionTargets().length > 0) {
    event.preventDefault();
    deleteOperators();
  }
}

function handleCreate(): void {
  clearMessages();
  clearImportedScheduleNotice();
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
  clearImportedScheduleNotice();
  try {
    const parsed = DEFAULT_SCHEDULE_ADAPTER.parse(await file.text());
    const stored = createDocument(
      parsed.document,
      parsed.inferredLayout,
      file.name,
    );
    const extraRooms = extraRoomsForDocument(stored.document);
    if (extraRooms.length > 0) {
      importedScheduleNotice.value = {
        code: "import-extra-rooms",
        level: "error",
        message: "导入排班表包含未登记设施实例",
        details: extraRooms.map(extraRoomNoticeDetail),
        closable: true,
      };
    }
    successMessage.value = parsed.inferredLayout
      ? "已导入，布局由文件内容推断。"
      : "已导入排班 JSON。";
  } catch (error: unknown) {
    setError(error);
  }
}

function handleDuplicate(): void {
  clearMessages();
  clearImportedScheduleNotice();
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
  clearImportedScheduleNotice();
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
    const duplicateWarning = formatDuplicateOperatorWarnings(document);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${(document.title?.trim() || "排班模拟器").replace(/[\\/:*?"<>|]/g, "_")}.${DEFAULT_SCHEDULE_ADAPTER.fileExtension}`;
    link.click();
    URL.revokeObjectURL(url);
    successMessage.value = "已导出严格 JSON 文件。";
    if (duplicateWarning) {
      warningMessage.value = `导出文件中存在重复干员配置：${duplicateWarning}`;
    }
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
  closeOperatorPicker();
  clearOperatorSelection();
  setOperatorDragTarget(undefined);
  setOperatorDragHoveredSlot(undefined);
  hoveredOperatorSlot.value = undefined;
  clearOperatorClipboard();
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

watch(operators, validateFacilityOperatorOverrides);

watch(
  [() => operatorPickerCandidates.value.length, operatorPickerColumns],
  () => {
    void updateOperatorPickerPosition();
  },
);

onMounted(() => {
  void loadFacilityOperatorOverrides();
  window.addEventListener("pointerdown", handleWindowPointerDown, true);
  window.addEventListener("click", handleWindowClick);
  window.addEventListener("keydown", handleWindowKeydown, true);
  window.addEventListener("pointermove", handleOperatorGridPointerMove, true);
  window.addEventListener("pointerup", handleOperatorGridPointerUp, true);
  window.addEventListener(
    "pointercancel",
    handleOperatorGridPointerCancel,
    true,
  );
  window.addEventListener("selectstart", handleWindowSelectStart, true);
  window.addEventListener("wheel", handleWindowWheel, { passive: true });
  window.addEventListener("scroll", handleWindowScroll, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", handleWindowResize);
});

onBeforeUnmount(() => {
  cancelOperatorPointerMoveFrame();
  setOperatorDragTarget(undefined);
  setOperatorDragHoveredSlot(undefined);
  window.removeEventListener("pointerdown", handleWindowPointerDown, true);
  window.removeEventListener("click", handleWindowClick);
  window.removeEventListener("keydown", handleWindowKeydown, true);
  window.removeEventListener(
    "pointermove",
    handleOperatorGridPointerMove,
    true,
  );
  window.removeEventListener("pointerup", handleOperatorGridPointerUp, true);
  window.removeEventListener(
    "pointercancel",
    handleOperatorGridPointerCancel,
    true,
  );
  window.removeEventListener("selectstart", handleWindowSelectStart, true);
  window.removeEventListener("wheel", handleWindowWheel);
  window.removeEventListener("scroll", handleWindowScroll, { capture: true });
  window.removeEventListener("resize", handleWindowResize);
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
  }
  if (operatorPasteHighlightTimer !== undefined) {
    clearTimeout(operatorPasteHighlightTimer);
  }
  closeOperatorPicker();
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
      <a-button
        v-if="!showScheduleSidebar"
        aria-label="显示排班表"
        class="simulator-sidebar-toggle"
        title="显示排班表"
        type="text"
        @click="toggleScheduleSidebar"
      >
        <template #icon><MenuUnfoldOutlined /></template>
      </a-button>
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
    <a-alert
      v-if="warningMessage"
      :message="warningMessage"
      class="simulator-alert"
      closable
      show-icon
      type="warning"
      @close="warningMessage = ''"
    />

    <div
      :class="[
        'simulator-layout',
        { 'simulator-layout--sidebar-hidden': !showScheduleSidebar },
      ]"
    >
      <aside v-if="showScheduleSidebar" class="simulator-document-sidebar">
        <div class="simulator-sidebar-head">
          <div>
            <span class="simulator-eyebrow">SCHEDULES</span>
            <h3>排班表</h3>
          </div>
          <div class="simulator-sidebar-head-actions">
            <a-button
              aria-label="新建排班表"
              title="新建排班表"
              type="text"
              @click="handleCreate"
            >
              <template #icon><PlusOutlined /></template>
            </a-button>
            <a-button
              aria-label="隐藏排班表"
              title="隐藏排班表"
              type="text"
              @click="toggleScheduleSidebar"
            >
              <template #icon><MenuFoldOutlined /></template>
            </a-button>
          </div>
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
            @click="selectDocument(document.id)"
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
          @dragstart.prevent
          @pointerdown="handleOperatorGridPointerDown"
        >
          <a-col
            :class="[
              'simulator-queue-column',
              {
                'simulator-queue-column-readonly':
                  !currentSimulatorEditSettings.queue,
              },
            ]"
          >
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
                  :class="[
                    'simulator-queue-info',
                    {
                      'simulator-queue-info-readonly':
                        !currentSimulatorEditSettings.queue,
                    },
                  ]"
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
                      <a-input-number
                        :max="24"
                        :min="1"
                        :value="planDurationHoursValue(plan)"
                        addon-after="小时"
                        class="simulator-queue-duration"
                        size="small"
                        @update:value="
                          (value: number | null) =>
                            updatePlanDurationHours(planIndex, value)
                        "
                      />
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
                    </template>
                    <template v-else>
                      <div class="simulator-queue-entry-title">
                        {{ plan.name?.trim() || "未命名队列" }}
                      </div>
                      <div class="simulator-queue-duration">
                        {{ formatDurationHours(planDurationHoursValue(plan)) }}
                      </div>
                      <div
                        v-if="plan.description?.trim()"
                        class="simulator-queue-description"
                      >
                        {{ plan.description?.trim() }}
                      </div>
                    </template>
                  </div>
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
              @contextmenu.stop.prevent="
                openFacilityCardContextMenu($event, row)
              "
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
                  @contextmenu.stop.prevent
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
                        :data-key="
                          operatorSlotAddress(
                            planIndex,
                            row.type,
                            slot.entry.position,
                            slot.slotIndex,
                          ).key
                        "
                        :class="{
                          'simulator-slot--selected': isOperatorSlotSelected(
                            operatorSlotAddress(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            ).key,
                          ),
                          'simulator-slot--hovered': isOperatorSlotHovered(
                            operatorSlotAddress(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            ).key,
                          ),
                          'simulator-slot--clipboard':
                            isOperatorClipboardSource(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ).key,
                            ),
                          'simulator-slot--paste-highlight':
                            isOperatorPasteHighlighted(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ).key,
                            ),
                        }"
                        @mouseenter="
                          setHoveredOperatorSlot(
                            planIndex,
                            row.type,
                            slot.entry.position,
                            slot.slotIndex,
                          )
                        "
                        @mouseleave="
                          clearHoveredOperatorSlot(
                            operatorSlotAddress(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            ).key,
                          )
                        "
                      >
                        <OperatorAvatarDisplay
                          v-if="slotOperator(row, plan, planIndex, slot)"
                          :data-source="selectedDataSource"
                          :display-name="slotName(row, plan, planIndex, slot)"
                          :elite-level="
                            operatorElite(
                              slotRoom(plan, slot),
                              slotCommittedName(row, plan, slot),
                              row.type,
                            )
                          "
                          :operator="slotOperator(row, plan, planIndex, slot)!"
                          :operator-owned="
                            operatorOwned(
                              slotRoom(plan, slot),
                              slotCommittedName(row, plan, slot),
                            )
                          "
                          :missing="
                            operatorMissing(
                              slotRoom(plan, slot),
                              slotCommittedName(row, plan, slot),
                            )
                          "
                          :mood-scattered="
                            operatorMoodScattered(
                              slotRoom(plan, slot),
                              slotCommittedName(row, plan, slot),
                            )
                          "
                          :mood-remaining="
                            operatorMoodRemaining(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          :operator-training-upgraded="
                            operatorTrainingUpgraded(
                              slotRoom(plan, slot),
                              slotCommittedName(row, plan, slot),
                              row.type,
                            )
                          "
                          :show-elite-level="true"
                          :show-name="true"
                          :show-profession="true"
                          :show-rarity="true"
                          :name-editing="
                            isOperatorNameInputVisible(
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
                          :skipped="
                            roomSkipped(slotRoom(plan, slot)) &&
                            !operatorMissing(
                              slotRoom(plan, slot),
                              slotCommittedName(row, plan, slot),
                            )
                          "
                          @click.stop="
                            selectOperatorSlot(
                              $event,
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
                          @dblclick.stop="
                            beginOperatorNameEdit(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                              undefined,
                              true,
                            )
                          "
                        />
                        <template v-else>
                          <div
                            :style="emptySlotFrameStyle"
                            class="simulator-empty-slot-frame"
                            @click.stop="
                              selectOperatorSlot(
                                $event,
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              )
                            "
                            @dblclick.stop="
                              beginOperatorNameEdit(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                                undefined,
                                true,
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
                                isOperatorNameInputVisible(
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
                              selectOperatorSlot(
                                $event,
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              )
                            "
                            @dblclick.stop="
                              beginOperatorNameEdit(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                                undefined,
                                true,
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
                        <input
                          v-if="
                            isOperatorNameInputVisible(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            )
                          "
                          ref="slotNameInput"
                          :aria-label="`${row.label}干员名称`"
                          :class="{
                            'simulator-slot-name-input--pending':
                              !isEditingOperatorSlot(
                                operatorSlotAddress(
                                  planIndex,
                                  row.type,
                                  slot.entry.position,
                                  slot.slotIndex,
                                ),
                              ),
                          }"
                          :placeholder="
                            !isEditingOperatorSlot(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            ) && !slotName(row, plan, planIndex, slot)
                              ? '空槽位'
                              : undefined
                          "
                          :style="slotNameBandStyle"
                          :value="slotName(row, plan, planIndex, slot)"
                          autocomplete="off"
                          class="simulator-slot-name-input"
                          type="text"
                          @click.stop="
                            !isEditingOperatorSlot(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            ) &&
                            selectOperatorSlot(
                              $event,
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @contextmenu.stop.prevent="
                            !isEditingOperatorSlot(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            ) &&
                            (slotOperator(row, plan, planIndex, slot)
                              ? openOperatorContextMenu(
                                  $event,
                                  planIndex,
                                  row.type,
                                  slot.entry.position,
                                  slot.slotIndex,
                                )
                              : openFacilityContextMenu(
                                  $event,
                                  planIndex,
                                  row.type,
                                  [slot.entry.position],
                                ))
                          "
                          @dblclick.stop="
                            !isEditingOperatorSlot(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            ) &&
                            beginOperatorNameEdit(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                              undefined,
                              true,
                            )
                          "
                          @focus="handleOperatorNameSelection"
                          @blur="
                            commitOperatorName(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @keyup="handleOperatorNameSelection"
                          @input="
                            handleOperatorNameInput(
                              $event,
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @mouseup="handleOperatorNameSelection"
                          @select="handleOperatorNameSelection"
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
          <div
            v-if="operatorPointerInteraction?.mode === 'box'"
            :style="operatorSelectionMarqueeStyle"
            class="simulator-selection-marquee"
          />
        </a-row>

        <div
          v-if="operatorDragPreview"
          ref="operatorDragPreviewElement"
          class="simulator-operator-drag-preview"
        >
          <OperatorAvatarDisplay
            :data-source="selectedDataSource"
            :display-name="operatorDragPreview.name"
            :elite-level="
              operatorElite(
                operatorDragPreview.room,
                operatorDragPreview.name,
                operatorDragPreview.type,
              )
            "
            :operator="operatorDragPreview.operator"
            :operator-owned="
              operatorOwned(operatorDragPreview.room, operatorDragPreview.name)
            "
            :missing="
              operatorMissing(
                operatorDragPreview.room,
                operatorDragPreview.name,
              )
            "
            :mood-scattered="
              operatorMoodScattered(
                operatorDragPreview.room,
                operatorDragPreview.name,
              )
            "
            :mood-remaining="
              operatorMoodRemaining(
                operatorDragPreview.planIndex,
                operatorDragPreview.type,
                operatorDragPreview.position,
                operatorDragPreview.slotIndex,
              )
            "
            :operator-training-upgraded="
              operatorTrainingUpgraded(
                operatorDragPreview.room,
                operatorDragPreview.name,
                operatorDragPreview.type,
              )
            "
            :show-elite-level="true"
            :show-name="true"
            :show-profession="true"
            :show-rarity="true"
            :plain="true"
            :proportional-layout="true"
            :size="simulatorSlotSize"
            :skipped="
              roomSkipped(operatorDragPreview.room) &&
              !operatorMissing(
                operatorDragPreview.room,
                operatorDragPreview.name,
              )
            "
          />
          <span
            v-if="operatorDragPreview.count > 1"
            class="simulator-operator-drag-preview-count"
            >×{{ operatorDragPreview.count }}</span
          >
        </div>

        <div
          v-if="operatorPicker"
          ref="operatorPickerElement"
          :class="[
            'simulator-operator-picker',
            `simulator-operator-picker--${operatorPicker.side}`,
          ]"
          :style="[operatorPickerStyle, slotGridStyle, operatorPickerGridStyle]"
          @mousedown.prevent
          @click.stop
        >
          <div class="simulator-operator-picker-heading">
            <span>{{ ROOM_LABELS[operatorPicker.type] }}</span>
            <span>{{ operatorPickerCandidates.length }}</span>
          </div>
          <div class="simulator-operator-picker-body">
            <div
              v-if="operatorPickerCandidates.length"
              class="simulator-operator-picker-list"
            >
              <button
                v-for="candidate in operatorPickerCandidates"
                :key="candidate.operator.id"
                :aria-label="`选择${candidate.operator.name}`"
                :title="candidate.operator.name"
                class="simulator-operator-picker-item"
                type="button"
                @click="selectOperatorPickerCandidate(candidate.operator)"
                @mousedown.prevent
              >
                <OperatorAvatarDisplay
                  :data-source="selectedDataSource"
                  :display-name="candidate.operator.name"
                  :elite-level="
                    operatorElite(
                      operatorPickerRoom,
                      candidate.operator.name,
                      operatorPicker.type,
                    )
                  "
                  :operator="candidate.operator"
                  :operator-owned="
                    operatorOwned(operatorPickerRoom, candidate.operator.name)
                  "
                  :missing="
                    operatorMissing(operatorPickerRoom, candidate.operator.name)
                  "
                  :mood-scattered="
                    operatorMoodScattered(
                      operatorPickerRoom,
                      candidate.operator.name,
                    )
                  "
                  :operator-training-upgraded="
                    operatorTrainingUpgraded(
                      operatorPickerRoom,
                      candidate.operator.name,
                      operatorPicker.type,
                    )
                  "
                  :plain="true"
                  :proportional-layout="true"
                  :show-elite-level="true"
                  :show-name="true"
                  :show-profession="true"
                  :show-rarity="true"
                  :size="simulatorSlotSize"
                />
              </button>
            </div>
            <a-empty
              v-else
              :image="undefined"
              class="simulator-operator-picker-empty"
              description="无匹配干员"
            />
            <div class="simulator-operator-picker-profession-filter">
              <a-button
                :type="
                  !selectedOperatorPickerProfession ? 'primary' : 'default'
                "
                size="small"
                @click="selectedOperatorPickerProfession = ''"
                @mousedown.prevent
              >
                全部
              </a-button>
              <a-button
                v-for="profession in operatorPickerProfessionOptions"
                :key="profession"
                :type="
                  selectedOperatorPickerProfession === profession
                    ? 'primary'
                    : 'default'
                "
                size="small"
                @click="selectedOperatorPickerProfession = profession"
                @mousedown.prevent
              >
                {{ profession }}
              </a-button>
            </div>
          </div>
        </div>

        <div
          v-if="contextMenu"
          ref="contextMenuElement"
          :class="[
            'simulator-context-menu',
            { 'simulator-context-menu--flat': contextMenuIsFlat },
          ]"
          :style="contextMenuStyle()"
          @click="closeContextMenu"
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

        <div
          v-if="efficiencySupported"
          class="simulator-efficiency-settings-entry"
        >
          <a-button @click="efficiencySettingsModalOpen = true">
            <template #icon><SettingOutlined /></template>
            计算设置
          </a-button>
        </div>

        <a-modal
          v-model:open="efficiencySettingsModalOpen"
          :footer="null"
          title="计算设置"
        >
          <a-form layout="vertical">
            <a-form-item label="会客室">
              <a-checkbox
                :checked="currentEfficiencySettings.clueExchanging"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    updateEfficiencyBooleanSetting(
                      'clueExchanging',
                      event.target.checked,
                    )
                "
              >
                线索交流
              </a-checkbox>
            </a-form-item>
            <a-form-item label="宿舍">
              <a-checkbox
                :checked="currentEfficiencySettings.dormFullTreat"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    updateEfficiencyBooleanSetting(
                      'dormFullTreat',
                      event.target.checked,
                    )
                "
              >
                按满员计算
              </a-checkbox>
            </a-form-item>
            <a-form-item label="容量">
              <a-checkbox
                :checked="currentEfficiencySettings.simulateOverflow"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    updateEfficiencyOverflowSetting(event.target.checked)
                "
              >
                模拟爆仓
              </a-checkbox>
            </a-form-item>
            <a-form-item label="首件进度">
              <a-input-number
                :max="100"
                :min="0"
                :step="1"
                :value="currentEfficiencySettings.firstItemProgress"
                addon-after="%"
                @update:value="updateEfficiencyFirstItemProgress"
              />
            </a-form-item>
          </a-form>
        </a-modal>

        <div v-if="simulatorNotices.length" class="simulator-notice-list">
          <a-alert
            v-for="notice in simulatorNotices"
            :key="notice.code"
            :closable="notice.closable === true"
            :message="notice.message"
            show-icon
            :type="notice.level"
            @close="closeSimulatorNotice(notice)"
          >
            <template v-if="notice.details.length" #description>
              <div class="simulator-anomaly-list">
                <span
                  v-for="(detail, detailIndex) in notice.details"
                  :key="`${notice.code}-${detailIndex}`"
                >
                  {{ detail }}
                </span>
              </div>
            </template>
          </a-alert>
        </div>

        <a-card
          v-if="efficiencySupported && !efficiencyError"
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
                    productionLabel(production.product)
                  }}</span>
                  <span
                    v-if="production.cluePreferences?.length"
                    class="simulator-daily-output-rate"
                  >
                    {{ cluePreferenceText(production.cluePreferences) }}
                  </span>
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
                  <template v-if="production.conversion">
                    <span class="simulator-daily-output-rate">
                      折算{{ production.conversion.label }}
                    </span>
                    <strong>
                      {{
                        formatProduction(
                          convertedProductionAmount(
                            production,
                            production.amountPerDay,
                          ),
                        )
                      }}
                      / 天
                    </strong>
                  </template>
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

            <div
              v-if="plansWithBasePoints.length"
              class="simulator-base-point-results"
            >
              <div class="simulator-result-section-heading">
                <div>
                  <span class="simulator-eyebrow">BASE POINTS</span>
                  <h3>基地点数</h3>
                </div>
                <span class="simulator-result-hint"
                  >来源点数保留，派生点数按比例追加</span
                >
              </div>
              <a-collapse ghost>
                <a-collapse-panel
                  v-for="entry in plansWithBasePoints"
                  :key="`base-points-${entry.planIndex}`"
                >
                  <template #header>
                    <div class="simulator-step-header">
                      <span>
                        {{ entry.plan.name }}
                        <small
                          >·
                          {{ formatNumber(entry.plan.durationHours) }}
                          小时</small
                        >
                      </span>
                    </div>
                  </template>
                  <div class="simulator-step-content">
                    <div class="simulator-base-point-grid">
                      <div
                        v-for="point in displayedBasePointDetails(entry.plan)"
                        :key="point.term"
                        class="simulator-base-point-item"
                      >
                        <div class="simulator-base-point-value">
                          <span>{{ basePointLabel(point.term) }}</span>
                          <strong>{{ formatNumber(point.value) }}</strong>
                        </div>
                        <div class="simulator-base-point-sources">
                          <span class="simulator-base-point-source-title"
                            >来源</span
                          >
                          <div
                            v-for="(source, sourceIndex) in point.sources"
                            :key="`${point.term}-${source.operator}-${source.skill ?? 'skill'}-${source.kind}-${sourceIndex}`"
                            class="simulator-base-point-source"
                          >
                            <span>{{ basePointSourceText(source) }}</span>
                            <strong>+{{ formatNumber(source.value) }}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </a-collapse-panel>
              </a-collapse>
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
                  :key="`${result.planIndex}-${result.facility?.facility.id ?? 'control-mood'}-${resultIndex}`"
                >
                  <template #header>
                    <div class="simulator-step-header">
                      <span>
                        {{ result.plan.name }} ·
                        {{
                          result.facility
                            ? facilityResultLabel(result.facility)
                            : ROOM_LABELS.control
                        }}
                        <small
                          v-if="
                            result.facility &&
                            inheritedSourceLabel(result.facility)
                          "
                        >
                          · {{ inheritedSourceLabel(result.facility) }}
                        </small>
                      </span>
                      <strong v-if="result.facility"
                        >{{ formatNumber(result.facility.efficiency) }}%</strong
                      >
                    </div>
                  </template>
                  <div v-if="result.facility" class="simulator-step-content">
                    <div class="simulator-step-formula">
                      基础 {{ formatNumber(result.facility.baseEfficiency) }} +
                      心情 {{ formatNumber(result.facility.moodEfficiency) }} +
                      干员技能
                      {{
                        formatNumber(result.facility.operatorSkillEfficiency)
                      }}
                      + 设施技能
                      {{
                        formatNumber(result.facility.facilitySkillEfficiency)
                      }}
                      =
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
                      <span>干员技能效率</span>
                      <strong>{{
                        signedNumber(result.facility.operatorSkillEfficiency)
                      }}</strong>
                      <span>设施技能效率</span>
                      <strong>{{
                        signedNumber(result.facility.facilitySkillEfficiency)
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
                            productionLabel(result.facility.production.product)
                          }}</strong>
                          <template
                            v-if="
                              result.facility.production.cluePreferences?.length
                            "
                          >
                            <span>线索倾向</span>
                            <strong>{{
                              cluePreferenceText(
                                result.facility.production.cluePreferences,
                              )
                            }}</strong>
                          </template>
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
                          <template
                            v-if="result.facility.production.conversion"
                          >
                            <span>单位折算</span>
                            <strong>
                              {{
                                result.facility.production.conversion
                                  .amountPerUnit
                              }}
                              {{
                                result.facility.production.conversion.label
                              }}/{{
                                result.facility.production.conversion.sourceUnit
                              }}
                            </strong>
                            <span>基础周期</span>
                            <strong>
                              {{
                                result.facility.production.conversion
                                  .baseCycleHours
                              }}
                              小时/{{
                                result.facility.production.conversion.sourceUnit
                              }}
                            </strong>
                            <span>折算实际速率</span>
                            <strong>
                              {{
                                formatProduction(
                                  convertedProductionAmount(
                                    result.facility.production,
                                    result.facility.production.amountPerHour,
                                  ),
                                )
                              }}/小时
                            </strong>
                          </template>
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
                        <div class="simulator-detail-main">
                          <span
                            >{{ detail.operator
                            }}<template v-if="detail.skill">
                              · {{ detail.skill }}</template
                            ></span
                          >
                          <div
                            v-if="operatorCalculationLines(detail).length"
                            class="simulator-detail-calculation simulator-step-formula"
                          >
                            <div
                              v-for="(
                                line, lineIndex
                              ) in operatorCalculationLines(detail)"
                              :key="`${detailIndex}-${lineIndex}`"
                            >
                              {{ line }}
                            </div>
                          </div>
                        </div>
                        <span
                          >{{ efficiencyStatLabel(detail.stat) }}
                          {{ signedNumber(detail.value) }}</span
                        >
                      </div>
                    </div>
                    <a-empty
                      v-if="
                        !result.facility.details.length && !result.moods.length
                      "
                      :image="undefined"
                      class="simulator-step-empty"
                      description="当前设施没有可展开的技能明细"
                    />
                    <div
                      v-if="result.moods.length"
                      class="simulator-mood-calculation-list"
                    >
                      <span class="simulator-step-subheading"
                        >干员心情消耗步骤</span
                      >
                      <div
                        v-for="mood in result.moods"
                        :key="`${mood.facilityId}-${mood.slotIndex}-${mood.operator}`"
                        class="simulator-mood-calculation"
                      >
                        <div class="simulator-mood-calculation-header">
                          <span>{{ mood.operator }}</span>
                          <strong>剩余 {{ formatNumber(mood.end) }}</strong>
                        </div>
                        <div class="simulator-mood-rate-steps">
                          <div
                            v-for="(detail, detailIndex) in mood.rateDetails"
                            :key="`${mood.operator}-${detail.kind}-${detailIndex}`"
                            class="simulator-mood-rate-step"
                          >
                            <span>{{ moodRateDetailLabel(detail) }}</span>
                            <strong
                              >{{ signedNumber(detail.value) }}/小时</strong
                            >
                          </div>
                          <div class="simulator-mood-rate-step">
                            <span>消耗速度</span>
                            <strong>{{ moodRateFormula(mood) }}</strong>
                          </div>
                        </div>
                        <div class="simulator-step-formula">
                          {{ formatNumber(mood.start) }} -
                          {{ formatNumber(mood.costRate) }} ×
                          {{ formatNumber(result.plan.durationHours) }} =
                          <strong>{{ formatNumber(mood.end) }}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="simulator-step-content">
                    <div
                      v-if="result.moods.length"
                      class="simulator-mood-calculation-list"
                    >
                      <span class="simulator-step-subheading"
                        >干员心情消耗步骤</span
                      >
                      <div
                        v-for="mood in result.moods"
                        :key="`${mood.facilityId}-${mood.slotIndex}-${mood.operator}`"
                        class="simulator-mood-calculation"
                      >
                        <div class="simulator-mood-calculation-header">
                          <span>{{ mood.operator }}</span>
                          <strong>剩余 {{ formatNumber(mood.end) }}</strong>
                        </div>
                        <div class="simulator-mood-rate-steps">
                          <div
                            v-for="(detail, detailIndex) in mood.rateDetails"
                            :key="`${mood.operator}-${detail.kind}-${detailIndex}`"
                            class="simulator-mood-rate-step"
                          >
                            <span>{{ moodRateDetailLabel(detail) }}</span>
                            <strong
                              >{{ signedNumber(detail.value) }}/小时</strong
                            >
                          </div>
                          <div class="simulator-mood-rate-step">
                            <span>消耗速度</span>
                            <strong>{{ moodRateFormula(mood) }}</strong>
                          </div>
                        </div>
                        <div class="simulator-step-formula">
                          {{ formatNumber(mood.start) }} -
                          {{ formatNumber(mood.costRate) }} ×
                          {{ formatNumber(result.plan.durationHours) }} =
                          <strong>{{ formatNumber(mood.end) }}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </a-collapse-panel>
              </a-collapse>
            </div>
          </template>
        </a-card>
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
