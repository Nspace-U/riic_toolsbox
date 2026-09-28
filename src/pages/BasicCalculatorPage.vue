<script setup lang="ts">
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import {
  computed,
  h,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";

import BasicCalculatorScheduleEditor from "@/components/BasicCalculatorScheduleEditor.vue";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import type { OperatorPickerCandidateView } from "@/components/OperatorPickerPanel.vue";
import { useBaseData } from "@/composables/useBaseData";
import { useFacilityColors } from "@/composables/useFacilityColors";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import type { EliteLevel, Operator } from "@/types/baseData";
import { getRiicEfficiencyCatalog } from "@/adapters/riicEfficiencyData";
import {
  progressionNodesForFacility,
  resolveOperatorProgression,
  type EfficiencyCatalog,
  type OperatorProgressionNode,
  type ResolvedOperatorProgression,
} from "@arknights/riic-efficiency";
import type {
  OperatorState,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import {
  applyBasicCalculatorPatch,
  basicCalculatorOperatorFieldNames,
  basicCalculatorRoomAssignment,
  basicCalculatorScheduleOperators,
  cloneBasicCalculatorConfig,
  compareValues,
  createBasicCalculatorConfig,
  createBasicCalculatorPatch,
  createBasicCalculatorSchedule,
  operatorFieldOptions,
  operatorFieldValues,
  synchronizeBasicCalculatorGroupSchedule,
} from "@/utils/basicCalculator";
import type {
  BasicCalculatorAggregate,
  BasicCalculatorAsset,
  BasicCalculatorColumn,
  BasicCalculatorColumnKind,
  BasicCalculatorConfig,
  BasicCalculatorRowCalculation,
  BasicCalculatorEfficiencyValue,
  BasicCalculatorGroup,
  BasicCalculatorOperator,
  BasicCalculatorPatch,
  BasicCalculatorRow,
  BasicCalculatorWorkerResponse,
} from "@/utils/basicCalculator";
import {
  formatEfficiencyNumber,
  formatNumber,
} from "@/utils/simulator/presentation";
import {
  PRODUCT_REPRESENTATIVE_COLORS,
  ROOM_LABELS,
  ROOM_REPRESENTATIVE_COLORS,
} from "@/utils/schedule";

interface BasicCalculatorRowView {
  group: BasicCalculatorGroup;
  row: BasicCalculatorRow;
  efficiency: Record<string, BasicCalculatorEfficiencyValue>;
  numeric: Record<string, number | undefined>;
  backgroundColor?: string;
}

interface GroupDraft {
  id: string;
  name: string;
  facility: "trading" | "manufacture";
  facilityLevel: number;
  coreOperator: BasicCalculatorOperator;
  columnIds: string[];
  rows: BasicCalculatorRow[];
}

const STORAGE_KEY = "riic-tools:basic-calculator:v4";
const { operators, ready, errorMessage } = useBaseData();
const { facilityColors, productColors } = useFacilityColors();
const {
  activeProfile,
  dormitoryDefaultIncludesMoodRecovery,
  showUnownedOperatorsInPicker,
} = useOperatorProgression();

const defaults = ref<BasicCalculatorConfig>();
const config = ref<BasicCalculatorConfig>();
const catalog = ref<EfficiencyCatalog>();
const loading = ref(true);
const loadError = ref("");
const activeGroupIds = ref<string[]>([]);
const columnModalOpen = ref(false);
const columnSettingsDraft = ref<BasicCalculatorConfig>();
const groupModalOpen = ref(false);
const rowModalOpen = ref(false);
const columnDraft = reactive({
  kind: "efficiency" as BasicCalculatorColumnKind,
  label: "",
  hours: 12,
  path: "",
  aggregate: "list" as BasicCalculatorAggregate,
});
const groupDraft = ref<GroupDraft>();
const rowDraft = ref<BasicCalculatorRow>();
const rowDraftSchedule = ref<ScheduleDocument>();
const rowDraftNote = computed({
  get: () => rowDraftSchedule.value?.plans[0]?.description ?? "",
  set(value: string) {
    const plan = rowDraftSchedule.value?.plans[0];
    if (!plan) return;
    if (value) plan.description = value;
    else delete plan.description;
  },
});
const rowDraftGroupId = ref("");
const rowEditor = ref<InstanceType<typeof BasicCalculatorScheduleEditor>>();
const calculatorWorker = ref<Worker>();
const rowCalculations = ref<Record<string, BasicCalculatorRowCalculation>>({});
const calculationLoading = ref(false);
const calculationError = ref("");
let calculationRequestId = 0;

const operatorByName = computed(
  () => new Map(operators.value.map((operator) => [operator.name, operator])),
);
const operatorOptions = computed(() =>
  [...operators.value]
    .sort((first, second) => {
      const firstOrder = first.implementationOrder ?? -1;
      const secondOrder = second.implementationOrder ?? -1;
      return secondOrder - firstOrder;
    })
    .map((operator) => ({ label: operator.name, value: operator.name })),
);
const rowDraftGroup = computed(() =>
  config.value?.groups.find((group) => group.id === rowDraftGroupId.value),
);
const rowDraftFixedRoomLevels = computed<Partial<Record<RoomKey, number>>>(
  () => {
    const group = rowDraftGroup.value;
    return group
      ? {
          [group.facility]: group.facilityLevel,
        }
      : {};
  },
);
const rowDraftFixedRoomTypes = computed<RoomKey[]>(() => {
  const group = rowDraftGroup.value;
  if (!group) return [];
  return [group.facility];
});
const draftHiddenOperatorOptions = computed<DraftHiddenOperatorOption[]>(() => {
  const group = rowDraftGroup.value;
  const row = rowDraft.value;
  if (!group || !row) return [];
  return basicCalculatorScheduleOperators(
    rowDraftSchedule.value ?? row.schedule,
  ).map((operator) => ({
    operator,
    label: displayOperatorLabel(group, operator),
  }));
});
const draftHiddenOperatorNames = computed(() => {
  const row = rowDraft.value;
  return new Set(row?.hiddenOperators ?? []);
});
const fieldOptions = computed(() =>
  catalog.value ? operatorFieldOptions(catalog.value) : [],
);

interface DraftHiddenOperatorOption {
  operator: BasicCalculatorOperator;
  label: string;
}

function readStoredPatch(): BasicCalculatorPatch | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as BasicCalculatorPatch;
  } catch {
    return undefined;
  }
}

function persistConfig(): void {
  if (!defaults.value || !config.value || typeof window === "undefined") {
    return;
  }
  try {
    const patch = createBasicCalculatorPatch(defaults.value, config.value);
    if (Object.keys(patch).length === 1) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(patch));
  } catch {}
}

function updateConfig(update: (draft: BasicCalculatorConfig) => void): void {
  if (!config.value) return;
  const draft = cloneBasicCalculatorConfig(config.value);
  update(draft);
  config.value = cloneBasicCalculatorConfig(draft);
  persistConfig();
}

async function loadResources(): Promise<void> {
  if (!ready.value || defaults.value) return;
  try {
    const defaultResponse = await fetch(
      `${import.meta.env.BASE_URL}assets/basic-calculator.json`,
    );
    if (!defaultResponse.ok) {
      throw new Error(
        `基础计算器配置读取失败（HTTP ${defaultResponse.status}）`,
      );
    }
    const nextDefaults = createBasicCalculatorConfig(
      (await defaultResponse.json()) as BasicCalculatorAsset,
    );
    defaults.value = nextDefaults;
    config.value = applyBasicCalculatorPatch(nextDefaults, readStoredPatch());
    catalog.value = getRiicEfficiencyCatalog();
    loadError.value = "";
  } catch (error: unknown) {
    loadError.value =
      error instanceof Error ? error.message : "基础计算器读取失败";
  } finally {
    loading.value = false;
  }
}

watch(ready, () => void loadResources(), { immediate: true });
onMounted(() => {
  calculatorWorker.value = new Worker(
    new URL("../workers/basicCalculatorWorker.ts", import.meta.url),
    { type: "module" },
  );
  calculatorWorker.value.onmessage = (
    event: MessageEvent<BasicCalculatorWorkerResponse>,
  ) => {
    const response = event.data;
    if (response.requestId !== calculationRequestId) {
      return;
    }
    calculationLoading.value = false;
    if (response.error) {
      calculationError.value = response.error;
      return;
    }
    calculationError.value = "";
    rowCalculations.value = response.results ?? {};
  };
  calculatorWorker.value.onerror = () => {
    calculationLoading.value = false;
    calculationError.value = "基础计算器后台计算失败";
  };
  void loadResources();
  requestCalculations();
});

onBeforeUnmount(() => {
  calculatorWorker.value?.terminate();
  calculatorWorker.value = undefined;
});

const calculationFingerprint = computed(() => {
  const current = config.value;
  if (!current || !catalog.value) {
    return "";
  }
  return JSON.stringify({
    catalogReady: Boolean(catalog.value),
    columns: current.columns.map((column) => ({
      id: column.id,
      kind: column.kind,
      hours: column.hours,
    })),
    groups: current.groups,
    jieCalculation: current.settings.jieCalculation,
    progressionProfile: activeProfile.value,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  });
});

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requestCalculations(): void {
  const worker = calculatorWorker.value;
  const current = config.value;
  const currentCatalog = catalog.value;
  if (!worker || !current || !currentCatalog) {
    return;
  }
  const requestId = ++calculationRequestId;
  calculationLoading.value = true;
  calculationError.value = "";
  worker.postMessage({
    type: "calculate",
    requestId,
    catalog: cloneSerializable(currentCatalog),
    columns: cloneSerializable(current.columns),
    groups: cloneSerializable(current.groups),
    settings: cloneSerializable(current.settings),
    ...(activeProfile.value
      ? { progressionProfile: cloneSerializable(activeProfile.value) }
      : {}),
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  });
}

watch(calculationFingerprint, () => requestCalculations(), { immediate: true });

function groupColumns(group: BasicCalculatorGroup): BasicCalculatorColumn[] {
  return (config.value?.columns ?? []).filter(
    (column) =>
      group.columnIds.includes(column.id) &&
      (column.kind === "operatorNames" || column.visible !== false) &&
      (column.kind !== "operators" || config.value?.settings.avatar.showAvatar),
  );
}

function displayOperatorLabel(
  group: BasicCalculatorGroup,
  operator: BasicCalculatorOperator,
): string {
  return operator.room && operator.room !== group.facility
    ? `${operator.name}（${ROOM_LABELS[operator.room]}）`
    : operator.name;
}

function rowVisibleOperators(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): BasicCalculatorOperator[] {
  const hiddenOperators = new Set(row.hiddenOperators ?? []);
  const visible = basicCalculatorScheduleOperators(row.schedule).filter(
    (operator) => !hiddenOperators.has(operator.name),
  );
  return [
    ...visible.filter((operator) => operator.room === group.facility),
    ...visible.filter((operator) => operator.room !== group.facility),
  ];
}

function operatorNameText(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): string {
  return rowVisibleOperators(group, row)
    .map((operator) => displayOperatorLabel(group, operator))
    .join(" + ");
}

function productAccent(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): string | undefined {
  const product = basicCalculatorRoomAssignment(
    row.schedule,
    group.facility,
  )?.product;
  if (!product) return undefined;
  return (
    productColors.value[product as keyof typeof productColors.value] ??
    PRODUCT_REPRESENTATIVE_COLORS[product] ??
    facilityColors.value[group.facility] ??
    ROOM_REPRESENTATIVE_COLORS[group.facility]
  );
}

function aggregateValues(
  values: number[],
  aggregate: BasicCalculatorAggregate,
): number | undefined {
  if (values.length === 0) return undefined;
  if (aggregate === "sum")
    return values.reduce((total, value) => total + value, 0);
  if (aggregate === "max") return Math.max(...values);
  if (aggregate === "min") return Math.min(...values);
  return values[0];
}

function rowView(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): BasicCalculatorRowView {
  const columns = groupColumns(group);
  const calculation = rowCalculations.value[`${group.id}:${row.id}`];
  const numeric: Record<string, number | undefined> = {};
  columns.forEach((column) => {
    if (column.kind === "storageDelta") {
      numeric[column.id] = calculation?.storageDelta;
    } else if (column.kind === "orderDelta") {
      numeric[column.id] = calculation?.orderDelta;
    } else if (column.kind === "efficiency") {
      numeric[column.id] =
        calculation?.efficiency[String(column.hours ?? 24)]?.second;
    } else if (column.kind === "operatorField" && catalog.value) {
      numeric[column.id] = aggregateValues(
        operatorFieldValues(
          catalog.value,
          basicCalculatorOperatorFieldNames(group, row),
          column.path ?? "",
        ),
        column.aggregate ?? "list",
      );
    }
  });
  return {
    group,
    row,
    efficiency: calculation?.efficiency ?? {},
    numeric,
    backgroundColor: productAccent(group, row),
  };
}

const rowsByGroup = computed<Record<string, BasicCalculatorRowView[]>>(() => {
  const result: Record<string, BasicCalculatorRowView[]> = {};
  (config.value?.groups ?? []).forEach((group) => {
    const views = group.rows.map((row) => rowView(group, row));
    const sortColumnId = config.value?.settings.sortColumnId ?? "";
    const direction = config.value?.settings.sortDirection === "asc" ? 1 : -1;
    views.sort((first, second) => {
      const column = groupColumns(group).find(
        (candidate) => candidate.id === sortColumnId,
      );
      if (!column) return 0;
      const firstValue = sortValue(first, column);
      const secondValue = sortValue(second, column);
      if (firstValue === undefined && secondValue === undefined) return 0;
      if (firstValue === undefined) return 1;
      if (secondValue === undefined) return -1;
      return compareValues(firstValue, secondValue) * direction;
    });
    result[group.id] = views;
  });
  return result;
});

function efficiencyText(
  value: BasicCalculatorEfficiencyValue | undefined,
): string {
  if (!value) return "—";
  const first = `${formatEfficiencyNumber(value.first)}%`;
  if (config.value?.settings.efficiencyDisplay === "first") return first;
  const second =
    value.second === undefined
      ? "—"
      : `${formatEfficiencyNumber(value.second)}%`;
  if (config.value?.settings.efficiencyDisplay === "second") return second;
  return `${first} / ${second}`;
}

function sortValue(
  view: BasicCalculatorRowView,
  column: BasicCalculatorColumn,
): string | number | undefined {
  if (column.kind === "operators") {
    return operatorNameText(view.group, view.row);
  }
  if (column.kind === "operatorNames") {
    return operatorNameText(view.group, view.row);
  }
  if (column.kind === "note")
    return view.row.schedule.plans[0]?.description ?? "";
  if (
    column.kind === "operatorField" &&
    (column.aggregate ?? "list") === "list"
  ) {
    const values = catalog.value
      ? operatorFieldValues(
          catalog.value,
          basicCalculatorOperatorFieldNames(view.group, view.row),
          column.path ?? "",
        )
      : [];
    return values.map((value) => String(value)).join("/");
  }
  return view.numeric[column.id];
}

function columnText(
  view: BasicCalculatorRowView,
  column: BasicCalculatorColumn,
): string {
  if (column.kind === "operatorNames") {
    return operatorNameText(view.group, view.row);
  }
  if (column.kind === "storageDelta" || column.kind === "orderDelta") {
    const value = view.numeric[column.id];
    return value === undefined ? "—" : formatNumber(value);
  }
  if (column.kind === "efficiency") {
    return efficiencyText(view.efficiency[String(column.hours ?? 24)]);
  }
  if (column.kind === "operatorField") {
    const values = catalog.value
      ? operatorFieldValues(
          catalog.value,
          basicCalculatorOperatorFieldNames(view.group, view.row),
          column.path ?? "",
        )
      : [];
    if (values.length === 0) return "—";
    if ((column.aggregate ?? "list") === "list") {
      return values
        .map((value) => `${formatNumber(value)}${column.unit ?? ""}`)
        .join(" / ");
    }
    return `${formatNumber(view.numeric[column.id] ?? 0)}${column.unit ?? ""}`;
  }
  if (column.kind === "note")
    return view.row.schedule.plans[0]?.description || "";
  return "";
}

function updateAvatarSetting(
  key: keyof BasicCalculatorConfig["settings"]["avatar"],
  value: boolean,
): void {
  updateConfig((draft) => {
    draft.settings.avatar[key] = value;
  });
}

function toggleDraftHiddenOperator(
  operator: BasicCalculatorOperator,
  checked: boolean,
): void {
  const row = rowDraft.value;
  if (!row) return;
  const hiddenOperators = new Set(row.hiddenOperators ?? []);
  if (checked) hiddenOperators.add(operator.name);
  else hiddenOperators.delete(operator.name);
  row.hiddenOperators = [...hiddenOperators];
}

function updateSetting<K extends keyof BasicCalculatorConfig["settings"]>(
  key: K,
  value: BasicCalculatorConfig["settings"][K],
): void {
  updateConfig((draft) => {
    draft.settings[key] = value;
  });
}

function toggleSort(columnId: string): void {
  updateConfig((draft) => {
    if (draft.settings.sortColumnId === columnId) {
      draft.settings.sortDirection =
        draft.settings.sortDirection === "asc" ? "desc" : "asc";
      return;
    }
    draft.settings.sortColumnId = columnId;
    draft.settings.sortDirection = "desc";
  });
}

function updateColumnLabel(id: string, label: string): void {
  const column = columnSettingsDraft.value?.columns.find(
    (item) => item.id === id,
  );
  if (column) column.label = label;
}

function toggleColumn(id: string, visible: boolean): void {
  const column = columnSettingsDraft.value?.columns.find(
    (item) => item.id === id,
  );
  if (column) column.visible = visible;
}

function updateColumnHours(id: string, hours: number): void {
  const column = columnSettingsDraft.value?.columns.find(
    (item) => item.id === id,
  );
  if (!column || column.kind !== "efficiency") return;
  column.hours = Math.max(0.01, hours);
  column.label = `${formatNumber(column.hours)}小时效率`;
}

function updateColumnPath(id: string, path: string): void {
  const column = columnSettingsDraft.value?.columns.find(
    (item) => item.id === id,
  );
  if (column?.kind === "operatorField") column.path = path;
}

function updateColumnAggregate(
  id: string,
  aggregate: BasicCalculatorAggregate,
): void {
  const column = columnSettingsDraft.value?.columns.find(
    (item) => item.id === id,
  );
  if (column?.kind === "operatorField") column.aggregate = aggregate;
}

function moveColumn(id: string, direction: -1 | 1): void {
  const columns = columnSettingsDraft.value?.columns;
  if (!columns) return;
  const index = columns.findIndex((column) => column.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= columns.length) return;
  const column = columns[index];
  const adjacentColumn = columns[destination];
  if (!column || !adjacentColumn) return;
  columns[index] = adjacentColumn;
  columns[destination] = column;
}

function removeColumn(id: string): void {
  const draft = columnSettingsDraft.value;
  if (!draft) return;
  draft.columns = draft.columns.filter((column) => column.id !== id);
  draft.groups.forEach((group) => {
    group.columnIds = group.columnIds.filter((columnId) => columnId !== id);
  });
  if (draft.settings.sortColumnId === id) {
    draft.settings.sortColumnId = "efficiency-24";
    draft.settings.sortDirection = "desc";
  }
}

function resetColumnDraft(): void {
  columnDraft.kind = "efficiency";
  columnDraft.label = "";
  columnDraft.hours = 12;
  columnDraft.path = fieldOptions.value[0]?.value ?? "";
  columnDraft.aggregate = "list";
}

function openColumnEditor(): void {
  if (!config.value) return;
  columnSettingsDraft.value = cloneBasicCalculatorConfig(config.value);
  resetColumnDraft();
  columnModalOpen.value = true;
}

function cancelColumnSettings(): void {
  columnSettingsDraft.value = undefined;
  resetColumnDraft();
  columnModalOpen.value = false;
}

function saveColumnSettings(): void {
  const settingsDraft = columnSettingsDraft.value;
  if (!settingsDraft) return;
  const savedDraft = cloneBasicCalculatorConfig(settingsDraft);
  updateConfig((draft) => {
    draft.columns = savedDraft.columns;
    const groupColumnIds = new Map(
      savedDraft.groups.map((group) => [group.id, group.columnIds]),
    );
    draft.groups.forEach((group) => {
      const columnIds = groupColumnIds.get(group.id);
      if (columnIds) group.columnIds = columnIds;
    });
    draft.settings.sortColumnId = savedDraft.settings.sortColumnId;
    draft.settings.sortDirection = savedDraft.settings.sortDirection;
  });
  cancelColumnSettings();
}

function editorOperatorCandidates(
  type: RoomKey,
): OperatorPickerCandidateView[] {
  if (!catalog.value) return [];
  const rooms = rowDraftSchedule.value?.plans[0]?.rooms[type];
  const assignments = Array.isArray(rooms) ? (rooms as RoomAssignment[]) : [];
  const selectedNames = new Set(
    assignments.flatMap((room) => room.operators ?? []),
  );
  return operators.value
    .filter((operator) =>
      catalog.value?.operators[operator.name]?.skillFile?.chains.some(
        (chain) => chain.room === type,
      ),
    )
    .filter(
      (operator) =>
        showUnownedOperatorsInPicker.value ||
        isOperatorOwned(operator.name) ||
        selectedNames.has(operator.name),
    )
    .sort((first, second) => {
      const firstOrder = first.implementationOrder ?? -1;
      const secondOrder = second.implementationOrder ?? -1;
      return secondOrder - firstOrder;
    })
    .map((operator) => ({
      operator,
      eliteLevel: editorOperatorEliteLevel(operator.name, type),
      operatorOwned: isOperatorOwned(operator.name),
    }));
}

function editorOperatorEliteLevel(name: string, type: RoomKey): EliteLevel {
  const operator = operatorFor(name);
  const profile = operator
    ? catalog.value?.operators[operator.name]
    : undefined;
  const rooms = rowDraftSchedule.value?.plans[0]?.rooms[type];
  const assignments = Array.isArray(rooms) ? (rooms as RoomAssignment[]) : [];
  const state = assignments
    .flatMap((room) => Object.entries(room.operatorStates ?? []))
    .find(([operatorName]) => operatorName === name)?.[1] as
    OperatorState | undefined;
  return resolveOperatorProgression({
    operatorId: operator?.id ?? name,
    facility: type,
    operatorSkillFile: profile?.skillFile,
    maxEliteLevel: operator?.maxEliteLevel,
    manualElite: state?.elite,
    manualLevel: state?.level,
    profile: activeProfile.value,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  }).elite;
}

function editorOperatorProgression(
  name: string,
  type: RoomKey,
  state: OperatorState,
):
  | {
      nodes: OperatorProgressionNode[];
      current: Pick<ResolvedOperatorProgression, "elite" | "level">;
      hasManualProgression: boolean;
    }
  | undefined {
  const operator = operatorFor(name);
  if (!operator) return undefined;
  const profile = catalog.value?.operators[operator.name];
  const nodes = progressionNodesForFacility(
    profile?.skillFile,
    type,
    operator.rarity,
  );
  const current = resolveOperatorProgression({
    operatorId: operator.id,
    facility: type,
    operatorSkillFile: profile?.skillFile,
    maxEliteLevel: operator.maxEliteLevel,
    manualElite: state.elite,
    manualLevel: state.level,
    profile: activeProfile.value,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  });
  return {
    nodes,
    current,
    hasManualProgression:
      state.elite !== undefined || state.level !== undefined,
  };
}

function addColumn(): void {
  const draft = columnSettingsDraft.value;
  if (!draft) return;
  const id = `column-${crypto.randomUUID()}`;
  const column: BasicCalculatorColumn = {
    id,
    label:
      columnDraft.label.trim() ||
      (columnDraft.kind === "efficiency"
        ? `${formatNumber(columnDraft.hours)}小时效率`
        : "自定义列"),
    kind: columnDraft.kind,
    ...(columnDraft.kind === "efficiency"
      ? { hours: Math.max(0.01, columnDraft.hours), unit: "%" }
      : {}),
    ...(columnDraft.kind === "operatorField"
      ? { path: columnDraft.path, aggregate: columnDraft.aggregate }
      : {}),
  };
  draft.columns.push(column);
  draft.groups.forEach((group) => group.columnIds.push(id));
  resetColumnDraft();
}

function openRowEditor(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): void {
  rowDraftGroupId.value = group.id;
  rowDraft.value = JSON.parse(JSON.stringify(row)) as BasicCalculatorRow;
  rowDraftSchedule.value = JSON.parse(
    JSON.stringify(row.schedule),
  ) as ScheduleDocument;
  rowModalOpen.value = true;
}

function saveRow(): void {
  if (!rowDraft.value || !rowDraftGroupId.value || !rowDraftSchedule.value)
    return;
  const draft = JSON.parse(
    JSON.stringify(rowDraft.value),
  ) as BasicCalculatorRow;
  draft.schedule = JSON.parse(
    JSON.stringify(rowDraftSchedule.value),
  ) as ScheduleDocument;
  updateConfig((next) => {
    const group = next.groups.find((item) => item.id === rowDraftGroupId.value);
    const row = group?.rows.find((item) => item.id === draft.id);
    if (row) Object.assign(row, draft);
  });
  rowModalOpen.value = false;
}

function cancelRowEditor(): void {
  rowEditor.value?.clearInteractionState();
  rowModalOpen.value = false;
}

function deleteRow(groupId: string, rowId: string): void {
  updateConfig((draft) => {
    const group = draft.groups.find((item) => item.id === groupId);
    if (group) group.rows = group.rows.filter((row) => row.id !== rowId);
  });
}

function addRow(group: BasicCalculatorGroup): void {
  const id = `${group.id}-row-${Date.now().toString(36)}`;
  const row: BasicCalculatorRow = {
    id,
    schedule: createBasicCalculatorSchedule(group),
    hiddenOperators: [group.coreOperator.name],
  };
  updateConfig((draft) => {
    draft.groups.find((item) => item.id === group.id)?.rows.push(row);
  });
  openRowEditor(group, row);
}

function openGroupEditor(group?: BasicCalculatorGroup): void {
  groupDraft.value = group
    ? (JSON.parse(JSON.stringify(group)) as GroupDraft)
    : {
        id: `group-${Date.now().toString(36)}`,
        name: "新组合组",
        facility: "manufacture",
        facilityLevel: 3,
        coreOperator: { name: operators.value[0]?.name ?? "红云" },
        columnIds: config.value?.groups[0]?.columnIds ?? [],
        rows: [],
      };
  groupModalOpen.value = true;
}

function saveGroup(): void {
  const draft = groupDraft.value;
  if (!draft || !draft.name.trim() || !draft.coreOperator.name) return;
  updateConfig((next) => {
    const index = next.groups.findIndex((group) => group.id === draft.id);
    const group = JSON.parse(JSON.stringify(draft)) as BasicCalculatorGroup;
    if (index >= 0) {
      const previousGroup = next.groups[index]!;
      group.rows = previousGroup.rows.map((row) => ({
        ...row,
        hiddenOperators:
          previousGroup.coreOperator.name === group.coreOperator.name
            ? row.hiddenOperators
            : [
                ...new Set([
                  ...(row.hiddenOperators ?? []),
                  group.coreOperator.name,
                ]),
              ],
        schedule: synchronizeBasicCalculatorGroupSchedule(
          row.schedule,
          previousGroup,
          group,
        ),
      }));
      next.groups.splice(index, 1, group);
    } else next.groups.push(group);
  });
  groupModalOpen.value = false;
}

function deleteGroup(groupId: string): void {
  updateConfig((draft) => {
    draft.groups = draft.groups.filter((group) => group.id !== groupId);
  });
}

function resetDefaults(): void {
  if (!defaults.value) return;
  config.value = cloneBasicCalculatorConfig(defaults.value);
  if (typeof window !== "undefined")
    window.localStorage.removeItem(STORAGE_KEY);
}

function operatorFor(name: string): Operator | undefined {
  return operatorByName.value.get(name);
}

function isOperatorOwned(name: string): boolean {
  if (!activeProfile.value) return true;
  const operator = operatorFor(name);
  return operator
    ? activeProfile.value.entries[operator.id]?.owned === true
    : true;
}

function operatorEliteLevel(
  group: BasicCalculatorGroup,
  operator: BasicCalculatorOperator,
): EliteLevel {
  const data = operatorFor(operator.name);
  const profile = data ? catalog.value?.operators[data.name] : undefined;
  return resolveOperatorProgression({
    operatorId: data?.id ?? operator.name,
    facility: operator.room ?? group.facility,
    operatorSkillFile: profile?.skillFile,
    maxEliteLevel: data?.maxEliteLevel,
    manualElite: operator.elite,
    manualLevel: operator.level,
    profile: activeProfile.value,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  }).elite;
}

function rowBackgroundStyle(
  view: BasicCalculatorRowView,
): Record<string, string> {
  return view.backgroundColor
    ? {
        backgroundColor: `color-mix(in srgb, ${view.backgroundColor} 16%, white)`,
      }
    : {};
}

function isColumnSelected(group: BasicCalculatorGroup, id: string): boolean {
  return group.columnIds.includes(id);
}

function toggleGroupColumn(
  groupId: string,
  columnId: string,
  selected: boolean,
): void {
  updateConfig((draft) => {
    const group = draft.groups.find((item) => item.id === groupId);
    if (!group) return;
    group.columnIds = selected
      ? [...group.columnIds, columnId]
      : group.columnIds.filter((id) => id !== columnId);
  });
}
</script>

<template>
  <div class="basic-calculator-page">
    <a-alert
      v-if="errorMessage || loadError || calculationError"
      :message="errorMessage || loadError || calculationError"
      show-icon
      type="error"
    />
    <a-card :bordered="false" class="basic-calculator-header">
      <div class="basic-calculator-header-content">
        <div>
          <span class="page-kicker">RIIC EFFICIENCY</span>
          <h1>基建组合计算器</h1>
          <p>按组合、产物和工作时长比较基建技能效果。</p>
        </div>
        <a-space wrap>
          <a-button :icon="h(SettingOutlined)" @click="openColumnEditor"
            >列设置</a-button
          >
          <a-button
            :icon="h(PlusOutlined)"
            type="primary"
            @click="openGroupEditor()"
            >新建组合组</a-button
          >
          <a-popconfirm
            cancel-text="取消"
            ok-text="恢复"
            title="恢复默认组合、列和页面设置？"
            @confirm="resetDefaults"
          >
            <a-button :icon="h(ReloadOutlined)">恢复默认</a-button>
          </a-popconfirm>
        </a-space>
      </div>
    </a-card>

    <a-card v-if="config" class="basic-calculator-settings" title="显示与排序">
      <a-form layout="inline">
        <a-form-item label="头像">
          <a-space wrap>
            <a-checkbox
              :checked="config.settings.avatar.showAvatar"
              @change="updateAvatarSetting('showAvatar', $event.target.checked)"
              >显示头像</a-checkbox
            >
            <a-checkbox
              :disabled="!config.settings.avatar.showAvatar"
              :checked="config.settings.avatar.showProfession"
              @change="
                updateAvatarSetting('showProfession', $event.target.checked)
              "
              >职业</a-checkbox
            >
            <a-checkbox
              :disabled="!config.settings.avatar.showAvatar"
              :checked="config.settings.avatar.showEliteLevel"
              @change="
                updateAvatarSetting('showEliteLevel', $event.target.checked)
              "
              >精英化</a-checkbox
            >
            <a-checkbox
              :disabled="!config.settings.avatar.showAvatar"
              :checked="config.settings.avatar.showRarity"
              @change="updateAvatarSetting('showRarity', $event.target.checked)"
              >星级</a-checkbox
            >
          </a-space>
        </a-form-item>
        <a-form-item label="效率显示">
          <a-radio-group
            :value="config.settings.efficiencyDisplay"
            @change="updateSetting('efficiencyDisplay', $event.target.value)"
          >
            <a-radio-button value="first">合计</a-radio-button>
            <a-radio-button value="second">平均</a-radio-button>
            <a-radio-button value="both">两种</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="精0孑">
          <a-radio-group
            :value="config.settings.jieCalculation"
            @change="updateSetting('jieCalculation', $event.target.value)"
          >
            <a-radio-button value="max">最高效率</a-radio-button>
            <a-radio-button value="integral">积分平均</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-card>

    <a-spin :spinning="loading">
      <a-collapse
        v-if="config"
        v-model:active-key="activeGroupIds"
        class="basic-calculator-groups"
      >
        <a-collapse-panel v-for="group in config.groups" :key="group.id">
          <template #header>
            <div class="basic-calculator-group-header">
              <strong>{{ group.name }}</strong>
              <span
                >{{ group.coreOperator.name }} ·
                {{ ROOM_LABELS[group.facility] }}</span
              >
              <span class="basic-calculator-group-header-actions" @click.stop>
                <a-button
                  :icon="h(EditOutlined)"
                  type="text"
                  @click="openGroupEditor(group)"
                />
                <a-popconfirm
                  cancel-text="取消"
                  ok-text="删除"
                  title="删除这个组合组？"
                  @confirm="deleteGroup(group.id)"
                >
                  <a-button :icon="h(DeleteOutlined)" danger type="text" />
                </a-popconfirm>
              </span>
            </div>
          </template>
          <div class="basic-calculator-group-toolbar">
            <span
              >核心：{{ group.coreOperator.name }} ·
              {{ group.facilityLevel }}级</span
            >
            <a-space wrap>
              <a-checkbox
                v-for="column in config.columns"
                :key="column.id"
                :disabled="column.kind === 'operatorNames'"
                :checked="isColumnSelected(group, column.id)"
                @change="
                  toggleGroupColumn(group.id, column.id, $event.target.checked)
                "
                >{{ column.label }}</a-checkbox
              >
              <a-button
                :icon="h(PlusOutlined)"
                size="small"
                @click="addRow(group)"
                >添加行</a-button
              >
            </a-space>
          </div>
          <div class="basic-calculator-table-wrap">
            <table class="basic-calculator-table">
              <thead>
                <tr>
                  <th
                    aria-label="操作"
                    class="basic-calculator-actions-column"
                  />
                  <th
                    v-for="column in groupColumns(group)"
                    :key="column.id"
                    :aria-sort="
                      config.settings.sortColumnId === column.id
                        ? config.settings.sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    "
                  >
                    <button
                      class="basic-calculator-sort-button"
                      type="button"
                      @click="toggleSort(column.id)"
                    >
                      <span>{{ column.label }}</span>
                      <SortAscendingOutlined
                        v-if="
                          config.settings.sortColumnId === column.id &&
                          config.settings.sortDirection === 'asc'
                        "
                      />
                      <SortDescendingOutlined
                        v-else-if="config.settings.sortColumnId === column.id"
                      />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="view in rowsByGroup[group.id] ?? []"
                  :key="view.row.id"
                  :style="rowBackgroundStyle(view)"
                >
                  <td class="basic-calculator-actions-column">
                    <div class="basic-calculator-row-actions">
                      <a-tooltip title="编辑"
                        ><a-button
                          :icon="h(EditOutlined)"
                          aria-label="编辑行"
                          size="small"
                          type="text"
                          @click="openRowEditor(group, view.row)"
                      /></a-tooltip>
                      <a-tooltip title="删除">
                        <a-popconfirm
                          cancel-text="取消"
                          ok-text="删除"
                          title="删除这一行？"
                          @confirm="deleteRow(group.id, view.row.id)"
                        >
                          <a-button
                            :icon="h(DeleteOutlined)"
                            aria-label="删除行"
                            danger
                            size="small"
                            type="text"
                          />
                        </a-popconfirm>
                      </a-tooltip>
                    </div>
                  </td>
                  <td
                    v-for="column in groupColumns(group)"
                    :key="column.id"
                    :class="{
                      'basic-calculator-name-cell':
                        column.kind === 'operatorNames',
                      'basic-calculator-note-cell': column.kind === 'note',
                    }"
                  >
                    <div
                      v-if="column.kind === 'operators'"
                      class="basic-calculator-avatars"
                    >
                      <OperatorAvatarDisplay
                        v-for="operator in rowVisibleOperators(
                          view.group,
                          view.row,
                        )"
                        :key="`${view.row.id}-${operator.name}`"
                        :display-name="operator.name"
                        :elite-level="operatorEliteLevel(view.group, operator)"
                        :operator="operatorFor(operator.name)"
                        :plain="true"
                        :proportional-layout="true"
                        :show-elite-level="
                          config.settings.avatar.showEliteLevel
                        "
                        :show-profession="config.settings.avatar.showProfession"
                        :show-rarity="config.settings.avatar.showRarity"
                        :size="58"
                        :special-label="
                          operatorFor(operator.name)
                            ? undefined
                            : operator.name.slice(0, 2)
                        "
                      />
                    </div>
                    <span v-else>{{ columnText(view, column) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </a-collapse-panel>
      </a-collapse>
    </a-spin>

    <a-modal
      :open="columnModalOpen"
      cancel-text="取消"
      ok-text="保存"
      title="列设置"
      width="760px"
      @cancel="cancelColumnSettings"
      @ok="saveColumnSettings"
    >
      <div class="basic-calculator-column-list">
        <div
          v-for="(column, index) in columnSettingsDraft?.columns ?? []"
          :key="column.id"
          class="basic-calculator-column-row"
        >
          <a-checkbox
            :disabled="column.kind === 'operatorNames'"
            :checked="column.visible !== false"
            @change="toggleColumn(column.id, $event.target.checked)"
          />
          <a-space :size="0">
            <a-button
              :disabled="index === 0"
              :icon="h(ArrowUpOutlined)"
              aria-label="上移列"
              size="small"
              type="text"
              @click="moveColumn(column.id, -1)"
            />
            <a-button
              :disabled="
                index === (columnSettingsDraft?.columns.length ?? 0) - 1
              "
              :icon="h(ArrowDownOutlined)"
              aria-label="下移列"
              size="small"
              type="text"
              @click="moveColumn(column.id, 1)"
            />
          </a-space>
          <a-input
            :value="column.label"
            class="basic-calculator-column-label"
            @change="updateColumnLabel(column.id, $event.target.value)"
          />
          <a-input-number
            v-if="column.kind === 'efficiency'"
            :value="column.hours"
            :min="0.01"
            :step="0.01"
            addon-after="小时"
            @change="updateColumnHours(column.id, Number($event))"
          />
          <a-select
            v-if="column.kind === 'operatorField'"
            :value="column.path"
            style="min-width: 250px"
            @change="updateColumnPath(column.id, $event)"
          >
            <a-select-option
              v-for="option in fieldOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
          <a-select
            v-if="column.kind === 'operatorField'"
            :value="column.aggregate ?? 'list'"
            @change="updateColumnAggregate(column.id, $event)"
          >
            <a-select-option value="list">分别显示</a-select-option>
            <a-select-option value="sum">合计</a-select-option>
            <a-select-option value="max">最大值</a-select-option>
            <a-select-option value="min">最小值</a-select-option>
          </a-select>
          <a-button
            :icon="h(DeleteOutlined)"
            aria-label="删除列"
            danger
            type="text"
            @click="removeColumn(column.id)"
          />
        </div>
      </div>
      <a-divider />
      <a-form :model="columnDraft" layout="vertical" @finish="addColumn">
        <a-form-item label="新列类型" name="kind">
          <a-select v-model:value="columnDraft.kind">
            <a-select-option value="efficiency">工作时间效率</a-select-option>
            <a-select-option value="operatorField"
              >干员 JSON 数值</a-select-option
            >
            <a-select-option value="storageDelta">仓库容量差值</a-select-option>
            <a-select-option value="orderDelta">订单上限差值</a-select-option>
            <a-select-option value="note">备注</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="列名称" name="label">
          <a-input v-model:value="columnDraft.label" />
        </a-form-item>
        <a-form-item
          v-if="columnDraft.kind === 'efficiency'"
          label="工作时间"
          name="hours"
        >
          <a-input-number
            v-model:value="columnDraft.hours"
            :min="0.01"
            :step="0.01"
          />
        </a-form-item>
        <a-form-item
          v-if="columnDraft.kind === 'operatorField'"
          label="JSON 数值字段"
          name="path"
        >
          <a-select v-model:value="columnDraft.path">
            <a-select-option
              v-for="option in fieldOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="columnDraft.kind === 'operatorField'"
          label="多干员显示"
          name="aggregate"
        >
          <a-radio-group v-model:value="columnDraft.aggregate">
            <a-radio value="list">分别显示</a-radio
            ><a-radio value="sum">合计</a-radio
            ><a-radio value="max">最大值</a-radio
            ><a-radio value="min">最小值</a-radio>
          </a-radio-group>
        </a-form-item>
        <div class="basic-calculator-column-submit">
          <a-button html-type="submit" type="primary">添加</a-button>
        </div>
      </a-form>
    </a-modal>

    <a-modal
      :open="groupModalOpen"
      cancel-text="取消"
      ok-text="保存"
      title="组合组设置"
      @cancel="groupModalOpen = false"
      @ok="saveGroup"
    >
      <a-form v-if="groupDraft" layout="vertical">
        <a-form-item label="组合组名称"
          ><a-input v-model:value="groupDraft.name"
        /></a-form-item>
        <a-form-item label="核心干员">
          <a-select v-model:value="groupDraft.coreOperator.name" show-search>
            <a-select-option
              v-for="option in operatorOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item label="工作设施">
          <a-select v-model:value="groupDraft.facility"
            ><a-select-option value="manufacture">制造站</a-select-option
            ><a-select-option value="trading">贸易站</a-select-option></a-select
          >
        </a-form-item>
        <a-form-item label="设施等级"
          ><a-input-number
            v-model:value="groupDraft.facilityLevel"
            :max="3"
            :min="1"
        /></a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      :open="rowModalOpen"
      cancel-text="取消"
      ok-text="保存"
      title="组合行设置"
      width="1180px"
      @cancel="cancelRowEditor"
      @ok="saveRow"
    >
      <div
        v-if="rowDraft && rowDraftGroup && rowDraftSchedule"
        class="basic-calculator-row-editor"
      >
        <BasicCalculatorScheduleEditor
          ref="rowEditor"
          v-model:model-value="rowDraftSchedule"
          :session-key="rowDraftGroupId + ':' + rowDraft.id"
          :fixed-operator="{
            type: rowDraftGroup.facility,
            name: rowDraftGroup.coreOperator.name,
          }"
          :facility-colors="facilityColors"
          :fixed-room-levels="rowDraftFixedRoomLevels"
          :fixed-room-types="rowDraftFixedRoomTypes"
          :operator-candidates="editorOperatorCandidates"
          :operator-elite-level="editorOperatorEliteLevel"
          :operator-progression="editorOperatorProgression"
          :operator-for="operatorFor"
        />
        <a-form layout="vertical">
          <a-form-item label="备注">
            <a-textarea
              v-model:value="rowDraftNote"
              :auto-size="{ minRows: 2, maxRows: 8 }"
            />
          </a-form-item>
          <a-form-item
            v-if="draftHiddenOperatorOptions.length"
            class="basic-calculator-display-operator-form-item"
            label="隐藏干员"
          >
            <a-space wrap>
              <a-checkbox
                v-for="option in draftHiddenOperatorOptions"
                :key="option.operator.name"
                :checked="draftHiddenOperatorNames.has(option.operator.name)"
                @change="
                  toggleDraftHiddenOperator(
                    option.operator,
                    $event.target.checked,
                  )
                "
                >{{ option.label }}</a-checkbox
              >
            </a-space>
          </a-form-item>
        </a-form>
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.basic-calculator-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.basic-calculator-row-editor {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.basic-calculator-row-editor > .ant-form {
  padding-block-start: 4px;
  border-block-start: 1px solid rgba(46, 65, 61, 0.12);
}
.basic-calculator-header-content,
.basic-calculator-group-header,
.basic-calculator-group-toolbar {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}
.basic-calculator-header h1 {
  margin-block: 4px;
}
.basic-calculator-header p {
  color: #697876;
  margin: 0;
}
.page-kicker {
  color: #216a66;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.basic-calculator-group-header {
  justify-content: flex-start;
  min-width: 0;
}
.basic-calculator-group-header
  > span:not(.basic-calculator-group-header-actions) {
  color: #6d7c79;
  font-size: 12px;
}
.basic-calculator-group-header-actions {
  margin-inline-start: auto;
}
.basic-calculator-group-toolbar {
  align-items: flex-start;
  flex-wrap: wrap;
  margin-block-end: 12px;
}
.basic-calculator-table-wrap {
  overflow-x: auto;
}
.basic-calculator-table {
  border-collapse: collapse;
  margin-inline: auto;
  table-layout: auto;
  width: max-content;
}
.basic-calculator-table th,
.basic-calculator-table td {
  border-block-end: 1px solid rgba(46, 65, 61, 0.12);
  padding: 5px 6px;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
}
.basic-calculator-table td.basic-calculator-note-cell {
  text-align: start;
  white-space: pre;
}
.basic-calculator-table th {
  background: rgba(236, 242, 240, 0.9);
  color: #42534f;
  font-size: 12px;
  font-weight: 700;
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
}
.basic-calculator-sort-button {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  gap: 4px;
  justify-content: center;
  padding: 0;
}
.basic-calculator-sort-button:focus-visible {
  outline: 2px solid #216a66;
  outline-offset: 2px;
}
.basic-calculator-name-cell {
  text-align: start !important;
}
.basic-calculator-avatars {
  align-items: flex-start;
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
}
.basic-calculator-actions-column {
  padding-inline: 4px !important;
}
.basic-calculator-row-actions {
  display: flex;
  gap: 2px;
  justify-content: center;
  opacity: 0;
  transition: opacity 120ms ease;
}
.basic-calculator-display-operator-form-item {
  margin-block-end: 0;
}
.basic-calculator-table tr:hover .basic-calculator-row-actions,
.basic-calculator-table tr:focus-within .basic-calculator-row-actions {
  opacity: 1;
}
.basic-calculator-column-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.basic-calculator-column-row {
  align-items: center;
  display: flex;
  gap: 8px;
}
.basic-calculator-column-label {
  flex: 1;
  min-width: 120px;
}
.basic-calculator-column-submit {
  display: flex;
  justify-content: flex-start;
}
@media (max-width: 720px) {
  .basic-calculator-header-content {
    align-items: flex-start;
    flex-direction: column;
  }
  .basic-calculator-column-row {
    flex-wrap: wrap;
  }
}
</style>
