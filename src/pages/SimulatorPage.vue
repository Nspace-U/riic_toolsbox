<script setup lang="ts">
import "@/pages/styles/simulator-overlays.css";

import {
  CheckOutlined,
  ClusterOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
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
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { useBasePointDisplaySettings } from "@/composables/useBasePointDisplaySettings";
import { useCalculationStepDisplaySettings } from "@/composables/useCalculationStepDisplaySettings";
import { useDroneStrategySettings } from "@/composables/useDroneStrategySettings";
import { useEfficiencyNoticeDisplaySettings } from "@/composables/useEfficiencyNoticeDisplaySettings";
import { useFacilityCardSettings } from "@/composables/useFacilityCardSettings";
import {
  isProductColorKey,
  useFacilityColors,
} from "@/composables/useFacilityColors";
import { useScheduleDocuments } from "@/composables/useScheduleDocuments";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import { useOperatorPickerSettings } from "@/composables/useOperatorPickerSettings";
import { useResultResourceDisplaySettings } from "@/composables/useResultResourceDisplaySettings";
import { useSanitySettings } from "@/composables/useSanitySettings";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import type { OperatorPickerCandidateView } from "@/components/OperatorPickerPanel.vue";
import ScheduleLayoutEditor from "@/components/ScheduleLayoutEditor.vue";
import ScheduleOperatorPicker from "@/components/ScheduleOperatorPicker.vue";
import ScheduleOperatorSlotContent from "@/components/ScheduleOperatorSlotContent.vue";
import SimulatorDisplayCard from "@/components/SimulatorDisplayCard.vue";
import SimulatorDisplayTile from "@/components/SimulatorDisplayTile.vue";
import SimulatorDisplayValue from "@/components/SimulatorDisplayValue.vue";
import SimulatorNumericValue from "@/components/SimulatorNumericValue.vue";
import { DEFAULT_SCHEDULE_ADAPTER, parseScheduleImport } from "@/adapters";
import { serializeMaaSchedule } from "@/adapters/maaSchedule";
import {
  buildRecycleRules,
  getRiicEfficiencyCatalog,
  getRiicEfficiencyTerms,
} from "@/adapters/riicEfficiencyData";
import type { EliteLevel, Operator } from "@/types/baseData";
import type {
  EfficiencyCatalog,
  EfficiencyNotice,
  EfficiencyResult,
  FacilityEfficiencyResult,
  OperatorProgressionNode,
  ResolvedOperatorProgression,
  DroneAccelerationResult,
  BasePointSource,
  DisplayCard,
  DisplayPane,
  DisplayTile,
  ResultDisplay,
} from "@arknights/riic-efficiency";
import type {
  LayoutEntry,
  OperatorState,
  Plan,
  ParsedSchedule,
  RoomAssignment,
  RoomKey,
  FiammettaMode,
  ScheduleDocument,
  StoredDocument,
  PlanDrones,
} from "@/types/schedule";
import {
  baseAmountsWithoutMaaDrones,
  calculateDroneAcceleration,
  buildDailySanityAmounts,
  buildFacilityStepCards,
  buildFacilityStepPanes,
  buildResultDisplay,
  calculateEfficiency,
  analyzeSchedulePeriods,
  buildEfficiencyNotices,
  buildImportedExtraRoomsNotice,
  schedulePeriodForRange,
  schedulePeriodMinute,
  createSpecialOperatorAvatarLabelResolver,
  RECYCLE_OUTPUT_PRODUCT,
  facilityId,
  importPowerSummary,
  nodesForOperator,
  progressionNodesForFacility,
  resolveOperatorProgression,
  resizeImportedRooms,
  formatBasePointLabel,
  formatBasePointSource,
  formatFacilityResultLabel,
} from "@arknights/riic-efficiency";
import {
  DEFAULT_SOURCE_MATERIAL,
  createDefaultRoomAssignment,
  PRODUCT_OPTIONS,
  PRODUCT_REPRESENTATIVE_COLORS,
  ROOM_LABELS,
  ROOM_ORDER,
  ROOM_DISPLAY_ORDER,
  ROOM_REPRESENTATIVE_COLORS,
  SOURCE_MATERIAL_OPTIONS,
  canonicalResourceKey,
  cloneSchedule,
  facilityPower,
  facilityProductIconFile,
  formatDuplicateOperatorWarnings,
  automaticScheduleTags,
  isFixedLevelRoom,
  parseLayoutText,
  roomSlotCount,
  roomLevelRange,
  resourceItemIconFile,
  resolveRoomAssignment,
  scheduleTags,
  validateSchedule,
} from "@/utils/schedule";
import {
  parseScheduleBackup,
  serializeScheduleBackup,
} from "@/utils/scheduleBackup";
import {
  getOperatorAvatarNameFontSize,
  getOperatorAvatarNameMinBandMetrics,
  getOperatorAvatarSkippedLabelFontSize,
  OPERATOR_AVATAR_SOURCE_WIDTH,
} from "@/utils/operatorAvatarLayout";
import { sortProfessionValues } from "@/utils/operatorOrdering";
import { type SanityResourceAmounts } from "@/utils/sanity";
import {
  TORAPPU_SANITY_ICON_FILE,
  torappuItemIconPath,
} from "@/utils/torappuItems";
import {
  cascadeLayoutTypes,
  layoutAdditionPlan,
  layoutEntryLevelMax,
  layoutTextFor,
  layoutWouldRemoveOperators,
  layoutWithBuildChain,
  resizeRoomsForLayout,
  roomsForLayout,
  validateAddedLayout,
  type LayoutPreset,
} from "@/utils/simulator/layout";
import {
  estimateTextEm,
  facilityTitleStyle as facilityTitleStyleForWidth,
} from "@/utils/simulator/facilityTitle";
import {
  formatDurationHours,
  formatEfficiencyNumber,
  planDurationHoursValue,
} from "@/utils/simulator/presentation";
import { operatorPasteAssignments } from "@/utils/simulator/operatorClipboard";
import {
  scheduleOperatorPickerPlacement,
  useScheduleOperatorInteraction,
  type ScheduleOperatorNavigation,
} from "@/composables/useScheduleOperatorInteraction";
import {
  prepareScheduleImage,
  renderPreparedScheduleImage,
  SCHEDULE_IMAGE_RESOLUTIONS,
  type PreparedScheduleImage,
  type ScheduleImageResolutionKey,
} from "@/utils/simulator/exportImage";

const props = defineProps<{
  initialDocumentId?: string;
  previewOnly?: boolean;
}>();

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
  isFiammetta?: boolean;
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

interface FacilityContextMenuState extends OperatorSlotAddress {
  scope: "operator" | "queue" | "facility";
  positions: number[];
  x: number;
  y: number;
}

interface ScheduleDocumentContextMenuState {
  documentId: string;
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

interface PowerSummary {
  used: number;
  provided: number;
  net: number;
}

interface ImportDraftState {
  parsed: ParsedSchedule;
  fileName: string;
  layout: LayoutEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SimulatorEditSetting = "layout" | "queue";

interface SimulatorEditSettings {
  layout: boolean;
  queue: boolean;
}

interface TimedQueueDraft {
  start: string;
  end: string;
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

interface OperatorClipboardAddress extends OperatorSlotAddress {
  facilityKey: string;
  facilitySlotIndex?: number;
}

interface OperatorClipboard {
  mode: "copy" | "cut";
  entries: OperatorClipboardEntry[];
  sourceDocumentId: string;
  sourceAddresses: OperatorClipboardAddress[];
}

interface OperatorSlotSnapshot {
  name: string;
  state?: OperatorState;
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
};

const {
  documents,
  activeDocumentId,
  createDocument,
  appendDocuments,
  getActiveDocument,
  setActiveDocument,
  updateDocument,
  removeDocument,
  duplicateDocument,
  reorderDocuments,
} = useScheduleDocuments();
const {
  operators,
  itemTable,
  buildingData,
  ready: baseDataReady,
} = useBaseData();
const recycleRules = computed(() =>
  buildRecycleRules(buildingData.value, itemTable.value),
);
const operatorByNameMap = computed(() => {
  const map = new Map<string, Operator>();
  operators.value.forEach((operator) => {
    if (!map.has(operator.name)) {
      map.set(operator.name, operator);
    }
  });
  return map;
});
const specialOperatorAvatarLabelResolver = computed(() =>
  createSpecialOperatorAvatarLabelResolver(getRiicEfficiencyCatalog().terms),
);
const { isBasePointVisible } = useBasePointDisplaySettings();
const { isEfficiencyNoticeVisible } = useEfficiencyNoticeDisplaySettings();
const { calculationStepDisplayMode, showAutomaticRestOperators } =
  useCalculationStepDisplaySettings();
const { resultResourceDisplayMode } = useResultResourceDisplaySettings();
const { facilityCardSettings, facilityCardIconScale } =
  useFacilityCardSettings();
const { facilityColors, productColors, fiammettaColor } = useFacilityColors();
const {
  activeProfile,
  dormitoryDefaultIncludesMoodRecovery,
  showUnownedOperatorsInPicker,
  treatSkillsAsUnlocked,
} = useOperatorProgression();
const { operatorPickerColumns } = useOperatorPickerSettings();
const { sanityValues } = useSanitySettings(itemTable, recycleRules);
const { lmdDroneStrategies, droneOverflowTruncationEnabled } =
  useDroneStrategySettings();

const simulatorSlotSize = 90;

const slotGridStyle = {
  "--simulator-slot-size": `${simulatorSlotSize}px`,
};

const operatorPickerGridStyle = computed(() => ({
  "--simulator-operator-picker-columns": `${operatorPickerColumns.value}`,
}));

const slotNameBandHeight = computed(
  () =>
    getOperatorAvatarNameMinBandMetrics(
      OPERATOR_AVATAR_SOURCE_WIDTH,
      simulatorSlotSize,
    ).height,
);

const slotNameBandStyle = computed(() => ({
  height: `${slotNameBandHeight.value}px`,
  fontSize: `${getOperatorAvatarNameFontSize(simulatorSlotSize)}px`,
  lineHeight: `${slotNameBandHeight.value}px`,
}));

const emptySlotFrameStyle = computed(() => ({
  width: `${simulatorSlotSize}px`,
  height: `${simulatorSlotSize}px`,
}));

const skippedLabelStyle = computed(() => ({
  fontSize: `${getOperatorAvatarSkippedLabelFontSize(simulatorSlotSize)}px`,
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
const importDraft = ref<ImportDraftState>();
const lmdDroneStrategyDraft = ref("");
const deleteScheduleModalOpen = ref(false);
const recycleOutputDetailsOpen = ref(false);
const recycleOutputDays = ref(1);
const recycleOutputGrouping = ref<"rarity" | "material">("rarity");
const pendingDeleteSchedule = ref<{ id: string; title: string }>();
const imageExportModalOpen = ref(false);
const imageExportResolution = ref<ScheduleImageResolutionKey>("1080p");
const imageExportError = ref("");
const imageExportLoading = ref(false);
const imageExportDocumentId = ref("");
const imageExportPrepared = ref<PreparedScheduleImage>();
const imageExportPreviewViewport = ref<HTMLElement>();
const imageExportPreviewMount = ref<HTMLElement>();
const imageExportPreviewWidthMode = ref<"scroll" | "overflow">("scroll");
const imageExportPreviewZoom = ref<number | "auto">("auto");
const imageExportPreviewViewportWidth = ref(0);
const imageExportPreviewContentSize = ref({ width: 1920, height: 1080 });
const imageExportPreviewContentScale = ref(1);
const importedScheduleNotice = ref<EfficiencyNotice>();
const efficiencyCatalog = shallowRef<EfficiencyCatalog>();
const efficiencyLoading = ref(false);
const efficiencyError = ref("");
const draftOperatorNames = ref<Record<string, string>>({});
const documentSidebar = ref<HTMLElement>();
const editingOperatorSlot = ref<OperatorSlotAddress>();
const contextMenu = ref<FacilityContextMenuState>();
const contextMenuElement = ref<HTMLElement>();
const scheduleDocumentContextMenu = ref<ScheduleDocumentContextMenuState>();
const scheduleDocumentContextMenuElement = ref<HTMLElement>();
const operatorPicker = ref<OperatorPickerState>();
const operatorPickerElement = ref<{ panelElement?: HTMLElement }>();
const operatorDragPreviewElement = ref<HTMLElement>();
const operatorGridComponent = ref<ComponentPublicInstance>();
const operatorGridElement = computed<HTMLElement | undefined>(
  () => operatorGridComponent.value?.$el as HTMLElement | undefined,
);
const operatorPickerStyle = ref<Record<string, string>>({});
const facilityOperatorOverrides = ref<Partial<Record<RoomKey, string[]>>>({});
const warnedFacilityOperatorOverrideIds = new Set<string>();
const layoutText = ref("");
const simulatorEditSettings = ref(readSimulatorEditSettings());
const timedQueueDrafts = ref<Record<string, TimedQueueDraft>>({});
const showScheduleSidebar = ref(true);
const scheduleSearchQuery = ref("");
const selectedScheduleTags = ref<string[]>([]);
const scheduleTagInput = ref("");
const draggedDocumentId = ref<string>();
const pendingDocumentDrag = ref<{
  documentId: string;
  pointerId: number;
  startX: number;
  startY: number;
  element: HTMLElement;
}>();
const dragOverDocumentId = ref<string>();
const dragOverDocumentPosition = ref<"before" | "after">();
let suppressNextDocumentClick = false;
let operatorDragTarget: OperatorSlotAddress | undefined;
let operatorDragHoveredSlotKey: string | undefined;
const operatorClipboard = ref<OperatorClipboard>();
const scheduleHistory = new Map<string, ScheduleHistory>();
const layoutTextHint =
  "修改数字后自动应用；每位数字代表一间设施等级。第 1 行依次填写贸易站、制造站；推算发电站为 0 到 3 间时自动补建，超过 3 间时不建造，贸易站与制造站总数不能超过 9 间。第 2 行前 5 位依次为会客室、加工站、办公室、训练室、回收站；宿舍与其用空格分隔，0 表示不建造";
let layoutApplyTimer: ReturnType<typeof setTimeout> | undefined;
let pendingOperatorSelection:
  | {
      key: string;
      wasEditing: boolean;
      shouldSwitchPicker: boolean;
    }
  | undefined;
let documentSidebarMeasureFrame: number | undefined;
let documentSidebarResizeObserver: ResizeObserver | undefined;
let imageExportPreviewResizeObserver: ResizeObserver | undefined;
let imageExportRequestVersion = 0;

const MAX_SCHEDULE_HISTORY = 100;

const INITIAL_MOOD_OPTIONS = [0, 12, 24] as const;
const FIAMMETTA_POSITION = -1;

const operatorInteraction = useScheduleOperatorInteraction<OperatorSlotAddress>(
  {
    root: operatorGridElement,
    slotSelector: ".simulator-facility-grid .simulator-slot[data-key]",
    slotSurfaceSelector: ".simulator-slot",
    getAddresses: orderedOperatorSlotAddresses,
    getAddressFromTarget: operatorAddressFromTarget,
    getAddressByKey: operatorAddressByKey,
    getAddressAtPoint: operatorAddressAtPoint,
    getName(address) {
      const document = currentDocument.value;
      return document ? operatorNameAtAddress(document, address) : "";
    },
    getSelectionRange(anchor, target) {
      const anchorIndex = operatorFacilitySlotIndex(anchor);
      const targetIndex = operatorFacilitySlotIndex(target);
      if (
        operatorFacilityKeyForAddress(anchor) !==
          operatorFacilityKeyForAddress(target) ||
        anchorIndex === undefined ||
        targetIndex === undefined
      ) {
        return undefined;
      }
      const startPlanIndex = Math.min(anchor.planIndex, target.planIndex);
      const endPlanIndex = Math.max(anchor.planIndex, target.planIndex);
      const startSlotIndex = Math.min(anchorIndex, targetIndex);
      const endSlotIndex = Math.max(anchorIndex, targetIndex);
      return operatorFacilitySlotAddresses(target.type, target.position).filter(
        (address) => {
          const slotIndex = operatorFacilitySlotIndex(address);
          return (
            slotIndex !== undefined &&
            address.planIndex >= startPlanIndex &&
            address.planIndex <= endPlanIndex &&
            slotIndex >= startSlotIndex &&
            slotIndex <= endSlotIndex
          );
        },
      );
    },
    getSelectAllAddresses: operatorSelectAllAddresses,
    maxSelectAllStage: 2,
    boxSelectionUsesDocument: true,
    commitEdit: commitPendingOperatorNameEdit,
    shouldStartPointer(event) {
      return Boolean(operatorGridPointerTarget(event.target));
    },
    beforePointerDown() {
      return commitPendingOperatorNameEdit();
    },
    onSelect(_event, address) {
      const context = pendingOperatorSelection;
      pendingOperatorSelection = undefined;
      if (!context || context.key !== address.key) return;
      if (context.shouldSwitchPicker)
        beginOperatorNameEdit(
          address.planIndex,
          address.type,
          address.position,
          address.slotIndex,
          undefined,
          true,
        );
      if (!context.wasEditing) focusSelectedOperatorNameInput();
    },
    onDrop: dropOperatorAddresses,
    onDragTarget: setOperatorDragTarget,
    onDragMove(x, y, started) {
      if (started) {
        const previousHoveredSlot = hoveredOperatorSlot.value;
        hoveredOperatorSlot.value = undefined;
        setOperatorDragHoveredSlot(previousHoveredSlot);
        void nextTick(() => updateOperatorDragPreviewPosition(x, y));
      }
      updateOperatorDragPreviewPosition(x, y);
    },
    onDragEnd(cancelled) {
      const finalHoveredSlot = operatorDragHoveredSlotKey
        ? operatorAddressByKey(operatorDragHoveredSlotKey)
        : undefined;
      setOperatorDragHoveredSlot(undefined);
      hoveredOperatorSlot.value = finalHoveredSlot;
      if (cancelled) setOperatorDragTarget(undefined);
    },
    onCopy: copyOperators,
    onCut: cutOperators,
    onPaste: pasteOperators,
    canPaste: operatorClipboardIsUsable,
    onDelete: deleteOperators,
    canDelete() {
      return operatorDeletionTargets().length > 0;
    },
    onUndo() {
      restoreScheduleHistory("undo");
    },
    onRedo() {
      restoreScheduleHistory("redo");
    },
    onNavigate: navigateOperatorSlot,
    onEscape(input) {
      if (
        input &&
        !input.classList.contains("simulator-slot-name-input--pending")
      ) {
        cancelOperatorNameEdit();
        closeContextMenu();
        return;
      }
      clearOperatorClipboard();
      closeOperatorPicker();
      closeContextMenu();
    },
    onStartCharacter(address, character) {
      beginOperatorNameEdit(
        address.planIndex,
        address.type,
        address.position,
        address.slotIndex,
        character,
      );
    },
    pickerIsOpen() {
      return Boolean(operatorPicker.value);
    },
  },
);

const selectedOperatorSlots = operatorInteraction.selectedKeys;
const operatorSelectionAnchor = operatorInteraction.selectionAnchor;
const hoveredOperatorSlot = operatorInteraction.hoveredAddress;
const operatorPointerInteraction = operatorInteraction.pointerInteraction;
const suppressNextOperatorClick = operatorInteraction.suppressNextClick;
const operatorPasteHighlightKeys = operatorInteraction.pasteHighlightKeys;
const handleOperatorGridPointerDown = operatorInteraction.handlePointerDown;
const handleOperatorGridPointerMove = operatorInteraction.handlePointerMove;
const handleOperatorGridPointerUp = operatorInteraction.handlePointerUp;
const handleOperatorGridPointerCancel = operatorInteraction.handlePointerCancel;
const handleWindowSelectStart = operatorInteraction.handleSelectStart;
const handleWindowKeydown = operatorInteraction.handleKeydown;

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
      operator?: Operator;
      specialLabel?: string;
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
    const name = plan ? operatorNameAtAddress(document, address) : "";
    const operator = operatorByName(name);
    const specialLabel = specialOperatorAvatarLabelResolver.value(name);
    if (!plan || !name || (!operator && !specialLabel)) {
      return [];
    }
    return [
      {
        count: 0,
        name,
        operator,
        specialLabel,
        room: operatorRoomAtDocument(document, address, false),
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
const currentScheduleTags = computed(() => {
  const stored = activeDocument.value;
  return stored
    ? scheduleTags(stored.document, stored.tags, stored.hiddenAutoTags)
    : [];
});
const documentTags = computed(() =>
  documents.value.map((stored) => ({
    stored,
    tags: scheduleTags(stored.document, stored.tags, stored.hiddenAutoTags),
  })),
);
const scheduleTagGroups = computed(() => {
  const tags = new Map<string, "layout" | "right" | "queue" | "custom">();
  for (const { stored, tags: documentTagList } of documentTags.value) {
    for (const tag of documentTagList) {
      const group = tag.automatic
        ? tag.label === "右满" || tag.label === "右不满"
          ? "right"
          : tag.label === `${stored.document.plans.length}队列`
            ? "queue"
            : "layout"
        : "custom";
      if (
        !tags.has(tag.label) ||
        (tags.get(tag.label) === "custom" && tag.automatic)
      ) {
        tags.set(tag.label, group);
      }
    }
  }
  return (["layout", "right", "queue", "custom"] as const)
    .map((group) => ({
      group,
      tags: Array.from(tags, ([label, category]) => ({
        label,
        category,
      })).filter((tag) => tag.category === group),
    }))
    .filter(({ tags: groupTags }) => groupTags.length > 0);
});
const availableScheduleTags = computed(() =>
  scheduleTagGroups.value.flatMap(({ tags }) => tags.map((tag) => tag.label)),
);
const filteredDocuments = computed(() => {
  const query = scheduleSearchQuery.value.trim().toLowerCase();
  return documentTags.value
    .filter(({ stored, tags }) => {
      const title = stored.document.title?.trim().toLowerCase() ?? "";
      return (
        (title.includes(query) ||
          tags.some((tag) => tag.label.toLowerCase().includes(query))) &&
        selectedScheduleTags.value.every((selected) =>
          tags.some((tag) => tag.label === selected),
        )
      );
    })
    .map(({ stored }) => stored);
});
const operatorAddressMap = computed(
  () =>
    new Map(
      orderedOperatorSlotAddresses().map((address) => [address.key, address]),
    ),
);
const operatorClipboardSourceKeys = computed(() => {
  const clipboard = operatorClipboard.value;
  if (
    !clipboard ||
    clipboard.sourceDocumentId !== activeDocumentId.value ||
    clipboard.sourceAddresses.length === 0
  ) {
    return new Set<string>();
  }
  return new Set(
    clipboard.sourceAddresses
      .filter((address) => operatorAddressMap.value.has(address.key))
      .map((address) => address.key),
  );
});
const currentSimulatorEditSettings = computed<SimulatorEditSettings>(() => {
  const documentId = activeDocumentId.value;
  return documentId
    ? (simulatorEditSettings.value[documentId] ??
        DEFAULT_SIMULATOR_EDIT_SETTINGS)
    : DEFAULT_SIMULATOR_EDIT_SETTINGS;
});

const currentTimedQueueEnabled = computed(() =>
  Boolean(
    currentDocument.value?.plans.some((plan) => plan.period !== undefined),
  ),
);

function timedQueueDraftKey(planIndex: number): string {
  return `${activeDocumentId.value}:${planIndex}`;
}

function timedQueueDraftFor(plan: Plan, planIndex: number): TimedQueueDraft {
  const draft = timedQueueDrafts.value[timedQueueDraftKey(planIndex)];
  if (draft) {
    return draft;
  }
  const period = plan.period;
  if (!period?.length) {
    return { start: "", end: "" };
  }
  return {
    start: period[0]?.[0] ?? "",
    end: period.length > 1 ? (period[1]?.[1] ?? "") : (period[0]?.[1] ?? ""),
  };
}

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

const importPowerPreview = computed<PowerSummary>(() =>
  importPowerSummary(importDraft.value?.layout ?? []),
);

function importedLayoutEntries(
  layout: LayoutEntry[],
  type: RoomKey,
): LayoutEntry[] {
  return layout.filter((entry) => entry.type === type);
}

function importedOperatorLosses(draft: ImportDraftState): string[] {
  const details: string[] = [];
  draft.parsed.document.plans.forEach((plan, planIndex) => {
    ROOM_DISPLAY_ORDER.forEach((type) => {
      const entries = importedLayoutEntries(draft.layout, type);
      const rooms = plan.rooms[type];
      if (!Array.isArray(rooms)) {
        return;
      }
      rooms.slice(entries.length).forEach((room) => {
        if (!isRecord(room)) {
          return;
        }
        const operators = Array.isArray(room.operators)
          ? room.operators.filter(Boolean)
          : [];
        if (operators.length > 0) {
          details.push(
            `${plan.name || `队列${planIndex + 1}`} · ${ROOM_LABELS[type]}：${operators.join("、")}`,
          );
        }
      });
      entries.forEach((entry, roomIndex) => {
        const room = rooms[roomIndex];
        if (!isRecord(room) || !Array.isArray(room.operators)) {
          return;
        }
        const capacity = roomSlotCount(type, entry.level);
        const operators = room.operators.slice(capacity).filter(Boolean);
        if (operators.length > 0) {
          details.push(
            `${plan.name || `队列${planIndex + 1}`} · ${ROOM_LABELS[type]} ${roomIndex + 1}：${operators.join("、")}`,
          );
        }
      });
    });
  });
  if ((draft.parsed.document.importFiammetta as boolean | undefined) === true) {
    const dormEntries = importedLayoutEntries(draft.layout, "dormitory");
    draft.parsed.document.plans.forEach((plan, planIndex) => {
      const lastRoom = Array.isArray(plan.rooms.dormitory)
        ? (plan.rooms.dormitory.at(-1) as RoomAssignment | undefined)
        : undefined;
      const lastEntry = dormEntries.at(-1);
      if (!lastEntry || !lastRoom) {
        details.push(
          `${plan.name || `队列${planIndex + 1}`}：没有可放置菲亚梅塔的最后一间宿舍`,
        );
        return;
      }
      const capacity = roomSlotCount("dormitory", lastEntry.level);
      if (
        lastRoom.operators?.[capacity - 1] &&
        lastRoom.operators[capacity - 1] !== "菲亚梅塔"
      ) {
        details.push(
          `${plan.name || `队列${planIndex + 1}`}：最后一间宿舍最后一个槽位已有干员`,
        );
      }
    });
  }
  return details;
}

const importLossWarnings = computed(() =>
  importDraft.value ? importedOperatorLosses(importDraft.value) : [],
);

function efficiencySchedule(document: ScheduleDocument): ScheduleDocument {
  const droneOverflowMode =
    document.settings?.droneOverflowMode ??
    (droneOverflowTruncationEnabled.value ? "zero" : "continue");
  return {
    ...document,
    settings: {
      ...document.settings,
      ...(activeProfile.value
        ? { progressionProfile: activeProfile.value }
        : {}),
      treatSkillsAsUnlocked: treatSkillsAsUnlocked.value,
      dormitoryDefaultIncludesMoodRecovery:
        dormitoryDefaultIncludesMoodRecovery.value,
      droneOverflowMode,
    },
  };
}

const schedulePeriodAnalysis = computed(() => {
  const document = currentDocument.value;
  return document
    ? analyzeSchedulePeriods(document)
    : { enabled: false, durations: [], errors: [], warnings: [] };
});

const efficiencyResult = computed<EfficiencyResult | undefined>(() => {
  const document = currentDocument.value;
  const catalog = efficiencyCatalog.value;
  if (!document || !catalog || schedulePeriodAnalysis.value.errors.length > 0) {
    return undefined;
  }
  return calculateEfficiency(efficiencySchedule(document), {
    catalog,
    ruleset: catalog.ruleset,
  });
});

const efficiencyNotices = computed<EfficiencyNotice[]>(() =>
  buildEfficiencyNotices({
    catalog: efficiencyCatalog.value,
    document: currentDocument.value,
    result: efficiencyResult.value,
    efficiencyError: efficiencyError.value,
  }),
);

const recycleBoostOptions = computed(() => {
  const materialValues = sanityValues.value.materials ?? {};
  return (recycleRules.value?.inputItems ?? [])
    .map((item, sourceIndex) => ({
      ...item,
      sourceIndex,
      sanity: materialValues[item.name] ?? null,
    }))
    .sort((left, right) => {
      if (left.sanity === null && right.sanity !== null) return 1;
      if (right.sanity === null && left.sanity !== null) return -1;
      if (left.sanity === 0 && right.sanity !== 0) return -1;
      if (right.sanity === 0 && left.sanity !== 0) return 1;
      if (left.sanity !== null && right.sanity !== null) {
        const leftRatio = left.addedTime / left.sanity;
        const rightRatio = right.addedTime / right.sanity;
        if (leftRatio !== rightRatio) return rightRatio - leftRatio;
      }
      return (
        right.addedTime - left.addedTime || left.sourceIndex - right.sourceIndex
      );
    });
});

const recycleBoostSelectOptions = computed(() =>
  recycleBoostOptions.value.map((item) => ({
    value: item.itemId,
    label: item.name,
  })),
);

const recycleOutputItems = computed(
  () => efficiencyResult.value?.recycleOutputs ?? [],
);

interface RecycleOutputDisplayRow {
  key: string;
  label: string;
  amountPerDay: number;
  iconName: string;
}

const RECYCLE_OUTPUT_GROUP_OPTIONS = [
  { label: "按稀有度", value: "rarity" },
  { label: "按材料", value: "material" },
];

const RECYCLE_OUTPUT_RARITIES = [
  { key: "TIER_2", label: "T2", iconName: "固源岩" },
  { key: "TIER_3", label: "T3", iconName: "扭转醇" },
  { key: "TIER_4", label: "T4", iconName: "白马醇" },
  { key: "TIER_5", label: "T5", iconName: "双极纳米片" },
];

const recycleOutputDisplayRows = computed<RecycleOutputDisplayRow[]>(() => {
  if (recycleOutputGrouping.value === "material") {
    return recycleOutputItems.value.map((item) => ({
      key: item.itemId,
      label: item.name,
      amountPerDay: item.amountPerDay,
      iconName: item.name,
    }));
  }

  return RECYCLE_OUTPUT_RARITIES.map(({ key, label, iconName }) => ({
    key,
    label: `${label} 材料`,
    iconName,
    amountPerDay: recycleOutputItems.value.reduce(
      (total, item) =>
        itemTable.value?.items[item.itemId]?.rarity === key
          ? total + item.amountPerDay
          : total,
      0,
    ),
  })).sort((left, right) => right.amountPerDay - left.amountPerDay);
});

const simulatorNotices = computed<EfficiencyNotice[]>(() => {
  const notices = efficiencyNotices.value.filter(
    (notice) =>
      (!efficiencyError.value || notice.code !== "efficiency-data-error") &&
      isEfficiencyNoticeVisible(notice.code),
  );
  if (importedScheduleNotice.value) {
    notices.push(importedScheduleNotice.value);
  }
  return notices;
});

const efficiencySettingsModalOpen = ref(false);
const calculationStepActiveKeys = ref<string[]>([]);
const currentEfficiencySettings = computed(() => {
  const settings = currentDocument.value?.settings;
  const firstItemProgress = settings?.firstItemProgress;
  return {
    clueExchanging: settings?.clueExchanging !== false,
    dormFullTreat: settings?.dormFullTreat !== false,
    simulateOverflow: settings?.overflowMode === "zero",
    simulateDroneOverflow:
      (settings?.droneOverflowMode ??
        (droneOverflowTruncationEnabled.value ? "zero" : "continue")) ===
      "zero",
    fiammettaMode: settings?.fiammettaMode ?? "direct",
    fiammettaDirectCount: Math.max(
      0,
      Math.floor(settings?.fiammettaDirectCount ?? 3),
    ),
    preferMaxJieEfficiency: settings?.preferMaxJieEfficiency !== false,
    recycleBoostItemId: settings?.recycleBoostItemId,
    firstItemProgress:
      typeof firstItemProgress === "number"
        ? Math.max(0, Math.min(100, firstItemProgress * 100))
        : undefined,
  };
});

const dailySanityAmounts = computed<SanityResourceAmounts | undefined>(() => {
  const result = efficiencyResult.value;
  return result && result.dailyHours > 0
    ? buildDailySanityAmounts(result)
    : undefined;
});

function dailyOutputSourceFacility(product: string): RoomKey | undefined {
  if (product === "信用") {
    return "meeting";
  }
  return efficiencyResult.value?.dailyFacilities.find(
    (facility) => facility.production?.product === product,
  )?.facility.type;
}

function displayTileAccent(tile: DisplayTile): string | undefined {
  const productColor = productAccent(tile.product ?? "");
  if (productColor) {
    return productColor;
  }
  const sourceFacility = tile.sourceFacility;
  return sourceFacility
    ? (facilityColors.value[sourceFacility] ??
        ROOM_REPRESENTATIVE_COLORS[sourceFacility])
    : undefined;
}

function displayTileIconUrl(tile: DisplayTile): string | undefined {
  if (tile.key === "daily-sanity-total") {
    return sanityIconUrl();
  }
  return tile.product ? dailyOutputIconUrl(tile.product) : undefined;
}

const lmdDroneFacilityExists = computed(() => {
  const document = currentDocument.value;
  if (!document) {
    return false;
  }
  const tradingPositions = document.layout
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.type === "trading");
  return tradingPositions.some(({ index }) => {
    const position =
      document.layout
        .slice(0, index + 1)
        .filter((entry) => entry.type === "trading").length - 1;
    return document.plans.some(
      (_plan, planIndex) =>
        canonicalResourceKey(
          resolveRoomAssignment(document, planIndex, "trading", position)
            .assignment.product ?? "龙门币",
        ) === "龙门币",
    );
  });
});

const droneAcceleration = computed<DroneAccelerationResult | undefined>(() => {
  const document = currentDocument.value;
  const catalog = efficiencyCatalog.value;
  const result = efficiencyResult.value;
  const amounts = dailySanityAmounts.value;
  if (!document || !catalog || !result || !amounts) {
    return undefined;
  }
  const droneProduction = result.dailyProductions.find(
    (production) => production.product === "无人机",
  );
  const scenarioAmounts = {
    ...baseAmountsWithoutMaaDrones(result, amounts),
    ...(droneProduction ? { 无人机: droneProduction.amountPerDay } : {}),
  };
  return calculateDroneAcceleration(
    efficiencySchedule(document),
    catalog,
    scenarioAmounts,
    {
      efficiencyResult: result,
      lmdDroneStrategies: lmdDroneStrategies.value,
      ruleset: catalog.ruleset,
    },
  );
});

const resultDisplay = computed<ResultDisplay | undefined>(() => {
  const result = efficiencyResult.value;
  if (!result) {
    return undefined;
  }
  const visibleTerms = new Set(
    result.plans.flatMap((plan) =>
      plan.basePointDetails
        .filter((point) => isBasePointVisible(point.term))
        .map((point) => point.term),
    ),
  );
  return buildResultDisplay(result, {
    sanityValues: sanityValues.value,
    showAutomaticRestOperators: showAutomaticRestOperators.value,
    resourceAmountDisplayMode: resultResourceDisplayMode.value,
    dailyAmounts: dailySanityAmounts.value,
    droneAcceleration: droneAcceleration.value,
    ruleset: efficiencyCatalog.value?.ruleset,
    simulateOverflow: currentEfficiencySettings.value.simulateOverflow,
    facilityLabel: (facility) => facilityResultLabel(facility),
    basePointLabel: (term) => basePointLabel(term),
    basePointSource: (source) => basePointSourceText(source),
    visibleBasePointTerms: visibleTerms,
    sourceFacilityForProduct: dailyOutputSourceFacility,
  });
});

const facilityStepPanes = computed<DisplayPane[]>(() => {
  const facilitySteps = resultDisplay.value?.calculationSteps.facilitySteps;
  return calculationStepDisplayMode.value === "facility" && facilitySteps
    ? buildFacilityStepPanes(facilitySteps)
    : [];
});

const facilityStepCards = computed<DisplayCard[]>(() => {
  const facilitySteps = resultDisplay.value?.calculationSteps.facilitySteps;
  return calculationStepDisplayMode.value === "queue" && facilitySteps
    ? buildFacilityStepCards(facilitySteps)
    : [];
});

const droneAccelerationVisible = computed(
  () =>
    lmdDroneFacilityExists.value ||
    (resultDisplay.value?.droneScenarios.length ?? 0) > 0,
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
  const plan = currentDocument.value?.plans[picker.planIndex];
  const currentName = plan
    ? operatorDraftValue(
        plan,
        picker.planIndex,
        picker.type,
        picker.position,
        picker.slotIndex,
      ).trim()
    : "";
  return operators.value
    .map((operator, index) => ({ operator, index }))
    .filter(
      ({ operator }) =>
        (picker.position === FIAMMETTA_POSITION ||
          operatorHasFacilitySkill(operator, picker.type) ||
          overrideIds.has(operator.id)) &&
        (showUnownedOperatorsInPicker.value ||
          operatorOwned(operatorPickerRoom.value, operator.name) ||
          operator.name === currentName) &&
        (!profession || operator.profession === profession) &&
        (!query || operator.name.toLocaleLowerCase().includes(query)),
    )
    .sort(compareOperatorPickerCandidates);
});

const operatorPickerCandidateViews = computed<OperatorPickerCandidateView[]>(
  () => {
    const picker = operatorPicker.value;
    if (!picker) {
      return [];
    }
    return operatorPickerCandidates.value.map(({ operator }) => ({
      operator,
      eliteLevel: operatorElite(
        operatorPickerRoom.value,
        operator.name,
        picker.type,
      ),
      missing: operatorMissing(operatorPickerRoom.value, operator.name),
      moodScattered: operatorMoodScattered(
        operatorPickerRoom.value,
        operator.name,
      ),
      operatorOwned: operatorOwned(operatorPickerRoom.value, operator.name),
      operatorTrainingUpgraded: operatorTrainingUpgraded(
        operatorPickerRoom.value,
        operator.name,
        picker.type,
      ),
    }));
  },
);

function fiammettaMode(document: ScheduleDocument): FiammettaMode {
  return document.settings?.fiammettaMode === "queue" ? "queue" : "direct";
}

function fiammettaRoomAtDocument(
  document: ScheduleDocument,
  planIndex: number,
  ensure: boolean,
): RoomAssignment | undefined {
  const mode = fiammettaMode(document);
  if (!document.fiammetta) {
    if (!ensure) {
      return undefined;
    }
    document.fiammetta = {};
  }
  if (mode === "direct") {
    if (planIndex !== 0) {
      return undefined;
    }
    if (!document.fiammetta.direct && ensure) {
      document.fiammetta.direct = {};
    }
    return document.fiammetta.direct;
  }
  if (!document.fiammetta.queue && ensure) {
    document.fiammetta.queue = [];
  }
  const queue = document.fiammetta.queue;
  if (!queue) {
    return undefined;
  }
  if (ensure) {
    while (queue.length < document.plans.length) {
      queue.push({});
    }
  }
  return queue[planIndex];
}

function fiammettaSlotCount(document: ScheduleDocument): number {
  const mode = fiammettaMode(document);
  if (mode === "queue") {
    return 1;
  }
  const configured = document.settings?.fiammettaDirectCount ?? 3;
  const existing =
    fiammettaRoomAtDocument(document, 0, false)?.operators?.length ?? 0;
  return Math.max(0, configured, existing);
}

const facilityRows = computed<FacilityRow[]>(() => {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }

  const rows: FacilityRow[] = [];
  ROOM_DISPLAY_ORDER.forEach((type) => {
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
  rows.push({
    key: "fiammetta",
    type: "dormitory",
    label: "菲亚梅塔",
    entries: [
      {
        entry: { type: "dormitory", level: 5 },
        index: -1,
        position: FIAMMETTA_POSITION,
      },
    ],
    isFiammetta: true,
  });
  return rows;
});

function clearImportedScheduleNotice(): void {
  importedScheduleNotice.value = undefined;
}

function closeSimulatorNotice(notice: EfficiencyNotice): void {
  if (notice.code === "import-extra-rooms") {
    clearImportedScheduleNotice();
  }
}

function selectDocument(documentId: string): void {
  closeContextMenu();
  if (documentId !== activeDocumentId.value) {
    clearImportedScheduleNotice();
  }
  setActiveDocument(documentId);
}

function uniqueScheduleTagValues(tags: readonly string[]): string[] {
  return Array.from(
    new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)),
  );
}

function addScheduleTag(): void {
  const stored = activeDocument.value;
  const label = scheduleTagInput.value.trim();
  if (!stored || !label) {
    return;
  }
  updateDocument(stored.id, (target) => {
    const hiddenAutoTags = uniqueScheduleTagValues(
      target.hiddenAutoTags ?? [],
    ).filter((tag) => tag !== label);
    target.hiddenAutoTags = hiddenAutoTags.length ? hiddenAutoTags : undefined;
    if (automaticScheduleTags(target.document).includes(label)) {
      return;
    }
    target.tags = uniqueScheduleTagValues([...(target.tags ?? []), label]);
  });
  scheduleTagInput.value = "";
}

function removeScheduleTag(label: string, automatic: boolean): void {
  const stored = activeDocument.value;
  if (!stored) {
    return;
  }
  updateDocument(stored.id, (target) => {
    const currentAutomaticTags = automaticScheduleTags(target.document);
    if (automatic || currentAutomaticTags.includes(label)) {
      const hiddenAutoTags = uniqueScheduleTagValues([
        ...(target.hiddenAutoTags ?? []),
        label,
      ]);
      target.hiddenAutoTags = hiddenAutoTags;
    }
    const tags = (target.tags ?? []).filter((tag) => tag !== label);
    target.tags = tags.length ? tags : undefined;
  });
}

function deselectScheduleTag(value: string) {
  const tag = currentScheduleTags.value.find((entry) => entry.label === value);
  if (tag) {
    removeScheduleTag(tag.label, tag.automatic);
  }
}

function handleScheduleTagKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    addScheduleTag();
  }
}

function beginDocumentDrag(event: PointerEvent, documentId: string): void {
  if (
    event.pointerType === "touch" ||
    event.button !== 0 ||
    !(event.currentTarget instanceof HTMLElement)
  ) {
    return;
  }
  pendingDocumentDrag.value = {
    documentId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    element: event.currentTarget,
  };
}

function handleDocumentItemClick(event: MouseEvent, documentId: string): void {
  if (suppressNextDocumentClick) {
    suppressNextDocumentClick = false;
    event.preventDefault();
    return;
  }
  selectDocument(documentId);
}

function startDocumentDrag(event: PointerEvent): void {
  const pending = pendingDocumentDrag.value;
  if (!pending || draggedDocumentId.value) {
    return;
  }
  if (
    Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) <
    5
  ) {
    return;
  }
  draggedDocumentId.value = pending.documentId;
  dragOverDocumentId.value = undefined;
  dragOverDocumentPosition.value = undefined;
  pending.element.setPointerCapture(event.pointerId);
}

function updateDocumentDragTarget(
  event: PointerEvent,
  documentId: string,
  target: HTMLElement,
): void {
  const sourceId = draggedDocumentId.value;
  if (!sourceId || sourceId === documentId) {
    return;
  }
  const position =
    event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2
      ? "before"
      : "after";
  dragOverDocumentId.value = documentId;
  dragOverDocumentPosition.value = position;
}

function documentItemAtPoint(event: PointerEvent): HTMLElement | undefined {
  return (
    window.document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-schedule-document-id]") ?? undefined
  );
}

function handleDocumentPointerMove(event: PointerEvent): void {
  const pending = pendingDocumentDrag.value;
  if (!pending || event.pointerId !== pending.pointerId) {
    return;
  }
  startDocumentDrag(event);
  if (!draggedDocumentId.value) {
    return;
  }
  const target = documentItemAtPoint(event);
  const documentId = target?.dataset.scheduleDocumentId;
  if (target && documentId) {
    updateDocumentDragTarget(event, documentId, target);
  }
}

function handleDocumentPointerUp(event: PointerEvent): void {
  if (event.pointerId !== pendingDocumentDrag.value?.pointerId) {
    return;
  }
  const sourceId = draggedDocumentId.value;
  const target = documentItemAtPoint(event);
  const documentId = target?.dataset.scheduleDocumentId;
  if (sourceId && documentId && sourceId !== documentId) {
    updateDocumentDragTarget(event, documentId, target);
    reorderDocuments(
      sourceId,
      documentId,
      dragOverDocumentPosition.value ?? "before",
    );
  }
  clearDocumentDrag();
  suppressNextDocumentClick = Boolean(sourceId);
}

function clearDocumentDrag(): void {
  draggedDocumentId.value = undefined;
  pendingDocumentDrag.value = undefined;
  dragOverDocumentId.value = undefined;
  dragOverDocumentPosition.value = undefined;
  suppressNextDocumentClick = false;
}

function setError(error: unknown): void {
  message.error(error instanceof Error ? error.message : "操作失败");
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

function updateTimedQueueSetting(enabled: boolean): void {
  updateCurrent((document) => {
    document.plans.forEach((plan) => {
      if (enabled) {
        const period = plan.period ?? plan.settings?.period;
        plan.period = period ?? [["", ""]];
        if (plan.settings) {
          delete plan.settings.period;
          if (Object.keys(plan.settings).length === 0) {
            delete plan.settings;
          }
        }
        return;
      }
      if (plan.period !== undefined) {
        plan.settings = { ...(plan.settings ?? {}), period: plan.period };
        delete plan.period;
      }
    });
  });
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

function updateTimedQueueDraft(
  planIndex: number,
  key: keyof TimedQueueDraft,
  value: string,
): void {
  const plan = currentDocument.value?.plans[planIndex];
  if (!plan) {
    return;
  }
  const draft = {
    ...timedQueueDraftFor(plan, planIndex),
    [key]: value,
  };
  timedQueueDrafts.value = {
    ...timedQueueDrafts.value,
    [timedQueueDraftKey(planIndex)]: draft,
  };
  if (
    schedulePeriodMinute(draft.start) === undefined ||
    schedulePeriodMinute(draft.end) === undefined
  ) {
    return;
  }
  updateCurrent((document) => {
    const target = document.plans[planIndex];
    if (!target) {
      return;
    }
    target.period = schedulePeriodForRange(draft.start, draft.end);
    const analysis = analyzeSchedulePeriods(document);
    const duration = analysis.durations[planIndex];
    if (duration !== undefined && analysis.errors.length === 0) {
      target.duration = duration;
    }
  });
}

function displayedPlanDurationHours(plan: Plan, planIndex: number): number {
  const duration = schedulePeriodAnalysis.value.durations[planIndex];
  return duration === undefined ? planDurationHoursValue(plan) : duration / 60;
}

function updateEfficiencyBooleanSetting(
  key: "clueExchanging" | "dormFullTreat",
  value: boolean,
): void {
  updateCurrent((document) => {
    document.settings = { ...(document.settings ?? {}), [key]: value };
  });
}

function updateRecycleBoostItem(itemId: string | undefined): void {
  updateCurrent((document) => {
    const settings = { ...(document.settings ?? {}) };
    if (recycleBoostOptions.value.some((item) => item.itemId === itemId)) {
      settings.recycleBoostItemId = itemId;
    } else {
      delete settings.recycleBoostItemId;
    }
    document.settings = settings;
  });
}

function recycleBoostOption(
  itemId: string,
): (typeof recycleBoostOptions.value)[number] | undefined {
  return recycleBoostOptions.value.find((item) => item.itemId === itemId);
}

function recycleOutputAmount(amount: number): string {
  return formatEfficiencyNumber(amount);
}

function openRecycleOutputDetails(): void {
  recycleOutputDays.value = 1;
  recycleOutputGrouping.value = "rarity";
  recycleOutputDetailsOpen.value = true;
}

function updateEfficiencyOverflowSetting(value: boolean): void {
  updateCurrent((document) => {
    document.settings = {
      ...(document.settings ?? {}),
      overflowMode: value ? "zero" : "continue",
    };
  });
}

function updateEfficiencyDroneOverflowSetting(value: boolean): void {
  updateCurrent((document) => {
    document.settings = {
      ...(document.settings ?? {}),
      droneOverflowMode: value ? "zero" : "continue",
    };
  });
}

function updateEfficiencyJieMode(value: boolean): void {
  updateCurrent((document) => {
    document.settings = {
      ...(document.settings ?? {}),
      preferMaxJieEfficiency: value,
    };
  });
}

function updateLmdDroneStrategyDraft(value: string): void {
  lmdDroneStrategyDraft.value = value;
}

function commitLmdDroneStrategy(): void {
  const document = currentDocument.value;
  if (!document) {
    return;
  }
  const current = document.settings?.lmdDroneStrategy ?? "";
  if (current === lmdDroneStrategyDraft.value) {
    return;
  }
  updateCurrent((candidate) => {
    const settings = { ...(candidate.settings ?? {}) };
    if (lmdDroneStrategyDraft.value.trim()) {
      settings.lmdDroneStrategy = lmdDroneStrategyDraft.value;
    } else {
      delete settings.lmdDroneStrategy;
    }
    candidate.settings = settings;
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

function addLayoutEntry(type: RoomKey): void {
  const document = currentDocument.value;
  if (!document) {
    return;
  }
  const plan = layoutAdditionPlan(document.layout, type);
  if (!plan) {
    return;
  }

  updateCurrent(
    (candidate) => {
      plan.types.forEach((entryType) => {
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

function layoutFromText(text: string): LayoutEntry[] {
  return validateAddedLayout(layoutWithBuildChain(parseLayoutText(text)));
}

function layoutPresetWillRemoveOperators(preset: LayoutPreset): boolean {
  const document = currentDocument.value;
  if (!document) {
    return false;
  }
  try {
    return layoutWouldRemoveOperators(
      document.plans,
      layoutFromText(preset.layoutText),
    );
  } catch {
    return false;
  }
}

function applyLayoutText(text: string = layoutText.value): void {
  try {
    const nextLayout = layoutFromText(text);
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
      message.success("已更新设施布局。");
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

function removeLayoutEntry(index: number): void {
  const document = currentDocument.value;
  const entry = document?.layout[index];
  if (!document || !entry) {
    return;
  }
  if (entry.type === "control") {
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
    if (position === FIAMMETTA_POSITION) {
      const room = fiammettaRoomAtDocument(document, planIndex, true);
      if (room) {
        update(room);
      }
      return;
    }
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

function maaDroneForPlan(plan: Plan): PlanDrones | undefined {
  return plan.drones?.enable === false ? undefined : plan.drones;
}

function maaDroneMatches(
  plan: Plan,
  type: RoomKey,
  position: number,
  order: "pre" | "post",
): boolean {
  const drones = maaDroneForPlan(plan);
  return (
    drones?.room === type &&
    drones.index === position &&
    (drones.order ?? "pre") === order
  );
}

function setMaaDrone(
  planIndex: number,
  type: RoomKey,
  position: number,
  order: "pre" | "post",
): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex];
    if (!plan) {
      return;
    }
    if (maaDroneMatches(plan, type, position, order)) {
      delete plan.drones;
      return;
    }
    plan.drones = {
      enable: true,
      room: type as "trading" | "manufacture",
      index: position,
      rule: "all",
      order,
    };
  });
}

function setAllMaaDrones(
  type: RoomKey,
  position: number,
  order: "pre" | "post",
): void {
  updateCurrent((document) => {
    const allMatch = document.plans.every((plan) =>
      maaDroneMatches(plan, type, position, order),
    );
    document.plans.forEach((plan) => {
      if (allMatch) {
        delete plan.drones;
      } else {
        plan.drones = {
          enable: true,
          room: type as "trading" | "manufacture",
          index: position,
          rule: "all",
          order,
        };
      }
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
      label: `${currentProduct}（仅保留）`,
      disabled: true,
    });
  }
  return result;
}

function sourceValue(room: RoomAssignment | undefined): string {
  return (
    room?.sourceMaterial ??
    (room?.product === "源石碎片" ? DEFAULT_SOURCE_MATERIAL : "")
  );
}

function sourceVisible(room: RoomAssignment | undefined): boolean {
  return room?.product === "源石碎片";
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
    if (product === "源石碎片") {
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
  const committed =
    position === FIAMMETTA_POSITION
      ? fiammettaRoomAtDocument(currentDocument.value!, planIndex, false)
          ?.operators?.[slotIndex]
      : operatorNameAt(plan, type, position, slotIndex);
  return draftOperatorNames.value[key] ?? committed ?? "";
}

function updateFiammettaMode(mode: FiammettaMode): void {
  updateCurrent((document) => {
    const currentMode = fiammettaMode(document);
    if (currentMode === mode) {
      return;
    }
    const state = document.fiammetta ?? {};
    if (mode === "direct") {
      const targets = (state.queue ?? [])
        .map((room) => room.operators?.find(Boolean) ?? "")
        .filter(Boolean);
      state.direct = {
        ...(state.direct ?? {}),
        ...(targets.length > 0 ? { operators: targets } : {}),
      };
      const currentCount = document.settings?.fiammettaDirectCount ?? 3;
      document.settings = {
        ...(document.settings ?? {}),
        fiammettaMode: mode,
        fiammettaDirectCount: Math.max(currentCount, targets.length),
      };
    } else {
      const targets = state.direct?.operators ?? [];
      state.queue = document.plans.map((_, index) =>
        targets[index] ? { operators: [targets[index]!] } : {},
      );
      document.settings = {
        ...(document.settings ?? {}),
        fiammettaMode: mode,
      };
    }
    document.fiammetta = state;
  });
}

function updateFiammettaDirectCount(value: number | null): void {
  updateCurrent((document) => {
    const current = document.fiammetta?.direct?.operators?.length ?? 0;
    const next =
      value === null || !Number.isFinite(value)
        ? 3
        : Math.max(current, Math.floor(value));
    document.settings = {
      ...(document.settings ?? {}),
      fiammettaDirectCount: next,
    };
  });
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
  const element = operatorPickerElement.value?.panelElement;
  if (!picker || !element) {
    return;
  }
  await nextTick();
  const currentPicker = operatorPicker.value;
  const currentElement = operatorPickerElement.value?.panelElement;
  if (!currentPicker || currentPicker.key !== picker.key || !currentElement) {
    return;
  }
  const slot = operatorPickerSlotElement(currentPicker.key);
  if (!slot) {
    return;
  }

  const placement = scheduleOperatorPickerPlacement(
    slot.getBoundingClientRect(),
    currentElement.offsetWidth,
    currentElement.offsetHeight,
    window.innerWidth,
    window.innerHeight,
  );
  operatorPicker.value = { ...currentPicker, side: placement.side };
  operatorPickerStyle.value = {
    insetInlineStart: `${placement.left}px`,
    insetBlockStart: `${placement.top}px`,
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
      ? operatorNameAtAddress(currentDocument.value, nextSlot)
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
  const key =
    editingOperatorSlot.value?.key ?? selectedOperatorSlotAddresses()[0]?.key;
  const instance = key
    ? window.document.querySelector<HTMLInputElement>(
        `.simulator-slot-name-input[data-slot-key="${key}"]`,
      )
    : undefined;
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
  const facilityBody = instance
    .closest<HTMLElement>(".simulator-facility-queue")
    ?.querySelector<HTMLElement>(".ant-card-body");
  if (facilityBody) {
    facilityBody.scrollLeft = 0;
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
  const document = currentDocument.value;
  const name = document
    ? operatorNameAtAddress(
        document,
        operatorSlotAddress(planIndex, type, position, slotIndex),
      )
    : "";
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
  if (row.isFiammetta) {
    const document = currentDocument.value;
    return document
      ? Array.from(
          { length: fiammettaSlotCount(document) },
          (_, slotIndex) => ({
            entry: row.entries[0]!,
            slotIndex,
          }),
        )
      : [];
  }
  return row.entries.flatMap((entry) =>
    Array.from(
      { length: roomSlotCount(row.type, entry.entry.level) },
      (_, slotIndex) => ({ entry, slotIndex }),
    ),
  );
}

const QUEUE_MIN_HEIGHT_EXTRA = 30;
const FACILITY_ICON_URL_BASE = "assets/raw/item_icon/";
const LABOR_ICON_URL = `${import.meta.env.BASE_URL}assets/icons/icon_labor.png`;
const EFFICIENCY_SUMMARY_MAX_FONT_SIZE = 16;
const EFFICIENCY_SUMMARY_TEXT_SAFETY_RATIO = 0.9;

function slotRefCount(row: FacilityRow): number {
  return Math.max(1, slotRefs(row).length);
}

const facilityGridStyle = computed(() => ({
  "--simulator-queue-min-height": `${
    simulatorSlotSize + slotNameBandHeight.value + QUEUE_MIN_HEIGHT_EXTRA
  }px`,
}));

function showsFacilityLevelTags(type: RoomKey): boolean {
  return !isFixedLevelRoom(type);
}

function facilityTitleStyle(row: FacilityRow): Record<string, string> {
  const tagCount =
    !row.isFiammetta && showsFacilityLevelTags(row.type)
      ? row.entries.length
      : 0;
  return facilityTitleStyleForWidth(
    row.label,
    slotRefCount(row) * simulatorSlotSize,
    tagCount,
  );
}

function facilityIconUrl(fileName: string | undefined): string | undefined {
  return fileName
    ? `${import.meta.env.BASE_URL}${FACILITY_ICON_URL_BASE}${fileName}`
    : undefined;
}

function dailyOutputIconUrl(product: string): string | undefined {
  const torappuIconPath = torappuItemIconPath(product, itemTable.value);
  if (torappuIconPath) {
    return `${import.meta.env.BASE_URL}assets/${torappuIconPath}`;
  }
  return facilityIconUrl(resourceItemIconFile(product));
}

function sanityIconUrl(): string {
  return `${import.meta.env.BASE_URL}${FACILITY_ICON_URL_BASE}${TORAPPU_SANITY_ICON_FILE}`;
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
    simulatorSlotSize *
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
      (row.isFiammetta ? fiammettaColor.value : commonAccent) ??
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
      (row.isFiammetta ? fiammettaColor.value : accent) ??
      facilityColors.value[row.type] ??
      ROOM_REPRESENTATIVE_COLORS[row.type],
  };
}

function slotRoom(
  plan: Plan,
  slot: FacilitySlotRef,
): RoomAssignment | undefined {
  if (slot.entry.position === FIAMMETTA_POSITION) {
    return undefined;
  }
  return roomAt(plan, slot.entry.entry.type, slot.entry.position);
}

function slotName(
  row: FacilityRow,
  plan: Plan,
  planIndex: number,
  slot: FacilitySlotRef,
): string {
  if (row.isFiammetta) {
    const room = fiammettaRoomAtDocument(
      currentDocument.value!,
      planIndex,
      false,
    );
    return room?.operators?.[slot.slotIndex] ?? "";
  }
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
  if (row.isFiammetta) {
    const planIndex = currentDocument.value?.plans.indexOf(plan) ?? -1;
    return (
      fiammettaRoomAtDocument(currentDocument.value!, planIndex, false)
        ?.operators?.[slot.slotIndex] ?? ""
    );
  }
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

function slotSpecialAvatarLabel(
  row: FacilityRow,
  plan: Plan,
  planIndex: number,
  slot: FacilitySlotRef,
): string | undefined {
  return specialOperatorAvatarLabelResolver.value(
    slotName(row, plan, planIndex, slot),
  );
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
  const address = operatorSlotAddress(planIndex, type, position, slotIndex);
  const nextName = draftOperatorNames.value[key]?.trim() ?? "";
  const previousName = operatorNameAtAddress(document, address);
  if (nextName === previousName) {
    resetOperatorSelectAllCycle();
    finishOperatorNameEdit(key);
    return true;
  }

  const updated = updateCurrent(
    (candidate) => {
      const room = operatorRoomAtDocument(candidate, address, true);
      if (!room) return;
      const slotLimit = operatorRoomCapacity(candidate, type, position);
      const names = Array.from(
        { length: slotLimit },
        (_, index) => room.operators?.[index] ?? "",
      );
      names[slotIndex] = nextName;
      setRoomOperators(room, names);
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

function showOperatorMessage(content: string): void {
  message.success(content);
}

function cloneOperatorState(state: OperatorState): OperatorState {
  return JSON.parse(JSON.stringify(state)) as OperatorState;
}

function operatorRoomAtDocument(
  document: ScheduleDocument,
  address: OperatorSlotAddress,
  ensure: boolean,
): RoomAssignment | undefined {
  if (address.position === FIAMMETTA_POSITION) {
    return fiammettaRoomAtDocument(document, address.planIndex, ensure);
  }
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
  if (position === FIAMMETTA_POSITION) {
    return fiammettaSlotCount(document);
  }
  const entry = document.layout.filter((item) => item.type === type)[position];
  return entry ? roomSlotCount(type, entry.level) : 0;
}

function operatorRoomAddresses(): OperatorRoomAddress[] {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }
  return facilityRows.value.flatMap((row) =>
    row.entries.map((entry) => ({
      type: row.type,
      position: entry.position,
      slotCount:
        entry.position === FIAMMETTA_POSITION
          ? fiammettaSlotCount(document)
          : roomSlotCount(row.type, entry.entry.level),
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
  const document = currentDocument.value;
  if (!row || !document) {
    return undefined;
  }
  let offset = 0;
  for (const entry of row.entries) {
    const slotCount =
      entry.position === FIAMMETTA_POSITION
        ? fiammettaSlotCount(document)
        : roomSlotCount(row.type, entry.entry.level);
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
    const slotCount =
      entry.position === FIAMMETTA_POSITION
        ? fiammettaSlotCount(document)
        : roomSlotCount(row.type, entry.entry.level);
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
    room.type === "dormitory" &&
    room.position === FIAMMETTA_POSITION &&
    currentDocument.value &&
    fiammettaMode(currentDocument.value) === "direct" &&
    planIndex !== 0
      ? []
      : Array.from({ length: room.slotCount }, (_, slotIndex) =>
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
  if (!plan) {
    return "";
  }
  return address.position === FIAMMETTA_POSITION
    ? (fiammettaRoomAtDocument(document, address.planIndex, false)?.operators?.[
        address.slotIndex
      ] ?? "")
    : operatorNameAt(plan, address.type, address.position, address.slotIndex);
}

function selectedOperatorSlotAddresses(): OperatorSlotAddress[] {
  return operatorInteraction.selectedAddresses();
}

function isOperatorSlotSelected(key: string): boolean {
  return selectedOperatorSlots.value.has(key);
}

function isOperatorSlotHovered(key: string): boolean {
  return hoveredOperatorSlot.value?.key === key;
}

function resetOperatorSelectAllCycle(): void {
  operatorInteraction.resetSelectAllCycle();
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
  const address = operatorSlotAddress(planIndex, type, position, slotIndex);
  pendingOperatorSelection = {
    key: address.key,
    wasEditing: editingOperatorSlot.value?.key === address.key,
    shouldSwitchPicker:
      operatorPicker.value !== undefined &&
      operatorPicker.value.key !== address.key,
  };
  operatorInteraction.selectAddress(event, address);
}

function currentOperatorTarget(): OperatorSlotAddress | undefined {
  return operatorInteraction.currentTarget();
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
  stage: number,
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

function clearOperatorSelection(): void {
  operatorInteraction.clearSelection();
}

function operatorSlotSnapshotAt(
  document: ScheduleDocument,
  address: OperatorSlotAddress,
): OperatorSlotSnapshot {
  const plan = document.plans[address.planIndex];
  const room = plan
    ? operatorRoomAtDocument(document, address, false)
    : undefined;
  const name = plan ? operatorNameAtAddress(document, address) : "";
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
  sourceMetadata?: Map<string, OperatorClipboardAddress>,
): Array<[OperatorSlotAddress, OperatorSlotAddress]> {
  const sources = sourceAddresses
    .filter((address) => sourceMetadata || operatorAddressByKey(address.key))
    .map((source) => {
      const metadata = sourceMetadata?.get(source.key);
      return {
        source,
        facilityKey:
          metadata?.facilityKey ?? operatorFacilityKeyForAddress(source),
        slotIndex:
          metadata?.facilitySlotIndex ?? operatorFacilitySlotIndex(source),
      };
    });
  if (sources.length === 0) {
    return [];
  }
  const sourceFacilityKey = sources[0]!.facilityKey;
  const sourceCoordinates: Array<{
    source: OperatorSlotAddress;
    slotIndex: number;
  }> = [];
  if (sources.every((source) => source.facilityKey === sourceFacilityKey)) {
    for (const source of sources) {
      const slotIndex = source.slotIndex;
      if (slotIndex === undefined) {
        sourceCoordinates.length = 0;
        break;
      }
      sourceCoordinates.push({ source: source.source, slotIndex });
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
  return sources.flatMap(({ source }, index) => {
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
  return destinationAddresses;
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

function dropOperatorAddresses(
  sources: OperatorSlotAddress[],
  target: OperatorSlotAddress,
): void {
  const pairs = operatorTransferPairs(sources, target);
  const destinations = swapOperatorAddressPairs(pairs);
  if (destinations.length > 0) {
    showOperatorMessage(
      destinations.length < sources.length
        ? `已交换 ${destinations.length} 个槽位，超出目标槽位的内容已截断`
        : `已交换 ${destinations.length} 个槽位`,
    );
  }
}

function clearOperatorPasteHighlight(): void {
  operatorInteraction.clearPasteHighlight();
}

function clearOperatorClipboard(): void {
  operatorClipboard.value = undefined;
  clearOperatorPasteHighlight();
}

function setOperatorClipboard(
  mode: "copy" | "cut",
  entries: OperatorClipboardEntry[],
  addresses: OperatorSlotAddress[],
): void {
  clearOperatorPasteHighlight();
  operatorClipboard.value = {
    mode,
    entries,
    sourceDocumentId: activeDocumentId.value,
    sourceAddresses: addresses.map((address) => ({
      ...address,
      facilityKey: operatorFacilityKeyForAddress(address),
      facilitySlotIndex: operatorFacilitySlotIndex(address),
    })),
  };
}

function showOperatorPasteHighlight(addresses: OperatorSlotAddress[]): void {
  operatorInteraction.showPasteHighlight(addresses);
}

function operatorClipboardIsUsable(): boolean {
  const clipboard = operatorClipboard.value;
  if (!clipboard || clipboard.entries.length === 0) {
    return false;
  }
  if (
    clipboard.sourceAddresses.length !== clipboard.entries.length ||
    clipboard.sourceDocumentId.length === 0
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
    return false;
  }
  const sourceEntries = new Map<string, OperatorClipboardEntry>();
  clipboard.sourceAddresses.forEach((address, index) => {
    const entry = clipboard.entries[index];
    if (entry) {
      sourceEntries.set(address.key, entry);
    }
  });
  const sourceMetadata = new Map(
    clipboard.sourceAddresses.map((source) => [source.key, source]),
  );
  const selectedTargets = selectedOperatorSlotAddresses();
  const fallbackTransferEntries = operatorTransferPairs(
    clipboard.sourceAddresses,
    target,
    sourceMetadata,
  ).flatMap(([source, address]) => {
    const entry = sourceEntries.get(source.key);
    return entry ? [{ address, entry }] : [];
  });
  const transferEntries = operatorPasteAssignments(
    clipboard.entries,
    selectedTargets,
    fallbackTransferEntries,
  );
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
  const isBroadcastPaste =
    clipboard.entries.length === 1 && selectedTargets.length > 1;
  const truncated = transferEntries.length < clipboard.entries.length;
  if (clipboard.mode === "cut") {
    clearOperatorClipboard();
  }
  showOperatorPasteHighlight(pastedAddresses);
  showOperatorMessage(
    isBroadcastPaste && clipboard.entries[0]?.name
      ? `已粘贴 1 名干员到 ${pastedAddresses.length} 个槽位`
      : isBroadcastPaste
        ? `已清空 ${pastedAddresses.length} 个槽位`
        : truncated
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

function navigateOperatorSlot(action: ScheduleOperatorNavigation): boolean {
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

function efficiencySummaryText(row: FacilityRow, planIndex: number): string {
  const result = planFacilityResult(row, planIndex);
  if (!result) {
    return "";
  }
  return `${formatEfficiencyNumber(result.operatorSkillEfficiency)}% / ${formatEfficiencyNumber(result.efficiency)}%`;
}

function maaDroneOrderForFacility(
  row: FacilityRow,
  planIndex: number,
): "pre" | "post" | undefined {
  const plan = currentDocument.value?.plans[planIndex];
  const position = row.entries[0]?.position;
  if (!plan || position === undefined) {
    return undefined;
  }
  if (maaDroneMatches(plan, row.type, position, "pre")) {
    return "pre";
  }
  if (maaDroneMatches(plan, row.type, position, "post")) {
    return "post";
  }
  return undefined;
}

function efficiencySummaryStyle(
  row: FacilityRow,
  planIndex: number,
): Record<string, string> {
  const text = efficiencySummaryText(row, planIndex);
  if (!text) {
    return {};
  }
  const availableWidth = slotRefCount(row) * simulatorSlotSize;
  const fontSize = Math.min(
    EFFICIENCY_SUMMARY_MAX_FONT_SIZE,
    (availableWidth / estimateTextEm(text)) *
      EFFICIENCY_SUMMARY_TEXT_SAFETY_RATIO,
  );
  return { fontSize: `${fontSize}px` };
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

function operatorMoodRemaining(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): number | undefined {
  if (position === FIAMMETTA_POSITION) {
    const calculation = efficiencyResult.value?.fiammetta;
    return calculation?.mode === "direct"
      ? 24
      : calculation?.plans[planIndex]?.targetMood;
  }
  return efficiencyResult.value?.plans[planIndex]?.moods.find(
    (mood) =>
      mood.facilityId === facilityId(type, position) &&
      mood.slotIndex === slotIndex,
  )?.end;
}

function facilityResultLabel(result: FacilityEfficiencyResult): string {
  return formatFacilityResultLabel(result, currentDocument.value?.layout ?? []);
}

function basePointLabel(term: string): string {
  return formatBasePointLabel(term, getRiicEfficiencyCatalog().terms);
}

function basePointSourceText(source: BasePointSource): string {
  return formatBasePointSource(source, getRiicEfficiencyCatalog().terms);
}

function refreshEfficiencyCatalog(): void {
  efficiencyCatalog.value = undefined;
  efficiencyError.value = "";
  if (!baseDataReady.value || operators.value.length === 0) {
    efficiencyLoading.value = false;
    return;
  }

  efficiencyLoading.value = true;
  try {
    efficiencyCatalog.value = getRiicEfficiencyCatalog(recycleRules.value);
  } catch (error: unknown) {
    efficiencyError.value =
      error instanceof Error ? error.message : "效率数据读取失败";
  } finally {
    efficiencyLoading.value = false;
  }
}

function operatorByName(name: string): Operator | undefined {
  return operatorByNameMap.value.get(name);
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

function operatorQueueMoodScattered(
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
  room: RoomAssignment | undefined,
  name: string,
): boolean {
  return (
    operatorMoodScattered(room, name) ||
    operatorMoodRemaining(planIndex, type, position, slotIndex) === 0
  );
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
  if (!menu || menu.scope !== "operator" || !document) {
    return undefined;
  }
  const plan = document.plans[menu.planIndex];
  const address = operatorSlotAddress(
    menu.planIndex,
    menu.type,
    menu.position,
    menu.slotIndex,
  );
  const room = operatorRoomAtDocument(document, address, false);
  const name = plan ? operatorNameAtAddress(document, address) : "";
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

function scheduleDocumentContextMenuStyle(): Record<string, string> {
  const menu = scheduleDocumentContextMenu.value;
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

async function clampScheduleDocumentContextMenuPosition(): Promise<void> {
  await nextTick();
  const menu = scheduleDocumentContextMenu.value;
  const element = scheduleDocumentContextMenuElement.value;
  if (!menu || !element) {
    return;
  }
  const maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8);
  const maxLeft = Math.max(8, window.innerWidth - element.offsetWidth - 8);
  const y = Math.min(Math.max(8, menu.y), maxTop);
  const x = Math.min(Math.max(8, menu.x), maxLeft);
  if (menu.x !== x || menu.y !== y) {
    scheduleDocumentContextMenu.value = { ...menu, x, y };
  }
}

function openScheduleDocumentContextMenu(
  event: MouseEvent,
  documentId: string,
): void {
  contextMenu.value = undefined;
  scheduleDocumentContextMenu.value = {
    documentId,
    ...contextMenuPosition(event),
  };
  void clampScheduleDocumentContextMenuPosition();
}

function openOperatorContextMenu(
  event: MouseEvent,
  planIndex: number,
  type: RoomKey,
  position: number,
  slotIndex: number,
): void {
  if (position === FIAMMETTA_POSITION) {
    return;
  }
  scheduleDocumentContextMenu.value = undefined;
  if (!commitPendingOperatorNameEdit()) {
    return;
  }
  const address = operatorSlotAddress(planIndex, type, position, slotIndex);
  selectedOperatorSlots.value = new Set([address.key]);
  operatorSelectionAnchor.value = address;
  contextMenu.value = {
    ...address,
    scope: "operator",
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
  if (positions.includes(FIAMMETTA_POSITION)) {
    return;
  }
  scheduleDocumentContextMenu.value = undefined;
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
  scheduleDocumentContextMenu.value = undefined;
  if (
    event.target instanceof Element &&
    event.target.closest(".simulator-facility-queue")
  ) {
    return;
  }
  const position = row.entries[0]?.position;
  if (position === undefined || !roomHasProduct(row.type)) {
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
  scheduleDocumentContextMenu.value = undefined;
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

  if (!roomHasProduct(type)) {
    return items;
  }

  items.push({
    key: `product-divider-${position}`,
    label: "",
    divider: true,
  });
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

  if (type === "trading" || type === "manufacture") {
    items.push({ key: `drone-divider-${position}`, label: "", divider: true });
    (["pre", "post"] as const).forEach((order) => {
      items.push({
        key: `drone-${position}-${order}`,
        label:
          order === "pre" ? "无人机加速（换班前）" : "无人机加速（换班后）",
        check: plan ? maaDroneMatches(plan, type, position, order) : false,
        action: () => {
          setMaaDrone(planIndex, type, position, order);
          closeContextMenu();
        },
      });
    });
  }

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
            if (option.value === "源石碎片") {
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

  if (type === "trading" || type === "manufacture") {
    items.push({
      key: `facility-drone-divider-${position}`,
      label: "",
      divider: true,
    });
    (["pre", "post"] as const).forEach((order) => {
      items.push({
        key: `facility-drone-${position}-${order}`,
        label:
          order === "pre" ? "无人机加速（换班前）" : "无人机加速（换班后）",
        check: document.plans.every((plan) =>
          maaDroneMatches(plan, type, position, order),
        ),
        action: () => {
          setAllMaaDrones(type, position, order);
          closeContextMenu();
        },
      });
    });
  }

  if (!rooms.length || !rooms.every((room) => room?.product === "源石碎片")) {
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

function resetRoomOperatorProgression(room: RoomAssignment | undefined): void {
  if (!room?.operatorStates) {
    return;
  }
  (room.operators ?? []).forEach((name) => {
    if (!name) {
      return;
    }
    const state = room.operatorStates?.[name];
    if (!state) {
      return;
    }
    delete state.elite;
    delete state.level;
    if (Object.keys(state).length === 0) {
      delete room.operatorStates?.[name];
    }
  });
  if (Object.keys(room.operatorStates).length === 0) {
    delete room.operatorStates;
  }
}

function resetAllOperatorProgression(): void {
  const updated = updateCurrent(
    (document) => {
      document.plans.forEach((plan, planIndex) => {
        ROOM_ORDER.forEach((type) => {
          const rooms = plan.rooms[type];
          if (Array.isArray(rooms)) {
            rooms.forEach((room) =>
              resetRoomOperatorProgression(room as RoomAssignment),
            );
          }
        });
        resetRoomOperatorProgression(
          fiammettaRoomAtDocument(document, planIndex, false),
        );
      });
    },
    { recordHistory: true },
  );
  if (updated) {
    showOperatorMessage("已恢复该排班表中所有干员的默认练度");
  }
}

function handleWindowPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      ".simulator-context-menu, .simulator-schedule-document-context-menu",
    )
  ) {
    return;
  }
  closeContextMenu();
}

function handleWindowClick(event: MouseEvent): void {
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      ".simulator-context-menu, .simulator-schedule-document-context-menu",
    )
  ) {
    return;
  }
  if (
    target instanceof Node &&
    operatorPickerElement.value?.panelElement?.contains(target)
  ) {
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

function updateDocumentSidebarHeight(): void {
  const sidebar = documentSidebar.value;
  if (!sidebar || typeof window === "undefined") {
    return;
  }

  const sidebarTop = Math.max(sidebar.getBoundingClientRect().top, 0);
  const minimumHeight =
    Array.from(sidebar.children)
      .slice(0, 2)
      .reduce(
        (height, child) => height + child.getBoundingClientRect().height,
        0,
      ) + 120;
  sidebar.style.position =
    minimumHeight > window.innerHeight - 108 ? "static" : "";
  const availableHeight = Math.max(
    minimumHeight,
    window.innerHeight - sidebarTop - 16,
  );
  const nextValue = `${availableHeight}px`;
  if (
    sidebar.style.getPropertyValue(
      "--simulator-document-sidebar-max-height",
    ) !== nextValue
  ) {
    sidebar.style.setProperty(
      "--simulator-document-sidebar-max-height",
      nextValue,
    );
  }
}

function scheduleDocumentSidebarHeightUpdate(): void {
  if (
    typeof window === "undefined" ||
    documentSidebarMeasureFrame !== undefined
  ) {
    return;
  }
  documentSidebarMeasureFrame = window.requestAnimationFrame(() => {
    documentSidebarMeasureFrame = undefined;
    updateDocumentSidebarHeight();
  });
}

function cancelDocumentSidebarHeightUpdate(): void {
  if (documentSidebarMeasureFrame === undefined) {
    return;
  }
  window.cancelAnimationFrame(documentSidebarMeasureFrame);
  documentSidebarMeasureFrame = undefined;
}

function observeDocumentSidebar(): void {
  documentSidebarResizeObserver?.disconnect();
  documentSidebarResizeObserver = undefined;
  scheduleDocumentSidebarHeightUpdate();
  const sidebar = documentSidebar.value;
  if (!sidebar || typeof ResizeObserver === "undefined") {
    return;
  }
  documentSidebarResizeObserver = new ResizeObserver(() => {
    scheduleDocumentSidebarHeightUpdate();
  });
  documentSidebarResizeObserver.observe(sidebar);
  const actions = sidebar.querySelector(".simulator-sidebar-actions");
  if (actions) {
    documentSidebarResizeObserver.observe(actions);
  }
}

function handleWindowScroll() {
  closeContextMenu();
  void updateOperatorPickerPosition();
  scheduleDocumentSidebarHeightUpdate();
}

function handleWindowResize() {
  closeContextMenu();
  void updateOperatorPickerPosition();
  scheduleDocumentSidebarHeightUpdate();
  updateImageExportPreviewViewportWidth();
}

function handleCreate(): void {
  clearImportedScheduleNotice();
  createDocument();
  message.success("已新建排班表。");
}

function updateImportedLayout(nextLayout: LayoutEntry[]): void {
  const draft = importDraft.value;
  if (!draft) {
    return;
  }
  draft.layout = nextLayout.map((entry) => ({ ...entry }));
  draft.parsed.document.plans = resizeImportedRooms(
    draft.parsed.document.plans,
    draft.layout,
  );
}

function applyImportLayoutText(text: string): void {
  try {
    const requestedLayout = parseLayoutText(text);
    const nextLayout = validateAddedLayout(
      layoutWithBuildChain(requestedLayout),
    );
    updateImportedLayout(nextLayout);
  } catch (error: unknown) {
    setError(error);
  }
}

function addImportLayoutEntry(type: RoomKey): void {
  const draft = importDraft.value;
  if (!draft) {
    return;
  }
  const plan = layoutAdditionPlan(draft.layout, type);
  if (!plan) {
    return;
  }
  const nextLayout = [...draft.layout];
  plan.types.forEach((entryType) => {
    nextLayout.push({ type: entryType, level: layoutEntryLevelMax(entryType) });
  });
  updateImportedLayout(nextLayout);
}

function updateImportFacilityLevel(index: number, value: number | null): void {
  const draft = importDraft.value;
  if (!draft || value === null) {
    return;
  }
  const entry = draft.layout[index];
  if (!entry) {
    return;
  }
  const range = roomLevelRange(entry.type);
  const level = Math.max(range.min, Math.min(range.max, Math.round(value)));
  updateImportedLayout(
    draft.layout.map((layoutEntry, layoutIndex) =>
      layoutIndex === index ? { ...layoutEntry, level } : layoutEntry,
    ),
  );
}

function removeImportLayoutEntry(index: number): void {
  const draft = importDraft.value;
  const entry = draft?.layout[index];
  if (!draft || !entry) {
    return;
  }
  if (entry.type === "control") {
    return;
  }
  const cascadedTypes = new Set<RoomKey>(cascadeLayoutTypes(entry.type));
  const removedTypes = new Set<RoomKey>([entry.type, ...cascadedTypes]);
  const removedPositions = new Map<RoomKey, number[]>();
  draft.layout.forEach((layoutEntry, layoutIndex) => {
    if (!removedTypes.has(layoutEntry.type)) {
      return;
    }
    const positions = removedPositions.get(layoutEntry.type) ?? [];
    const position = draft.layout
      .slice(0, layoutIndex)
      .filter(
        (previousEntry) => previousEntry.type === layoutEntry.type,
      ).length;
    if (layoutIndex === index || layoutEntry.type !== entry.type) {
      positions.push(position);
    }
    removedPositions.set(layoutEntry.type, positions);
  });
  draft.parsed.document.plans.forEach((plan) => {
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
  updateImportedLayout(
    draft.layout.filter(
      (layoutEntry, layoutIndex) =>
        layoutIndex !== index && !cascadedTypes.has(layoutEntry.type),
    ),
  );
}

function applyImportedFiammetta(document: ScheduleDocument): void {
  if (document.importFiammetta !== true) {
    return;
  }
  const dormEntries = document.layout.filter(
    (entry) => entry.type === "dormitory",
  );
  const lastEntry = dormEntries.at(-1);
  if (!lastEntry) {
    return;
  }
  document.plans.forEach((plan) => {
    const rooms = plan.rooms.dormitory;
    const room = Array.isArray(rooms)
      ? (rooms.at(-1) as RoomAssignment | undefined)
      : undefined;
    if (!room || room.operators?.includes("菲亚梅塔")) {
      return;
    }
    const capacity = roomSlotCount("dormitory", lastEntry.level);
    const operators = [...(room.operators ?? [])];
    if (operators[capacity - 1]) {
      return;
    }
    while (operators.length < capacity) {
      operators.push("");
    }
    operators[capacity - 1] = "菲亚梅塔";
    room.operators = operators;
  });
}

function disableImportedEditSettings(documentId: string): void {
  const nextSettings = {
    ...simulatorEditSettings.value,
    [documentId]: {
      layout: false,
      queue: false,
    },
  };
  simulatorEditSettings.value = nextSettings;
  persistSimulatorEditSettings(nextSettings);
}

function confirmImport(): void {
  const draft = importDraft.value;
  if (!draft) {
    return;
  }
  try {
    const document = cloneSchedule(draft.parsed.document);
    document.layout = draft.layout.map((entry) => ({ ...entry }));
    document.plans = resizeImportedRooms(document.plans, document.layout);
    applyImportedFiammetta(document);
    delete document.importFiammetta;
    validateSchedule(document);
    const stored = createDocument(
      document,
      draft.parsed.inferredLayout,
      draft.fileName,
    );
    disableImportedEditSettings(stored.id);
    importDraft.value = undefined;
    clearImportedScheduleNotice();
    importedScheduleNotice.value = buildImportedExtraRoomsNotice(
      stored.document,
    );
    message.success("已导入排班表。");
  } catch (error: unknown) {
    setError(error);
  }
}

function cancelImport(): void {
  importDraft.value = undefined;
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

  clearImportedScheduleNotice();
  try {
    const text = await file.text();
    const backup = parseScheduleBackup(text);
    if (backup) {
      const idMap = appendDocuments(backup.documents, backup.activeDocumentId);
      const nextSettings = { ...simulatorEditSettings.value };
      backup.documents.forEach((document) => {
        const id = idMap.get(document.id);
        const settings = backup.editSettings[document.id];
        if (id && settings) {
          nextSettings[id] = { ...settings };
        }
      });
      simulatorEditSettings.value = nextSettings;
      persistSimulatorEditSettings(nextSettings);
      message.success(`已导入 ${backup.documents.length} 张排班表。`);
      return;
    }

    const parsed = parseScheduleImport(text, getRiicEfficiencyTerms());
    importDraft.value = {
      parsed,
      fileName: file.name,
      layout: parsed.document.layout.map((entry) => ({ ...entry })),
    };
  } catch (error: unknown) {
    setError(error);
  }
}

function handleDuplicate(documentId?: string): void {
  clearImportedScheduleNotice();
  const id = documentId ?? activeDocumentId.value;
  const stored = documents.value.find((document) => document.id === id);
  if (!stored) {
    return;
  }
  duplicateDocument(stored.id);
  message.success("已复制排班表。");
}

function openDeleteScheduleModal(documentId?: string): void {
  const id = documentId ?? activeDocumentId.value;
  const stored = documents.value.find((document) => document.id === id);
  if (!stored) {
    return;
  }
  pendingDeleteSchedule.value = {
    id: stored.id,
    title: stored.document.title || "未命名排班表",
  };
  deleteScheduleModalOpen.value = true;
}

function closeDeleteScheduleModal(): void {
  deleteScheduleModalOpen.value = false;
  pendingDeleteSchedule.value = undefined;
}

function confirmDeleteSchedule(): void {
  const target = pendingDeleteSchedule.value;
  closeDeleteScheduleModal();
  if (
    !target ||
    !documents.value.some((document) => document.id === target.id)
  ) {
    return;
  }
  clearImportedScheduleNotice();
  removeDocument(target.id);
  const nextSettings = { ...simulatorEditSettings.value };
  delete nextSettings[target.id];
  simulatorEditSettings.value = nextSettings;
  persistSimulatorEditSettings(nextSettings);
  message.success("已删除排班表。");
}

function handleExport(documentId?: string): void {
  const id = documentId ?? activeDocumentId.value;
  const stored = documents.value.find((document) => document.id === id);
  const document = stored?.document;
  if (!document) {
    return;
  }

  try {
    const json = serializeMaaSchedule(document, {
      catalog: efficiencyCatalog.value,
    });
    const duplicateWarning = formatDuplicateOperatorWarnings(
      document,
      getRiicEfficiencyTerms(),
    );
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${(document.title?.trim() || "排班模拟器").replace(/[\\/:*?"<>|]/g, "_")}.${DEFAULT_SCHEDULE_ADAPTER.fileExtension}`;
    link.click();
    URL.revokeObjectURL(url);
    message.success("已导出严格 JSON 文件。");
    if (duplicateWarning) {
      message.warning(`导出文件中存在重复干员配置：${duplicateWarning}`);
    }
  } catch (error: unknown) {
    setError(error);
  }
}

function handleExportAll(): void {
  if (documents.value.length === 0) {
    return;
  }

  try {
    const editSettings = Object.fromEntries(
      documents.value.map((document) => [
        document.id,
        simulatorEditSettings.value[document.id] ??
          DEFAULT_SIMULATOR_EDIT_SETTINGS,
      ]),
    );
    const json = serializeScheduleBackup({
      format: "riic-tools-schedule-backup",
      version: 1,
      activeDocumentId: activeDocumentId.value,
      documents: documents.value,
      editSettings,
    });
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = "排班模拟器-全部排班表.json";
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${documents.value.length} 张排班表。`);
  } catch (error: unknown) {
    setError(error);
  }
}

const IMAGE_EXPORT_PREVIEW_WIDTH = 1920;
const IMAGE_EXPORT_PREVIEW_HEIGHT = 1080;

const imageExportPreviewEffectiveZoom = computed<number>(() => {
  if (imageExportPreviewZoom.value !== "auto") {
    return imageExportPreviewZoom.value;
  }
  const viewportWidth = imageExportPreviewViewportWidth.value;
  const targetWidth =
    imageExportPreviewWidthMode.value === "overflow"
      ? (window.document.querySelector<HTMLElement>("main")?.clientWidth ??
        viewportWidth)
      : viewportWidth;
  return targetWidth > 0 ? targetWidth / IMAGE_EXPORT_PREVIEW_WIDTH : 1;
});

const imageExportPreviewZoomStyle = computed<Record<string, string>>(() => {
  const zoom = imageExportPreviewEffectiveZoom.value;
  return {
    width: `${IMAGE_EXPORT_PREVIEW_WIDTH * zoom}px`,
    height: `${IMAGE_EXPORT_PREVIEW_HEIGHT * zoom}px`,
  };
});

const imageExportPreviewStageStyle = computed<Record<string, string>>(() => ({
  transform: `scale(${imageExportPreviewEffectiveZoom.value})`,
}));

const imageExportPreviewContentStyle = computed<Record<string, string>>(() => {
  const { width, height } = imageExportPreviewContentSize.value;
  const scale = imageExportPreviewContentScale.value;
  return {
    width: `${width}px`,
    height: `${height}px`,
    insetInlineStart: "0px",
    insetBlockStart: "0px",
    transform: `scale(${scale})`,
    transformOrigin: "top left",
  };
});

function updateImageExportPreviewViewportWidth(): void {
  imageExportPreviewViewportWidth.value =
    imageExportPreviewViewport.value?.clientWidth ?? 0;
}

function resetImageExportPreviewScroll(): void {
  const viewport = imageExportPreviewViewport.value;
  if (!viewport || imageExportPreviewWidthMode.value !== "scroll") {
    return;
  }
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;
}

function observeImageExportPreview(): void {
  imageExportPreviewResizeObserver?.disconnect();
  imageExportPreviewResizeObserver = undefined;
  updateImageExportPreviewViewportWidth();
  const viewport = imageExportPreviewViewport.value;
  if (!viewport || typeof ResizeObserver === "undefined") {
    return;
  }
  imageExportPreviewResizeObserver = new ResizeObserver(
    updateImageExportPreviewViewportWidth,
  );
  imageExportPreviewResizeObserver.observe(viewport);
}

function updateImageExportPreviewContent(): void {
  const root = imageExportPrepared.value?.root;
  const width = Math.max(1, root?.offsetWidth ?? IMAGE_EXPORT_PREVIEW_WIDTH);
  const height = Math.max(1, root?.offsetHeight ?? IMAGE_EXPORT_PREVIEW_HEIGHT);
  imageExportPreviewContentSize.value = { width, height };
  imageExportPreviewContentScale.value = 1;
}

function cleanupImageExportPreview(): void {
  imageExportPreviewResizeObserver?.disconnect();
  imageExportPreviewResizeObserver = undefined;
  imageExportPrepared.value?.cleanup();
  imageExportPrepared.value = undefined;
  imageExportPreviewMount.value?.replaceChildren();
  imageExportPreviewContentSize.value = {
    width: IMAGE_EXPORT_PREVIEW_WIDTH,
    height: IMAGE_EXPORT_PREVIEW_HEIGHT,
  };
  imageExportPreviewContentScale.value = 1;
  imageExportPreviewViewportWidth.value = 0;
}

function closeImageExport(): void {
  imageExportRequestVersion += 1;
  imageExportModalOpen.value = false;
  imageExportLoading.value = false;
  cleanupImageExportPreview();
  imageExportError.value = "";
}

function imageExportResolutionValue(): (typeof SCHEDULE_IMAGE_RESOLUTIONS)[number] {
  return (
    SCHEDULE_IMAGE_RESOLUTIONS.find(
      (resolution) => resolution.key === imageExportResolution.value,
    ) ?? SCHEDULE_IMAGE_RESOLUTIONS[0]
  );
}

async function prepareImageExport(): Promise<void> {
  const documentId = imageExportDocumentId.value;
  const source = window.document.querySelector<HTMLElement>(
    ".simulator-editor .simulator-facility-grid",
  );
  if (!source) {
    imageExportError.value = "当前没有可导出的排班内容";
    return;
  }

  const requestId = ++imageExportRequestVersion;
  imageExportLoading.value = true;
  imageExportError.value = "";
  cleanupImageExportPreview();
  try {
    await nextTick();
    observeImageExportPreview();
    if (!imageExportPreviewMount.value) {
      throw new Error("图片预览区域初始化失败");
    }
    const prepared = await createPreparedScheduleImage(documentId, source);
    if (requestId !== imageExportRequestVersion) {
      prepared.cleanup();
      return;
    }
    imageExportPrepared.value = prepared;
    imageExportPreviewMount.value.replaceChildren(prepared.root);
    await nextTick();
    updateImageExportPreviewContent();
    await nextTick();
    resetImageExportPreviewScroll();
  } catch (error: unknown) {
    if (requestId === imageExportRequestVersion) {
      imageExportError.value =
        error instanceof Error ? error.message : "排班表图片导出失败";
    }
  } finally {
    if (requestId === imageExportRequestVersion) {
      imageExportLoading.value = false;
    }
  }
}

async function createPreparedScheduleImage(
  documentId: string,
  source: HTMLElement,
): Promise<PreparedScheduleImage> {
  const stored = documents.value.find((item) => item.id === documentId);
  const schedule = stored?.document;
  if (!schedule) {
    throw new Error("当前没有可导出的排班内容");
  }

  const normalizedSchedule = JSON.parse(
    serializeMaaSchedule(schedule, { catalog: efficiencyCatalog.value }),
  ) as ScheduleDocument;
  return prepareScheduleImage({
    normalizedSchedule,
    resolveEliteLevel: (name, context) => {
      const plan = schedule.plans[context.planIndex];
      const room =
        context.position === FIAMMETTA_POSITION
          ? fiammettaRoomAtDocument(schedule, context.planIndex, false)
          : plan
            ? roomAt(plan, context.type, context.position)
            : undefined;
      return operatorElite(room, name, context.type);
    },
    resolveOperator: operatorByName,
    schedule,
    source,
  });
}

async function prepareScheduleReferenceImage(
  documentId: string,
): Promise<PreparedScheduleImage> {
  if (!documents.value.some((document) => document.id === documentId)) {
    throw new Error("排班表不存在");
  }

  const previousDocumentId = activeDocumentId.value;
  const shouldRestore =
    previousDocumentId !== documentId &&
    documents.value.some((document) => document.id === previousDocumentId);
  if (previousDocumentId !== documentId) {
    setActiveDocument(documentId);
    await nextTick();
  }

  try {
    const source = window.document.querySelector<HTMLElement>(
      ".simulator-editor .simulator-facility-grid",
    );
    if (!source) {
      throw new Error("排班表预览区域初始化失败");
    }
    await nextTick();
    return await createPreparedScheduleImage(documentId, source);
  } finally {
    if (shouldRestore) {
      setActiveDocument(previousDocumentId);
      await nextTick();
    }
  }
}

async function handleExportImage(documentId?: string): Promise<void> {
  const id = documentId ?? activeDocumentId.value;
  if (!documents.value.some((document) => document.id === id)) {
    return;
  }
  if (id !== activeDocumentId.value) {
    selectDocument(id);
    await nextTick();
  }
  imageExportDocumentId.value = id;
  imageExportModalOpen.value = true;
  await prepareImageExport();
}

function updateImageExportResolution(event: {
  target: { value: string | number };
}): void {
  const key = String(event.target.value) as ScheduleImageResolutionKey;
  if (
    !SCHEDULE_IMAGE_RESOLUTIONS.some((resolution) => resolution.key === key)
  ) {
    return;
  }
  imageExportResolution.value = key;
}

function updateImageExportPreviewWidthMode(event: {
  target: { value: string | number };
}): void {
  const mode = String(event.target.value);
  if (mode === "scroll" || mode === "overflow") {
    imageExportPreviewWidthMode.value = mode;
    void nextTick(resetImageExportPreviewScroll);
  }
}

function updateImageExportPreviewZoom(event: {
  target: { value: string | number };
}): void {
  const value = String(event.target.value);
  if (value === "auto") {
    imageExportPreviewZoom.value = value;
    void nextTick(resetImageExportPreviewScroll);
    return;
  }
  const zoom = Number(value);
  if ([0.5, 1, 2].includes(zoom)) {
    imageExportPreviewZoom.value = zoom;
    void nextTick(resetImageExportPreviewScroll);
  }
}

async function downloadImageExport(): Promise<void> {
  const prepared = imageExportPrepared.value;
  if (!prepared || imageExportLoading.value) {
    return;
  }
  const requestId = imageExportRequestVersion;
  imageExportLoading.value = true;
  imageExportError.value = "";
  const stored = documents.value.find(
    (document) => document.id === imageExportDocumentId.value,
  );
  try {
    const dataUrl = await renderPreparedScheduleImage(
      prepared.root,
      imageExportResolutionValue(),
    );
    if (requestId !== imageExportRequestVersion) {
      return;
    }
    const title = (stored?.document.title?.trim() || "排班模拟器").replace(
      /[\\/:*?"<>|]/g,
      "_",
    );
    const link = window.document.createElement("a");
    link.href = dataUrl;
    link.download = `${title}-${imageExportResolutionValue().key}.png`;
    link.click();
  } catch (error: unknown) {
    if (requestId === imageExportRequestVersion) {
      imageExportError.value =
        error instanceof Error ? error.message : "排班表图片导出失败";
    }
  } finally {
    if (requestId === imageExportRequestVersion) {
      imageExportLoading.value = false;
    }
  }
}

function isStoredDocument(document: StoredDocument): boolean {
  return document.id === activeDocumentId.value;
}

function setScheduleTagFilter(tag: string, checked: boolean): void {
  selectedScheduleTags.value = checked
    ? [...selectedScheduleTags.value, tag]
    : selectedScheduleTags.value.filter((selected) => selected !== tag);
}

watch(availableScheduleTags, (tags) => {
  selectedScheduleTags.value = selectedScheduleTags.value.filter((tag) =>
    tags.includes(tag),
  );
});

watch(activeDocumentId, () => {
  if (
    imageExportModalOpen.value &&
    imageExportDocumentId.value !== activeDocumentId.value
  ) {
    closeImageExport();
  }
  draftOperatorNames.value = {};
  editingOperatorSlot.value = undefined;
  closeOperatorPicker();
  clearOperatorSelection();
  setOperatorDragTarget(undefined);
  setOperatorDragHoveredSlot(undefined);
  hoveredOperatorSlot.value = undefined;
  clearOperatorPasteHighlight();
  contextMenu.value = undefined;
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
    layoutApplyTimer = undefined;
  }
});

watch(
  [activeDocumentId, () => currentDocument.value?.settings?.lmdDroneStrategy],
  ([, strategy]) => {
    lmdDroneStrategyDraft.value = strategy ?? "";
  },
  { immediate: true },
);

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
  baseDataReady,
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

watch(
  () => props.initialDocumentId,
  (value) => {
    const documentId = value ?? "";
    if (
      documentId &&
      documents.value.some((document) => document.id === documentId)
    ) {
      selectDocument(documentId);
    }
  },
  { immediate: true },
);

onMounted(() => {
  void loadFacilityOperatorOverrides();
  if (props.previewOnly) {
    return;
  }
  window.addEventListener("pointerdown", handleWindowPointerDown, true);
  window.addEventListener("click", handleWindowClick);
  window.addEventListener("keydown", handleWindowKeydown, true);
  window.addEventListener("pointermove", handleOperatorGridPointerMove, true);
  window.addEventListener("pointerup", handleOperatorGridPointerUp, true);
  window.addEventListener("pointermove", handleDocumentPointerMove, true);
  window.addEventListener("pointerup", handleDocumentPointerUp, true);
  window.addEventListener("pointercancel", clearDocumentDrag, true);
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
  void nextTick(observeDocumentSidebar);
});

onBeforeUnmount(() => {
  cleanupImageExportPreview();
  cancelDocumentSidebarHeightUpdate();
  documentSidebarResizeObserver?.disconnect();
  documentSidebarResizeObserver = undefined;
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
  window.removeEventListener("pointermove", handleDocumentPointerMove, true);
  window.removeEventListener("pointerup", handleDocumentPointerUp, true);
  window.removeEventListener("pointercancel", clearDocumentDrag, true);
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
  closeOperatorPicker();
});

watch(showScheduleSidebar, () => {
  void nextTick(observeDocumentSidebar);
});

defineExpose({ prepareScheduleReferenceImage });
</script>

<template>
  <div
    :class="{ 'simulator-page--preview-source': props.previewOnly }"
    class="page-shell simulator-page"
  >
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

    <a-modal
      :cancel-text="'取消'"
      :ok-text="'确认导入'"
      :open="Boolean(importDraft)"
      title="确认导入排班表设施"
      width="760px"
      @cancel="cancelImport"
      @ok="confirmImport"
    >
      <template v-if="importDraft">
        <a-alert
          :message="`文件：${importDraft.fileName}`"
          show-icon
          type="info"
        />
        <div class="simulator-import-power-summary">
          <span
            >当前消耗 <strong>{{ importPowerPreview.used }}</strong></span
          >
          <span
            >总共电力 <strong>{{ importPowerPreview.provided }}</strong></span
          >
          <span
            :class="{
              'simulator-import-power-negative': importPowerPreview.net < 0,
            }"
          >
            净电力 <strong>{{ importPowerPreview.net }}</strong>
          </span>
        </div>
        <a-alert
          v-if="importLossWarnings.length"
          class="simulator-import-warning"
          message="确认后将截断以下干员配置"
          show-icon
          type="warning"
        >
          <template #description>
            <div v-for="detail in importLossWarnings" :key="detail">
              {{ detail }}
            </div>
          </template>
        </a-alert>
        <div class="simulator-import-layout-panel">
          <div class="simulator-import-layout-heading">
            <strong>设施布局</strong>
            <span class="simulator-layout-add-hint">与排班模拟器保持一致</span>
          </div>
          <ScheduleLayoutEditor
            :delete-disabled-room-types="['control']"
            :facility-colors="facilityColors"
            :layout="importDraft.layout"
            :layout-text-help="layoutTextHint"
            @add-layout="addImportLayoutEntry"
            @apply-layout-text="applyImportLayoutText"
            @remove-layout="removeImportLayoutEntry"
            @update-layout-level="updateImportFacilityLevel"
          />
        </div>
      </template>
    </a-modal>

    <a-modal
      v-model:open="deleteScheduleModalOpen"
      cancel-text="取消"
      ok-text="删除"
      ok-type="danger"
      title="确认删除排班表"
      @cancel="closeDeleteScheduleModal"
      @ok="confirmDeleteSchedule"
    >
      <p>确定删除“{{ pendingDeleteSchedule?.title ?? "未命名排班表" }}”吗？</p>
    </a-modal>

    <a-modal
      v-model:open="imageExportModalOpen"
      :footer="null"
      title="排班表图片预览"
      :width="1180"
      wrap-class-name="simulator-image-export-modal"
      @cancel="closeImageExport"
    >
      <div class="simulator-image-export-toolbar">
        <a-radio-group
          :value="imageExportPreviewWidthMode"
          button-style="solid"
          @change="updateImageExportPreviewWidthMode"
        >
          <a-radio-button value="scroll">滚动</a-radio-button>
          <a-radio-button value="overflow">溢出</a-radio-button>
        </a-radio-group>
        <a-radio-group
          :value="imageExportPreviewZoom"
          button-style="solid"
          @change="updateImageExportPreviewZoom"
        >
          <a-radio-button value="auto">自动</a-radio-button>
          <a-radio-button :value="0.5">0.5x</a-radio-button>
          <a-radio-button :value="1">1x</a-radio-button>
          <a-radio-button :value="2">2x</a-radio-button>
        </a-radio-group>
        <a-radio-group
          :value="imageExportResolution"
          button-style="solid"
          @change="updateImageExportResolution"
        >
          <a-radio-button
            v-for="resolution in SCHEDULE_IMAGE_RESOLUTIONS"
            :key="resolution.key"
            :value="resolution.key"
          >
            {{ resolution.label }}
          </a-radio-button>
        </a-radio-group>
        <a-button
          :disabled="!imageExportPrepared || imageExportLoading"
          type="primary"
          @click="void downloadImageExport()"
        >
          <template #icon><DownloadOutlined /></template>
          下载 PNG
        </a-button>
      </div>
      <a-alert
        v-if="imageExportError"
        :message="imageExportError"
        show-icon
        type="error"
      />
      <a-spin :spinning="imageExportLoading">
        <div
          ref="imageExportPreviewViewport"
          :class="[
            'simulator-image-export-preview',
            {
              'simulator-image-export-preview--auto':
                imageExportPreviewZoom === 'auto' &&
                imageExportPreviewWidthMode === 'scroll',
              'simulator-image-export-preview--overflow':
                imageExportPreviewWidthMode === 'overflow',
            },
          ]"
        >
          <div
            class="simulator-image-export-preview-zoom"
            :style="imageExportPreviewZoomStyle"
          >
            <div
              class="simulator-image-export-preview-stage"
              :style="imageExportPreviewStageStyle"
            >
              <div
                class="simulator-image-export-preview-content"
                :style="imageExportPreviewContentStyle"
              >
                <div ref="imageExportPreviewMount" />
              </div>
              <a-empty
                v-if="
                  !imageExportPrepared &&
                  !imageExportLoading &&
                  !imageExportError
                "
                class="simulator-image-export-preview-empty"
                description="暂无图片预览"
              />
            </div>
          </div>
        </div>
      </a-spin>
    </a-modal>

    <div
      :class="[
        'simulator-layout',
        { 'simulator-layout--sidebar-hidden': !showScheduleSidebar },
      ]"
    >
      <aside
        v-if="showScheduleSidebar"
        ref="documentSidebar"
        class="simulator-document-sidebar"
      >
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
              aria-label="导入排班表"
              title="导入排班表"
              type="text"
              @click="openFilePicker"
            >
              <template #icon><UploadOutlined /></template>
            </a-button>
            <a-button
              aria-label="导出所有排班表"
              :disabled="!documents.length"
              title="导出所有排班表"
              type="text"
              @click="handleExportAll"
            >
              <template #icon><DownloadOutlined /></template>
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
          <input
            ref="fileInput"
            accept=".json,.txt,application/json,text/plain"
            hidden
            type="file"
            @change="handleFileChange"
          />
          <a-input
            v-model:value="scheduleSearchQuery"
            allow-clear
            class="simulator-document-search"
            placeholder="搜索排班表名称或标签"
          >
            <template #prefix><SearchOutlined /></template>
          </a-input>
          <div
            v-if="availableScheduleTags.length"
            class="simulator-tag-filters"
          >
            <div
              v-for="group in scheduleTagGroups"
              :key="group.group"
              class="simulator-tag-filter-group"
            >
              <a-tag
                v-for="tag in group.tags"
                :key="tag.label"
                :aria-checked="selectedScheduleTags.includes(tag.label)"
                :class="{
                  'simulator-tag-filter--selected':
                    selectedScheduleTags.includes(tag.label),
                }"
                :color="tag.category === 'custom' ? undefined : 'blue'"
                role="checkbox"
                tabindex="0"
                @click="
                  setScheduleTagFilter(
                    tag.label,
                    !selectedScheduleTags.includes(tag.label),
                  )
                "
                @keydown.enter.prevent="
                  setScheduleTagFilter(
                    tag.label,
                    !selectedScheduleTags.includes(tag.label),
                  )
                "
                @keydown.space.prevent="
                  setScheduleTagFilter(
                    tag.label,
                    !selectedScheduleTags.includes(tag.label),
                  )
                "
              >
                {{ tag.label }}
              </a-tag>
            </div>
          </div>
        </div>
        <div class="simulator-document-list">
          <div
            v-for="document in filteredDocuments"
            :key="document.id"
            :class="[
              'simulator-document-item',
              {
                'simulator-document-item--active': isStoredDocument(document),
                'simulator-document-item--drag-over-before':
                  dragOverDocumentId === document.id &&
                  dragOverDocumentPosition === 'before',
                'simulator-document-item--drag-over-after':
                  dragOverDocumentId === document.id &&
                  dragOverDocumentPosition === 'after',
                'simulator-document-item--dragging':
                  draggedDocumentId === document.id,
              },
            ]"
            :data-schedule-document-id="document.id"
            role="button"
            tabindex="0"
            @click="handleDocumentItemClick($event, document.id)"
            @contextmenu.stop.prevent="
              openScheduleDocumentContextMenu($event, document.id)
            "
            @keydown.enter="selectDocument(document.id)"
            @keydown.space.prevent="selectDocument(document.id)"
            @pointerdown="beginDocumentDrag($event, document.id)"
          >
            <div class="simulator-document-item-main">
              <span class="simulator-document-item-title">{{
                document.document.title || "未命名排班表"
              }}</span>
            </div>
          </div>
          <a-empty
            v-if="!documents.length"
            :image="undefined"
            description="暂无排班表"
          />
          <div
            v-else-if="!filteredDocuments.length"
            class="simulator-document-empty"
          >
            <a-empty :image="undefined" description="没有匹配的排班表" />
            <a-space>
              <a-button
                @click="
                  scheduleSearchQuery = '';
                  selectedScheduleTags = [];
                "
              >
                清空筛选
              </a-button>
              <a-button type="primary" @click="openFilePicker">
                导入排班表
              </a-button>
            </a-space>
          </div>
        </div>
      </aside>

      <main v-if="currentDocument" class="simulator-editor">
        <a-card :bordered="false" class="simulator-meta-panel">
          <div class="simulator-panel-heading">
            <div>
              <span class="simulator-eyebrow">SIMULATOR</span>
              <h3>排班表信息</h3>
            </div>
          </div>
          <div class="simulator-meta-grid">
            <div class="simulator-meta-field">
              <label class="simulator-meta-label" for="simulator-meta-title"
                >名称</label
              >
              <a-input
                id="simulator-meta-title"
                class="simulator-meta-single-line-input"
                :value="currentDocument.title ?? ''"
                @update:value="(value: string) => updateMeta('title', value)"
              />
            </div>
            <div class="simulator-meta-field">
              <label
                class="simulator-meta-label"
                for="simulator-meta-description"
                >描述</label
              >
              <a-textarea
                id="simulator-meta-description"
                :auto-size="{ minRows: 1 }"
                :value="currentDocument.description ?? ''"
                @update:value="
                  (value: string) => updateMeta('description', value)
                "
              />
            </div>
            <div class="simulator-meta-field">
              <span id="simulator-meta-tags" class="simulator-meta-label"
                >标签</span
              >
              <a-select
                aria-labelledby="simulator-meta-tags"
                :open="false"
                :search-value="scheduleTagInput"
                :value="currentScheduleTags.map((tag) => tag.label)"
                mode="tags"
                placeholder="输入标签后按 Enter 添加"
                show-search
                @deselect="deselectScheduleTag"
                @keydown="handleScheduleTagKeydown"
                @search="(value: string) => (scheduleTagInput = value)"
              >
                <template #tagRender="{ value, closable, onClose }">
                  <a-tag
                    :color="
                      currentScheduleTags.find((tag) => tag.label === value)
                        ?.automatic
                        ? 'blue'
                        : undefined
                    "
                    :closable="closable"
                    @mousedown.prevent.stop
                    @close="onClose"
                  >
                    {{ value }}
                  </a-tag>
                </template>
              </a-select>
            </div>
          </div>
          <div aria-label="编辑选项" class="simulator-edit-settings">
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
              :checked="currentTimedQueueEnabled"
              :disabled="!currentSimulatorEditSettings.queue"
              @change="
                (event: { target: { checked: boolean } }) =>
                  updateTimedQueueSetting(event.target.checked)
              "
            >
              定时换班
            </a-checkbox>
            <a-popconfirm
              cancel-text="取消"
              ok-text="确认恢复"
              title="确认将该排班表中所有干员恢复到默认练度？"
              @confirm="resetAllOperatorProgression"
            >
              <a-button size="small" title="恢复该排班表中所有干员的默认练度">
                <template #icon><ReloadOutlined /></template>
                恢复默认练度
              </a-button>
            </a-popconfirm>
          </div>
        </a-card>

        <a-card
          v-if="currentSimulatorEditSettings.layout"
          :bordered="false"
          class="simulator-layout-panel"
          title="设施布局"
        >
          <ScheduleLayoutEditor
            :facility-colors="facilityColors"
            :delete-disabled-room-types="['control']"
            :layout="currentDocument.layout"
            :layout-preset-will-remove-operators="
              layoutPresetWillRemoveOperators
            "
            :layout-text-help="layoutTextHint"
            :show-layout-presets="true"
            @add-layout="addLayoutEntry"
            @apply-layout-text="applyLayoutText"
            @remove-layout="removeLayoutEntry"
            @update-layout-level="updateLayoutLevel"
          />
          <div class="simulator-power-summary">
            <span class="simulator-summary-label">电力</span>
            <a-tag color="orange">消耗 {{ powerSummary.used }}</a-tag>
            <a-tag color="green">提供 {{ powerSummary.provided }}</a-tag>
            <a-tag :color="powerSummary.net < 0 ? 'red' : 'cyan'">
              净 {{ powerSummary.net >= 0 ? "+" : "" }}{{ powerSummary.net }}
            </a-tag>
          </div>
        </a-card>

        <a-row
          ref="operatorGridComponent"
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
                      <div
                        v-if="currentTimedQueueEnabled"
                        class="simulator-queue-period-inputs"
                      >
                        <a-input
                          :maxlength="5"
                          :value="timedQueueDraftFor(plan, planIndex).start"
                          class="simulator-queue-period-input"
                          placeholder="开始 HH:mm"
                          size="small"
                          @update:value="
                            (value: string) =>
                              updateTimedQueueDraft(planIndex, 'start', value)
                          "
                        />
                        <span>至</span>
                        <a-input
                          :maxlength="5"
                          :value="timedQueueDraftFor(plan, planIndex).end"
                          class="simulator-queue-period-input"
                          placeholder="结束 HH:mm"
                          size="small"
                          @update:value="
                            (value: string) =>
                              updateTimedQueueDraft(planIndex, 'end', value)
                          "
                        />
                      </div>
                      <a-input-number
                        v-else
                        :max="24"
                        :min="1"
                        :value="planDurationHoursValue(plan)"
                        addon-after="小时"
                        class="simulator-queue-duration simulator-queue-duration-editor"
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
                        {{
                          formatDurationHours(
                            displayedPlanDurationHours(plan, planIndex),
                          )
                        }}
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
            :data-facility-key="row.key"
            :data-facility-type="row.type"
            :data-fiammetta="row.isFiammetta ? 'true' : undefined"
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
                    v-if="!row.isFiammetta && showsFacilityLevelTags(row.type)"
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
                  v-show="
                    !row.isFiammetta ||
                    fiammettaMode(currentDocument) === 'queue' ||
                    planIndex === 0
                  "
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
                        :data-export-original-name="
                          slotCommittedName(row, plan, slot)
                        "
                        :data-export-plan-index="planIndex"
                        :data-export-position="slot.entry.position"
                        :data-export-room-type="row.type"
                        :data-export-slot-index="slot.slotIndex"
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
                        <ScheduleOperatorSlotContent
                          :display-name="slotName(row, plan, planIndex, slot)"
                          :elite-level="
                            operatorElite(
                              slotRoom(plan, slot),
                              slotCommittedName(row, plan, slot),
                              row.type,
                            )
                          "
                          :empty-slot-frame-style="emptySlotFrameStyle"
                          :mood-remaining="
                            slotOperator(row, plan, planIndex, slot)
                              ? operatorMoodRemaining(
                                  planIndex,
                                  row.type,
                                  slot.entry.position,
                                  slot.slotIndex,
                                )
                              : undefined
                          "
                          :mood-scattered="
                            slotOperator(row, plan, planIndex, slot)
                              ? operatorQueueMoodScattered(
                                  planIndex,
                                  row.type,
                                  slot.entry.position,
                                  slot.slotIndex,
                                  slotRoom(plan, slot),
                                  slotCommittedName(row, plan, slot),
                                )
                              : false
                          "
                          :missing="
                            slotOperator(row, plan, planIndex, slot)
                              ? operatorMissing(
                                  slotRoom(plan, slot),
                                  slotCommittedName(row, plan, slot),
                                )
                              : false
                          "
                          :name-band-style="slotNameBandStyle"
                          :name-input-pending="
                            !isEditingOperatorSlot(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            )
                          "
                          :name-input-value="
                            slotName(row, plan, planIndex, slot)
                          "
                          :name-input-visible="
                            isOperatorNameInputVisible(
                              operatorSlotAddress(
                                planIndex,
                                row.type,
                                slot.entry.position,
                                slot.slotIndex,
                              ),
                            )
                          "
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
                          :operator-owned="
                            slotOperator(row, plan, planIndex, slot)
                              ? operatorOwned(
                                  slotRoom(plan, slot),
                                  slotCommittedName(row, plan, slot),
                                )
                              : true
                          "
                          :operator-training-upgraded="
                            slotOperator(row, plan, planIndex, slot)
                              ? operatorTrainingUpgraded(
                                  slotRoom(plan, slot),
                                  slotCommittedName(row, plan, slot),
                                  row.type,
                                )
                              : false
                          "
                          :operator="slotOperator(row, plan, planIndex, slot)"
                          :room-label="row.label"
                          :room-type="row.type"
                          :size="simulatorSlotSize"
                          :skipped="
                            roomSkipped(slotRoom(plan, slot)) &&
                            (Boolean(
                              slotSpecialAvatarLabel(
                                row,
                                plan,
                                planIndex,
                                slot,
                              ),
                            ) ||
                              !operatorMissing(
                                slotRoom(plan, slot),
                                slotCommittedName(row, plan, slot),
                              ))
                          "
                          :skipped-label-style="skippedLabelStyle"
                          :slot-key="
                            operatorSlotAddress(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            ).key
                          "
                          :special-label="
                            slotSpecialAvatarLabel(row, plan, planIndex, slot)
                          "
                          @blur="
                            commitOperatorName(
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @click="
                            selectOperatorSlot(
                              $event,
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @contextmenu="
                            slotOperator(row, plan, planIndex, slot)
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
                                )
                          "
                          @dblclick="
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
                          @input="
                            handleOperatorNameInput(
                              $event,
                              planIndex,
                              row.type,
                              slot.entry.position,
                              slot.slotIndex,
                            )
                          "
                          @input-click="
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
                          @keyup="handleOperatorNameSelection"
                          @mouseup="handleOperatorNameSelection"
                          @select="handleOperatorNameSelection"
                        />
                      </div>
                    </div>
                    <div class="simulator-efficiency-summary">
                      <div
                        class="simulator-efficiency-summary-line simulator-efficiency-summary-line--total"
                      >
                        <img
                          v-if="
                            maaDroneOrderForFacility(row, planIndex) === 'pre'
                          "
                          alt=""
                          aria-hidden="true"
                          class="simulator-efficiency-summary-drone-icon simulator-efficiency-summary-drone-icon--pre"
                          :src="LABOR_ICON_URL"
                        />
                        <strong
                          v-if="planFacilityResult(row, planIndex)"
                          :style="efficiencySummaryStyle(row, planIndex)"
                        >
                          <SimulatorNumericValue
                            mode="efficiency"
                            :value="
                              planFacilityResult(row, planIndex)
                                ?.operatorSkillEfficiency ?? 0
                            "
                            unit="%"
                          />%
                          <span aria-hidden="true"> / </span>
                          <SimulatorNumericValue
                            mode="efficiency"
                            :value="
                              planFacilityResult(row, planIndex)?.efficiency ??
                              0
                            "
                            unit="%"
                          />%
                        </strong>
                        <img
                          v-if="
                            maaDroneOrderForFacility(row, planIndex) === 'post'
                          "
                          alt=""
                          aria-hidden="true"
                          class="simulator-efficiency-summary-drone-icon simulator-efficiency-summary-drone-icon--post"
                          :src="LABOR_ICON_URL"
                        />
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
            :display-name="operatorDragPreview.name"
            :elite-level="
              operatorDragPreview.operator
                ? operatorElite(
                    operatorDragPreview.room,
                    operatorDragPreview.name,
                    operatorDragPreview.type,
                  )
                : 0
            "
            :operator="operatorDragPreview.operator"
            :special-label="operatorDragPreview.specialLabel"
            :operator-owned="
              operatorDragPreview.operator
                ? operatorOwned(
                    operatorDragPreview.room,
                    operatorDragPreview.name,
                  )
                : true
            "
            :missing="
              operatorDragPreview.operator
                ? operatorMissing(
                    operatorDragPreview.room,
                    operatorDragPreview.name,
                  )
                : false
            "
            :mood-scattered="
              operatorDragPreview.operator
                ? operatorQueueMoodScattered(
                    operatorDragPreview.planIndex,
                    operatorDragPreview.type,
                    operatorDragPreview.position,
                    operatorDragPreview.slotIndex,
                    operatorDragPreview.room,
                    operatorDragPreview.name,
                  )
                : false
            "
            :mood-remaining="
              operatorDragPreview.operator
                ? operatorMoodRemaining(
                    operatorDragPreview.planIndex,
                    operatorDragPreview.type,
                    operatorDragPreview.position,
                    operatorDragPreview.slotIndex,
                  )
                : undefined
            "
            :operator-training-upgraded="
              operatorDragPreview.operator
                ? operatorTrainingUpgraded(
                    operatorDragPreview.room,
                    operatorDragPreview.name,
                    operatorDragPreview.type,
                  )
                : false
            "
            :show-elite-level="Boolean(operatorDragPreview.operator)"
            :show-name="Boolean(operatorDragPreview.operator)"
            :show-profession="Boolean(operatorDragPreview.operator)"
            :show-rarity="Boolean(operatorDragPreview.operator)"
            :plain="true"
            :proportional-layout="true"
            :size="simulatorSlotSize"
            :skipped="
              Boolean(operatorDragPreview.operator) &&
              roomSkipped(operatorDragPreview.room) &&
              !operatorMissing(
                operatorDragPreview.room,
                operatorDragPreview.name,
              )
            "
          />
          <span
            v-if="operatorDragPreview.count > 1"
            :style="{
              '--simulator-operator-drag-preview-avatar-center': `${simulatorSlotSize / 2}px`,
              '--simulator-operator-drag-preview-avatar-size': `${simulatorSlotSize}px`,
            }"
            class="simulator-operator-drag-preview-count"
            >×{{ operatorDragPreview.count }}</span
          >
        </div>

        <ScheduleOperatorPicker
          v-if="operatorPicker"
          ref="operatorPickerElement"
          :avatar-size="simulatorSlotSize"
          :candidates="operatorPickerCandidateViews"
          :profession-options="operatorPickerProfessionOptions"
          :selected-profession="selectedOperatorPickerProfession"
          :style="[operatorPickerStyle, slotGridStyle, operatorPickerGridStyle]"
          :title="
            operatorPicker.position === FIAMMETTA_POSITION
              ? '菲亚梅塔'
              : ROOM_LABELS[operatorPicker.type]
          "
          class="simulator-operator-picker-positioned"
          @outside="closeOperatorPicker"
          @select="selectOperatorPickerCandidate"
          @update:selected-profession="
            selectedOperatorPickerProfession = $event
          "
        />

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
          v-if="scheduleDocumentContextMenu"
          ref="scheduleDocumentContextMenuElement"
          class="simulator-context-menu simulator-schedule-document-context-menu"
          :style="scheduleDocumentContextMenuStyle()"
          @click="closeContextMenu"
        >
          <a-menu :selectable="false">
            <a-menu-item
              @click="handleDuplicate(scheduleDocumentContextMenu?.documentId)"
            >
              复制排班表
            </a-menu-item>
            <a-menu-item
              danger
              @click="
                openDeleteScheduleModal(scheduleDocumentContextMenu?.documentId)
              "
            >
              删除排班表
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item
              @click="handleExport(scheduleDocumentContextMenu?.documentId)"
            >
              导出 Maa JSON
            </a-menu-item>
            <a-menu-item
              @click="
                void handleExportImage(scheduleDocumentContextMenu?.documentId)
              "
            >
              导出预览
            </a-menu-item>
          </a-menu>
        </div>

        <a-modal
          v-model:open="efficiencySettingsModalOpen"
          :footer="null"
          title="计算设置"
        >
          <a-form layout="vertical">
            <a-form-item label="回收站加速材料">
              <a-select
                :value="currentEfficiencySettings.recycleBoostItemId"
                :options="recycleBoostSelectOptions"
                allow-clear
                option-label-prop="label"
                placeholder="不加速"
                @update:value="updateRecycleBoostItem"
              >
                <template #option="{ value }">
                  <div class="simulator-recycle-boost-option">
                    <img
                      v-if="recycleBoostOption(value)"
                      :alt="recycleBoostOption(value)?.name ?? ''"
                      :src="
                        dailyOutputIconUrl(
                          recycleBoostOption(value)?.name ?? '',
                        )
                      "
                    />
                    <div class="simulator-recycle-boost-name">
                      {{ recycleBoostOption(value)?.name }}
                    </div>
                    <div class="simulator-recycle-boost-values">
                      <small>
                        {{
                          formatEfficiencyNumber(
                            (recycleBoostOption(value)?.addedTime ?? 0) / 3600,
                          )
                        }}
                        小时
                      </small>
                      <small>
                        {{
                          recycleBoostOption(value)?.sanity === null
                            ? "未设置理智"
                            : `${formatEfficiencyNumber(recycleBoostOption(value)?.sanity ?? 0)} 理智`
                        }}
                      </small>
                      <small>
                        {{
                          recycleBoostOption(value)?.sanity === null
                            ? "—"
                            : recycleBoostOption(value)?.sanity === 0
                              ? "∞"
                              : formatEfficiencyNumber(
                                  (recycleBoostOption(value)?.addedTime ?? 0) /
                                    3600 /
                                    (recycleBoostOption(value)?.sanity ?? 1),
                                )
                        }}
                        h/理智
                      </small>
                    </div>
                  </div>
                </template>
              </a-select>
            </a-form-item>
            <a-form-item>
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
                处于线索交流（影响“跃跃”等干员技能）
              </a-checkbox>
            </a-form-item>
            <a-form-item>
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
                宿舍按满员计算（影响“迷迭香”、“塑心”等干员技能）
              </a-checkbox>
            </a-form-item>
            <a-form-item>
              <a-checkbox
                :checked="currentEfficiencySettings.simulateOverflow"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    updateEfficiencyOverflowSetting(event.target.checked)
                "
              >
                爆仓后截断计算（不包含使用 MAA 换班方式的爆仓模拟）
              </a-checkbox>
            </a-form-item>
            <a-form-item>
              <a-checkbox
                :checked="currentEfficiencySettings.simulateDroneOverflow"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    updateEfficiencyDroneOverflowSetting(event.target.checked)
                "
              >
                MAA 换班方式无人机爆仓后截断计算
              </a-checkbox>
            </a-form-item>
            <a-form-item>
              <a-checkbox
                :checked="currentEfficiencySettings.preferMaxJieEfficiency"
                @change="
                  (event: { target: { checked: boolean } }) =>
                    updateEfficiencyJieMode(event.target.checked)
                "
              >
                精0孑按最高效率计算
              </a-checkbox>
            </a-form-item>
            <a-form-item label="首件进度（影响爆仓时间以及精0孑平均效率）">
              <a-input-number
                :max="100"
                :min="0"
                :step="1"
                :value="currentEfficiencySettings.firstItemProgress"
                addon-after="%"
                @update:value="updateEfficiencyFirstItemProgress"
              />
            </a-form-item>
            <a-form-item label="菲亚梅塔模式">
              <a-radio-group
                :value="currentEfficiencySettings.fiammettaMode"
                @change="
                  (event: { target: { value: FiammettaMode } }) =>
                    updateFiammettaMode(event.target.value)
                "
              >
                <a-radio value="direct">直接互换心情</a-radio>
                <a-radio value="queue">队列互换心情</a-radio>
              </a-radio-group>
            </a-form-item>
            <a-form-item
              v-if="currentEfficiencySettings.fiammettaMode === 'direct'"
              label="可互换人数"
            >
              <a-input-number
                :min="0"
                :precision="0"
                :step="1"
                :value="currentEfficiencySettings.fiammettaDirectCount"
                @update:value="updateFiammettaDirectCount"
              />
            </a-form-item>
          </a-form>
        </a-modal>

        <a-modal
          v-model:open="recycleOutputDetailsOpen"
          :footer="null"
          title="回收站材料产量"
        >
          <a-form class="simulator-recycle-output-settings" layout="vertical">
            <a-form-item label="统计天数">
              <a-input-number
                :min="0"
                :step="1"
                :value="recycleOutputDays"
                @update:value="
                  (value: number | null) => (recycleOutputDays = value ?? 0)
                "
              />
            </a-form-item>
            <a-form-item label="分组方式">
              <a-segmented
                v-model:value="recycleOutputGrouping"
                :options="RECYCLE_OUTPUT_GROUP_OPTIONS"
              />
            </a-form-item>
          </a-form>
          <div class="simulator-recycle-output-list">
            <div
              v-for="item in recycleOutputDisplayRows"
              :key="item.key"
              class="simulator-recycle-output-row"
            >
              <img
                :alt="item.iconName"
                :src="dailyOutputIconUrl(item.iconName)"
              />
              <div class="simulator-recycle-output-detail">
                <span>{{ item.label }}</span>
                <div class="simulator-recycle-output-values">
                  <small
                    >{{ recycleOutputAmount(item.amountPerDay) }} 件/天</small
                  >
                  <strong>
                    {{
                      recycleOutputAmount(item.amountPerDay * recycleOutputDays)
                    }}
                    件
                  </strong>
                </div>
              </div>
            </div>
          </div>
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

        <a-card :bordered="false" class="simulator-efficiency-panel">
          <template #title>
            <div class="simulator-efficiency-panel-title">
              <span>计算结果</span>
              <a-tooltip title="计算设置">
                <a-button
                  aria-label="计算设置"
                  size="small"
                  type="text"
                  @click="efficiencySettingsModalOpen = true"
                >
                  <SettingOutlined />
                </a-button>
              </a-tooltip>
            </div>
          </template>
          <a-alert
            v-if="
              efficiencyError &&
              isEfficiencyNoticeVisible('efficiency-data-error')
            "
            :description="efficiencyError"
            message="效率数据读取失败"
            show-icon
            type="error"
          />
          <a-alert
            v-else-if="efficiencyLoading"
            message="正在读取干员技能数据并计算效率"
            show-icon
            type="info"
          />
          <template v-else-if="efficiencyResult && resultDisplay">
            <div class="simulator-daily-output">
              <div class="simulator-result-section-heading">
                <div>
                  <span class="simulator-eyebrow">DAILY OUTPUT</span>
                  <h3>{{ resultDisplay.dailyOutput.label }}</h3>
                </div>
                <a-tag color="blue"
                  >循环
                  <SimulatorDisplayValue
                    :value="resultDisplay.dailyOutput.cycleHours"
                /></a-tag>
              </div>
              <div
                v-if="resultDisplay.dailyOutput.tiles.length"
                class="simulator-daily-output-grid"
              >
                <SimulatorDisplayTile
                  v-for="tile in resultDisplay.dailyOutput.tiles"
                  :key="tile.key"
                  :accent="displayTileAccent(tile)"
                  :icon="displayTileIconUrl(tile)"
                  :interactive="
                    tile.product === RECYCLE_OUTPUT_PRODUCT &&
                    recycleOutputItems.length > 0
                  "
                  :tile="tile"
                  @activate="openRecycleOutputDetails"
                />
                <div
                  v-if="resultDisplay.dailyOutput.totalTile"
                  class="simulator-daily-output-item"
                >
                  <img
                    :alt="'理智'"
                    :src="sanityIconUrl()"
                    class="simulator-daily-output-icon"
                  />
                  <strong class="simulator-daily-output-main-value">
                    <SimulatorDisplayValue
                      :value="resultDisplay.dailyOutput.totalTile.main"
                    />
                  </strong>
                </div>
              </div>
              <a-empty
                v-else
                :description="resultDisplay.dailyOutput.empty"
                :image="undefined"
              />
              <a-alert
                v-if="resultDisplay.dailyOutput.warning"
                :message="resultDisplay.dailyOutput.warning"
                show-icon
                type="warning"
              />
            </div>

            <div
              v-if="droneAccelerationVisible"
              class="simulator-drone-acceleration"
            >
              <div class="simulator-result-section-heading">
                <div>
                  <span class="simulator-eyebrow">DRONE ACCELERATION</span>
                  <h3>{{ resultDisplay.droneStrategy.label }}</h3>
                </div>
              </div>
              <div
                v-if="lmdDroneFacilityExists"
                class="simulator-drone-strategy"
              >
                <a-form-item :label="resultDisplay.droneStrategy.inputLabel">
                  <a-input
                    :placeholder="resultDisplay.droneStrategy.placeholder"
                    :value="lmdDroneStrategyDraft"
                    @blur="commitLmdDroneStrategy"
                    @press-enter="commitLmdDroneStrategy"
                    @update:value="updateLmdDroneStrategyDraft"
                  />
                </a-form-item>
                <span class="simulator-result-hint">{{
                  resultDisplay.droneStrategy.hint
                }}</span>
              </div>
              <a-alert
                v-if="resultDisplay.droneStrategy.strategyError"
                :message="resultDisplay.droneStrategy.strategyError"
                show-icon
                type="error"
              />
              <div
                v-if="resultDisplay.droneScenarios.length"
                class="simulator-drone-scenarios"
              >
                <div
                  v-for="entry in resultDisplay.droneScenarios"
                  :key="entry.key"
                  class="simulator-drone-scenario"
                >
                  <div class="simulator-drone-scenario-heading">
                    <strong>
                      <SimulatorDisplayValue :value="entry.title" />
                    </strong>
                    <span>
                      <SimulatorDisplayValue :value="entry.meta" />
                    </span>
                    <span
                      v-for="(rate, index) in entry.baseRateLines ?? [
                        entry.baseRate,
                      ]"
                      :key="index"
                      class="simulator-drone-scenario-rate"
                    >
                      <SimulatorDisplayValue :value="rate" />
                    </span>
                  </div>
                  <div
                    v-for="view in entry.views"
                    :key="view.key"
                    class="simulator-drone-view"
                  >
                    <div class="simulator-drone-view-heading">
                      <strong>{{ view.label }}</strong>
                    </div>
                    <div
                      v-if="view.tiles.length"
                      class="simulator-daily-output-grid simulator-drone-output-grid"
                    >
                      <SimulatorDisplayTile
                        v-for="tile in view.tiles"
                        :key="tile.key"
                        :accent="displayTileAccent(tile)"
                        :icon="displayTileIconUrl(tile)"
                        :tile="tile"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <a-empty
                v-else-if="
                  lmdDroneFacilityExists &&
                  !resultDisplay.droneStrategy.strategyError
                "
                :description="resultDisplay.droneStrategy.empty"
                :image="undefined"
              />
            </div>

            <div class="simulator-calculation-steps">
              <div class="simulator-result-section-heading">
                <div>
                  <span class="simulator-eyebrow">CALCULATION STEPS</span>
                  <h3>{{ resultDisplay.calculationSteps.label }}</h3>
                </div>
                <span class="simulator-result-hint">{{
                  resultDisplay.calculationSteps.hint
                }}</span>
              </div>
              <a-collapse v-model:active-key="calculationStepActiveKeys" ghost>
                <a-collapse-panel
                  v-if="resultDisplay.calculationSteps.maaDrone"
                  key="maa-drone-acceleration"
                >
                  <template #header>
                    <div class="simulator-step-header">
                      <span>{{
                        resultDisplay.calculationSteps.maaDrone.label
                      }}</span>
                      <span class="simulator-result-hint">
                        <SimulatorDisplayValue
                          v-if="resultDisplay.calculationSteps.maaDrone.hint"
                          :value="resultDisplay.calculationSteps.maaDrone.hint"
                        />
                      </span>
                    </div>
                  </template>
                  <div class="simulator-calculation-step-columns">
                    <div
                      v-for="card in resultDisplay.calculationSteps.maaDrone
                        .cards"
                      :key="card.key"
                      class="simulator-calculation-step-column"
                    >
                      <div class="simulator-calculation-step-column-header">
                        <span>
                          <SimulatorDisplayValue :value="card.title" />
                          <small v-if="card.subtitle">
                            <SimulatorDisplayValue :value="card.subtitle" />
                          </small>
                        </span>
                        <strong v-if="card.badge">
                          <SimulatorDisplayValue :value="card.badge" />
                        </strong>
                      </div>
                      <SimulatorDisplayCard
                        :card="card"
                        :icon-url="dailyOutputIconUrl"
                        :sanity-icon="sanityIconUrl()"
                      />
                    </div>
                  </div>
                </a-collapse-panel>
                <a-collapse-panel
                  v-if="resultDisplay.calculationSteps.dailyOutput"
                  key="daily-output-breakdown"
                >
                  <template #header>
                    <div class="simulator-step-header">
                      <span>{{
                        resultDisplay.calculationSteps.dailyOutput.label
                      }}</span>
                      <span
                        v-if="resultDisplay.calculationSteps.dailyOutput.hint"
                        class="simulator-result-hint"
                      >
                        <SimulatorDisplayValue
                          :value="
                            resultDisplay.calculationSteps.dailyOutput.hint
                          "
                        />
                      </span>
                    </div>
                  </template>
                  <div class="simulator-calculation-step-columns">
                    <div
                      v-for="card in resultDisplay.calculationSteps.dailyOutput
                        .cards"
                      :key="card.key"
                      class="simulator-calculation-step-column"
                    >
                      <div class="simulator-calculation-step-column-header">
                        <span>
                          <SimulatorDisplayValue :value="card.title" />
                          <small v-if="card.subtitle">
                            <SimulatorDisplayValue :value="card.subtitle" />
                          </small>
                        </span>
                        <strong v-if="card.badge">
                          <SimulatorDisplayValue :value="card.badge" />
                        </strong>
                      </div>
                      <SimulatorDisplayCard
                        :card="card"
                        :icon-url="dailyOutputIconUrl"
                        :sanity-icon="sanityIconUrl()"
                      />
                    </div>
                  </div>
                </a-collapse-panel>
                <a-collapse-panel
                  v-if="resultDisplay.calculationSteps.basePoints"
                  key="base-points"
                >
                  <template #header>
                    <div class="simulator-step-header">
                      <span>{{
                        resultDisplay.calculationSteps.basePoints.label
                      }}</span>
                    </div>
                  </template>
                  <div class="simulator-calculation-step-columns">
                    <div
                      v-for="column in resultDisplay.calculationSteps.basePoints
                        .columns"
                      :key="column.key"
                      class="simulator-calculation-step-column"
                    >
                      <div class="simulator-calculation-step-column-header">
                        <span>
                          <SimulatorDisplayValue :value="column.title" />
                          <small v-if="column.subtitle">
                            <SimulatorDisplayValue :value="column.subtitle" />
                          </small>
                        </span>
                      </div>
                      <div class="simulator-step-content">
                        <div class="simulator-base-point-grid">
                          <div
                            v-for="point in column.points"
                            :key="point.key"
                            class="simulator-base-point-item"
                          >
                            <div class="simulator-base-point-value">
                              <span>
                                <SimulatorDisplayValue :value="point.name" />
                              </span>
                              <strong>
                                <SimulatorDisplayValue :value="point.value" />
                              </strong>
                            </div>
                            <div class="simulator-base-point-sources">
                              <div
                                v-for="source in point.sources"
                                :key="source.key"
                                class="simulator-base-point-source"
                              >
                                <span>
                                  <SimulatorDisplayValue
                                    :value="source.label"
                                  />
                                </span>
                                <strong>
                                  <SimulatorDisplayValue
                                    :value="source.value"
                                  />
                                </strong>
                              </div>
                            </div>
                          </div>
                          <span
                            v-if="!column.points.length"
                            class="simulator-step-column-empty"
                            >{{ column.empty }}</span
                          >
                        </div>
                      </div>
                    </div>
                  </div>
                </a-collapse-panel>
                <template v-if="calculationStepDisplayMode === 'facility'">
                  <a-collapse-panel
                    v-for="pane in facilityStepPanes"
                    :key="pane.key"
                  >
                    <template #header>
                      <div class="simulator-step-header">
                        <span>{{ pane.label }}</span>
                        <small v-if="pane.badge">
                          <SimulatorDisplayValue :value="pane.badge" />
                        </small>
                      </div>
                    </template>
                    <div class="simulator-calculation-step-columns">
                      <div
                        v-for="card in pane.cards"
                        :key="card.key"
                        class="simulator-calculation-step-column"
                      >
                        <div class="simulator-calculation-step-column-header">
                          <span>
                            <SimulatorDisplayValue :value="card.title" />
                            <small v-if="card.subtitle">
                              <SimulatorDisplayValue :value="card.subtitle" />
                            </small>
                          </span>
                          <strong v-if="card.badge">
                            <SimulatorDisplayValue :value="card.badge" />
                          </strong>
                        </div>
                        <SimulatorDisplayCard
                          :card="card"
                          :icon-url="dailyOutputIconUrl"
                        />
                      </div>
                    </div>
                  </a-collapse-panel>
                </template>
                <template v-else>
                  <a-collapse-panel
                    v-for="card in facilityStepCards"
                    :key="card.key"
                  >
                    <template #header>
                      <div class="simulator-step-header">
                        <span>
                          <SimulatorDisplayValue :value="card.title" />
                          <small v-if="card.subtitle">
                            <SimulatorDisplayValue :value="card.subtitle" />
                          </small>
                        </span>
                        <strong v-if="card.badge">
                          <SimulatorDisplayValue :value="card.badge" />
                        </strong>
                      </div>
                    </template>
                    <SimulatorDisplayCard
                      :card="card"
                      :icon-url="dailyOutputIconUrl"
                    />
                  </a-collapse-panel>
                </template>
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
              导入排班表
            </a-button>
          </a-space>
        </template>
      </a-empty>
    </div>
  </div>
</template>

<style scoped src="../assets/page-layout.css"></style>
<style scoped src="../assets/simulator.css"></style>
<style scoped src="../assets/schedule-editor.css"></style>
<style src="./styles/simulator-export.css"></style>
