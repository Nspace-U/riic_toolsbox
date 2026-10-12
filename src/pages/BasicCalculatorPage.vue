<script setup lang="ts">
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SettingOutlined,
  WarningOutlined,
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
import OperatorSkillTooltip from "@/components/OperatorSkillTooltip.vue";
import type { OperatorPickerCandidateView } from "@/components/OperatorPickerPanel.vue";
import { useBaseData } from "@/composables/useBaseData";
import { useFacilityColors } from "@/composables/useFacilityColors";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import type { EliteLevel, Operator } from "@/types/baseData";
import {
  buildRecycleRules,
  getRiicEfficiencyCatalog,
} from "@/adapters/riicEfficiencyData";
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
  basicCalculatorProductForRoom,
  basicCalculatorRoomAssignment,
  basicCalculatorScheduleOperators,
  basicCalculatorTargetFacility,
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
  BasicCalculatorProductDefaults,
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
  sourceRows: BasicCalculatorRow[];
  efficiency: Record<string, BasicCalculatorEfficiencyValue>;
  numeric: Record<string, number | undefined>;
  productionProduct?: string;
  tradeOrderRule?: string;
  tradeOrders?: BasicCalculatorRowCalculation["tradeOrders"];
  jieEfficiencyFallbackReason?: BasicCalculatorRowCalculation["jieEfficiencyFallbackReason"];
  backgroundColor?: string;
}

interface BasicCalculatorSortState {
  column: BasicCalculatorColumn | undefined;
  direction: "asc" | "desc";
}

const EFFICIENCY_COLUMN_LABELS: Partial<
  Record<BasicCalculatorColumnKind, string>
> = {
  operatorEfficiency: "干员效率",
  facilityEfficiency: "整站效率",
  equivalentCurrentTradeEfficiency: "等效当前贸易效率",
  equivalentLevelThreeTradeEfficiency: "等效3级贸易效率",
  equivalentManufactureEfficiency: "等效制造效率",
  baseProductionRate: "基础产出速率",
  actualProductionRate: "实际产出速率",
};

const TRADING_PRODUCT_OPTIONS = [
  { value: "", label: "未指定产物" },
  ...PRODUCT_OPTIONS.filter(
    (option) => option.value === "龙门币" || option.value === "合成玉",
  ),
];
const MANUFACTURE_PRODUCT_OPTIONS = [
  { value: "", label: "未指定产物" },
  ...PRODUCT_OPTIONS.filter(
    (option) => option.value !== "龙门币" && option.value !== "合成玉",
  ),
];

interface GroupDraft extends Omit<BasicCalculatorGroup, "defaultProducts"> {
  defaultProducts: BasicCalculatorProductDefaults;
}

const STORAGE_KEYS = {
  combination: "riic-tools:basic-calculator:v6",
  efficiency: "riic-tools:efficiency-calculator:v3",
} as const;
const props = withDefaults(
  defineProps<{ mode?: "combination" | "efficiency" }>(),
  { mode: "combination" },
);
const calculatorTitle = computed(() =>
  props.mode === "efficiency" ? "效率计算器" : "组合计算器",
);
const storageKey = computed(() => STORAGE_KEYS[props.mode]);
const { operators, itemTable, buildingData, ready, errorMessage } =
  useBaseData();
const recycleRules = computed(() =>
  buildRecycleRules(buildingData.value, itemTable.value),
);
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
const activeMergedRowPopover = ref("");
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
const rowDraftRunOrderEnabled = computed({
  get: () => rowDraftSchedule.value?.settings?.runOrderEnabled === true,
  set(enabled: boolean) {
    const schedule = rowDraftSchedule.value;
    if (!schedule) return;
    schedule.settings = { ...schedule.settings, runOrderEnabled: enabled };
  },
});
const rowDraftFirstItemProgress = computed({
  get: () => {
    const progress = rowDraftSchedule.value?.settings?.firstItemProgress;
    return typeof progress === "number" ? progress * 100 : null;
  },
  set(value: number | null) {
    const schedule = rowDraftSchedule.value;
    if (!schedule) return;
    const settings = { ...(schedule.settings ?? {}) };
    if (value === null || !Number.isFinite(value)) {
      delete settings.firstItemProgress;
    } else {
      settings.firstItemProgress = Math.max(0, Math.min(100, value)) / 100;
    }
    if (Object.keys(settings).length) schedule.settings = settings;
    else delete schedule.settings;
  },
});
const rowDraftGroupId = ref("");
const rowEditor = ref<InstanceType<typeof BasicCalculatorScheduleEditor>>();
const calculatorWorker = ref<Worker>();
const rowCalculations = ref<Record<string, BasicCalculatorRowCalculation>>({});
const calculationLoading = ref(false);
const calculationError = ref("");
let calculationRequestId = 0;

const calculationsReadyForMerge = computed(() => {
  const current = config.value;
  return Boolean(
    current &&
    !calculationLoading.value &&
    !calculationError.value &&
    current.groups.every((group) =>
      group.rows.every(
        (row) => rowCalculations.value[`${group.id}:${row.id}`] !== undefined,
      ),
    ),
  );
});

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
    if (
      !group?.coreOperator ||
      !group.facility ||
      group.facilityLevel === undefined
    )
      return {};
    return { [group.facility]: group.facilityLevel };
  },
);
const rowDraftFixedRoomTypes = computed<RoomKey[]>(() => {
  const group = rowDraftGroup.value;
  if (!group?.coreOperator || !group.facility) return [];
  return [group.facility];
});
const draftHiddenOperatorOptions = computed<DraftHiddenOperatorOption[]>(() => {
  const group = rowDraftGroup.value;
  const row = rowDraft.value;
  if (!group || !row) return [];
  return basicCalculatorScheduleOperators(
    rowDraftSchedule.value ?? row.schedule,
    group.defaultProducts,
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

function readStoredPatch(key: string): BasicCalculatorPatch | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? "null",
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
      window.localStorage.removeItem(storageKey.value);
      return;
    }
    window.localStorage.setItem(storageKey.value, JSON.stringify(patch));
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
    const assetPath =
      props.mode === "efficiency"
        ? "assets/efficiency-calculator.json"
        : "assets/basic-calculator.json";
    const defaultResponse = await fetch(
      `${import.meta.env.BASE_URL}${assetPath}`,
    );
    if (!defaultResponse.ok) {
      throw new Error(
        `${calculatorTitle.value}配置读取失败（HTTP ${defaultResponse.status}）`,
      );
    }
    const asset = (await defaultResponse.json()) as BasicCalculatorAsset;
    const nextDefaults = createBasicCalculatorConfig(asset);
    defaults.value = nextDefaults;
    config.value = applyBasicCalculatorPatch(
      nextDefaults,
      readStoredPatch(storageKey.value),
    );
    catalog.value = getRiicEfficiencyCatalog(recycleRules.value);
    loadError.value = "";
  } catch (error: unknown) {
    loadError.value =
      error instanceof Error
        ? error.message
        : `${calculatorTitle.value}读取失败`;
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
    calculationError.value = `${calculatorTitle.value}后台计算失败`;
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
    calculatorSettings: {
      tradingBaseEfficiencyBonus: current.settings.tradingBaseEfficiencyBonus,
      manufactureBaseEfficiencyBonus:
        current.settings.manufactureBaseEfficiencyBonus,
      ...(props.mode === "combination"
        ? {
            preferMaxJieEfficiency: current.settings.preferMaxJieEfficiency,
            firstItemProgress: current.settings.firstItemProgress,
          }
        : {}),
    },
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
    ...(activeProfile.value
      ? { progressionProfile: cloneSerializable(activeProfile.value) }
      : {}),
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
    mode: props.mode,
    preferMaxJieEfficiency:
      props.mode === "combination"
        ? current.settings.preferMaxJieEfficiency
        : true,
    firstItemProgress:
      props.mode === "combination" ? current.settings.firstItemProgress : 0,
    allowRowFirstItemProgressOverride: props.mode === "combination",
    tradingBaseEfficiencyBonus: current.settings.tradingBaseEfficiencyBonus,
    manufactureBaseEfficiencyBonus:
      current.settings.manufactureBaseEfficiencyBonus,
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

function groupSortState(group: BasicCalculatorGroup): BasicCalculatorSortState {
  const columns = groupColumns(group);
  const settings = config.value?.settings;
  const selectedColumn = columns.find(
    (column) => column.id === settings?.sortColumnId,
  );
  if (
    selectedColumn &&
    (group.coreOperator || settings?.sortColumnCustomized)
  ) {
    return {
      column: selectedColumn,
      direction: settings?.sortDirection ?? "desc",
    };
  }

  if (props.mode === "efficiency") {
    return {
      column:
        columns.find((column) => column.kind === "operatorEfficiency") ??
        columns.find((column) => column.kind === "operatorNames"),
      direction: "desc",
    };
  }

  if (!group.coreOperator) {
    return {
      column: columns.find((column) => column.kind === "operatorNames"),
      direction: "asc",
    };
  }

  const efficiencyColumns = columns.filter(
    (column) => column.kind === "efficiency",
  );
  const dayEfficiency = efficiencyColumns.find(
    (column) => (column.hours ?? 24) === 24,
  );
  if (dayEfficiency) return { column: dayEfficiency, direction: "desc" };
  if (efficiencyColumns.length > 0) {
    const longestEfficiency = efficiencyColumns.reduce((longest, column) =>
      (column.hours ?? 24) > (longest.hours ?? 24) ? column : longest,
    );
    return { column: longestEfficiency, direction: "desc" };
  }

  const dataColumn = columns.find(
    (column) =>
      column.kind !== "operators" &&
      column.kind !== "operatorNames" &&
      column.kind !== "note" &&
      column.kind !== "efficiency",
  );
  if (dataColumn) return { column: dataColumn, direction: "desc" };

  return {
    column: columns.find((column) => column.kind === "operatorNames"),
    direction: "asc",
  };
}

function displayOperatorLabel(
  group: BasicCalculatorGroup,
  operator: BasicCalculatorOperator,
): string {
  return operator.room && operator.room !== group.facility
    ? `${operator.name}(${ROOM_LABELS[operator.room]})`
    : operator.name;
}

function displayOperatorNameLabel(
  group: BasicCalculatorGroup,
  operator: BasicCalculatorOperator,
): string {
  if (!config.value?.settings.showOperatorProgressionInNames) {
    return displayOperatorLabel(group, operator);
  }
  const name =
    operator.name + displayOperatorProgressionSuffix(group, operator);
  return operator.room && operator.room !== group.facility
    ? `${name}(${ROOM_LABELS[operator.room]})`
    : name;
}

function rowVisibleOperators(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): BasicCalculatorOperator[] {
  const hiddenOperators = new Set(row.hiddenOperators ?? []);
  const facility = basicCalculatorTargetFacility(group, row);
  const visible = basicCalculatorScheduleOperators(
    row.schedule,
    group.defaultProducts,
  ).filter((operator) => !hiddenOperators.has(operator.name));
  return [
    ...visible.filter((operator) => operator.room === facility),
    ...visible.filter((operator) => operator.room !== facility),
  ];
}

function operatorNameText(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): string {
  return rowVisibleOperators(group, row)
    .map((operator) => displayOperatorNameLabel(group, operator))
    .join(" + ");
}

function compareOperatorImplementationOrder(
  first: BasicCalculatorRowView,
  second: BasicCalculatorRowView,
): number {
  const firstOperators = rowVisibleOperators(first.group, first.row);
  const secondOperators = rowVisibleOperators(second.group, second.row);

  for (const [index, firstOperator] of firstOperators.entries()) {
    const secondOperator = secondOperators[index];
    if (!secondOperator) break;
    const firstOrder = operatorByName.value.get(
      firstOperator.name,
    )?.implementationOrder;
    const secondOrder = operatorByName.value.get(
      secondOperator.name,
    )?.implementationOrder;
    if (firstOrder === undefined || secondOrder === undefined) {
      if (firstOrder !== secondOrder) {
        return firstOrder === undefined ? -1 : 1;
      }
      continue;
    }
    if (firstOrder !== secondOrder) {
      return secondOrder - firstOrder;
    }
  }

  return 0;
}

function productAccent(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): string | undefined {
  const facility = basicCalculatorTargetFacility(group, row);
  if (!facility) return undefined;
  const product = basicCalculatorProductForRoom(
    group.defaultProducts,
    facility,
    basicCalculatorRoomAssignment(row.schedule, facility),
  );
  if (!product) return undefined;
  return (
    productColors.value[product as keyof typeof productColors.value] ??
    PRODUCT_REPRESENTATIVE_COLORS[product] ??
    facilityColors.value[facility] ??
    ROOM_REPRESENTATIVE_COLORS[facility]
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
    } else if (column.kind === "tradeBaseEfficiency") {
      numeric[column.id] = calculation?.tradeBaseEfficiency;
    } else if (column.kind === "operatorEfficiency") {
      numeric[column.id] = calculation?.operatorEfficiency;
    } else if (column.kind === "facilityEfficiency") {
      numeric[column.id] = calculation?.facilityEfficiency;
    } else if (column.kind === "equivalentCurrentTradeEfficiency") {
      numeric[column.id] = calculation?.equivalentCurrentTradeEfficiency;
    } else if (column.kind === "equivalentLevelThreeTradeEfficiency") {
      numeric[column.id] = calculation?.equivalentLevelThreeTradeEfficiency;
    } else if (column.kind === "equivalentManufactureEfficiency") {
      numeric[column.id] = calculation?.equivalentManufactureEfficiency;
    } else if (column.kind === "baseProductionRate") {
      numeric[column.id] = calculation?.baseProductionRate;
    } else if (column.kind === "actualProductionRate") {
      numeric[column.id] = calculation?.actualProductionRate;
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
    sourceRows: [row],
    efficiency: calculation?.efficiency ?? {},
    numeric,
    productionProduct: calculation?.productionProduct,
    tradeOrderRule: calculation?.tradeOrderRule,
    tradeOrders: calculation?.tradeOrders,
    jieEfficiencyFallbackReason: calculation?.jieEfficiencyFallbackReason,
    backgroundColor: productAccent(group, row),
  };
}

const rowsByGroup = computed<Record<string, BasicCalculatorRowView[]>>(() => {
  const result: Record<string, BasicCalculatorRowView[]> = {};
  (config.value?.groups ?? []).forEach((group) => {
    const views = group.rows.map((row) => rowView(group, row));
    const sortState = groupSortState(group);
    const direction = sortState.direction === "asc" ? 1 : -1;
    views.sort((first, second) => {
      const column = sortState.column;
      if (!column) return 0;
      const firstValue = sortValue(first, column);
      const secondValue = sortValue(second, column);
      if (firstValue === undefined && secondValue !== undefined) return 1;
      if (secondValue === undefined && firstValue !== undefined) return -1;
      if (firstValue !== undefined && secondValue !== undefined) {
        const valueComparison = compareValues(firstValue, secondValue);
        if (valueComparison !== 0) return valueComparison * direction;
      }
      const implementationComparison = compareOperatorImplementationOrder(
        first,
        second,
      );
      if (implementationComparison !== 0) return implementationComparison;
      return compareValues(
        operatorNameText(first.group, first.row),
        operatorNameText(second.group, second.row),
      );
    });
    result[group.id] =
      (props.mode === "efficiency" || group.coreOperator) &&
      config.value?.settings.mergeIdenticalRows &&
      calculationsReadyForMerge.value
        ? mergeRowViews(views)
        : views;
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
  if (first === second) return first;
  return `${first} / ${second}`;
}

function tradeOrderText(view: BasicCalculatorRowView): string {
  if (view.tradeOrderRule?.startsWith("固定订单：")) {
    return view.tradeOrderRule;
  }
  return (
    view.tradeOrders
      ?.map((order) => {
        const probability =
          order.probability < 1
            ? ` ${formatEfficiencyNumber(order.probability * 100)}%`
            : "";
        const note = order.note ? ` · ${order.note}` : "";
        return `${order.name}${probability}${note}`;
      })
      .join(" / ") ?? "—"
  );
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
  if (column.kind === "tradeOrders") return tradeOrderText(view);
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

function mergeRowViews(
  views: BasicCalculatorRowView[],
): BasicCalculatorRowView[] {
  const merged = new Map<string, BasicCalculatorRowView>();
  views.forEach((view) => {
    const key = JSON.stringify([
      view.backgroundColor ?? null,
      view.row.schedule.settings?.runOrderEnabled === true,
      view.row.schedule.settings?.runOrderEnabled === true
        ? rowVisibleOperators(view.group, view.row)
            .filter((operator) => operator.runOrder)
            .map((operator) => operator.name)
        : [],
      groupColumns(view.group)
        .filter(
          (column) =>
            column.kind !== "operators" && column.kind !== "operatorNames",
        )
        .map((column) => [column.id, columnText(view, column)]),
    ]);
    const existing = merged.get(key);
    if (existing) {
      existing.sourceRows.push(...view.sourceRows);
      existing.jieEfficiencyFallbackReason ??= view.jieEfficiencyFallbackReason;
    } else {
      merged.set(key, { ...view, sourceRows: [...view.sourceRows] });
    }
  });
  return [...merged.values()];
}

function viewOperatorNameText(view: BasicCalculatorRowView): string {
  return view.sourceRows
    .map((row) => operatorNameText(view.group, row))
    .filter(Boolean)
    .join(" / ");
}

function viewVisibleOperators(view: BasicCalculatorRowView): Array<{
  rowId: string;
  operator: BasicCalculatorOperator;
  dividerBefore: boolean;
}> {
  return view.sourceRows.flatMap((row) => {
    const visible = rowVisibleOperators(view.group, row);
    return visible.map((operator, index) => ({
      rowId: row.id,
      operator,
      dividerBefore:
        operator.runOrder === true &&
        index > 0 &&
        visible[index - 1]?.runOrder !== true,
    }));
  });
}

function viewVisibleOperatorNameParts(view: BasicCalculatorRowView): Array<{
  key: string;
  label: string;
  operator: Operator | undefined;
  separator: string;
  dividerBefore: boolean;
}> {
  const parts: Array<{
    key: string;
    label: string;
    operator: Operator | undefined;
    separator: string;
    dividerBefore: boolean;
  }> = [];

  view.sourceRows.forEach((row) => {
    const visible = rowVisibleOperators(view.group, row);
    visible.forEach((operator, index) => {
      const dividerBefore =
        operator.runOrder === true &&
        index > 0 &&
        visible[index - 1]?.runOrder !== true;
      parts.push({
        key: `${row.id}-${index}-${operator.name}`,
        label: displayOperatorNameLabel(view.group, operator),
        operator: operatorFor(operator.name),
        separator: dividerBefore
          ? ""
          : index === 0
            ? parts.length > 0
              ? " / "
              : ""
            : " + ",
        dividerBefore,
      });
    });
  });

  return parts;
}

function columnText(
  view: BasicCalculatorRowView,
  column: BasicCalculatorColumn,
): string {
  if (column.kind === "operatorNames") {
    return viewOperatorNameText(view);
  }
  if (column.kind === "tradeOrders") return tradeOrderText(view);
  if (column.kind === "tradeBaseEfficiency") {
    const value = view.numeric[column.id];
    return value === undefined
      ? "—"
      : `${formatNumber(value)} ${column.unit ?? ""}`.trim();
  }
  if (
    column.kind === "operatorEfficiency" ||
    column.kind === "facilityEfficiency" ||
    column.kind === "equivalentCurrentTradeEfficiency" ||
    column.kind === "equivalentLevelThreeTradeEfficiency" ||
    column.kind === "equivalentManufactureEfficiency"
  ) {
    const value = view.numeric[column.id];
    return value === undefined
      ? "—"
      : `${formatEfficiencyNumber(value)}${column.unit ?? "%"}`;
  }
  if (
    column.kind === "baseProductionRate" ||
    column.kind === "actualProductionRate"
  ) {
    const value = view.numeric[column.id];
    const unit = view.productionProduct
      ? `${view.productionProduct}/小时`
      : column.unit;
    return value === undefined
      ? "—"
      : `${formatNumber(value)} ${unit ?? ""}`.trim();
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

function tableCellColumns(view: BasicCalculatorRowView): Array<{
  column: BasicCalculatorColumn;
  colspan: number;
}> {
  const columns = groupColumns(view.group);
  const shouldMergeCells =
    config.value?.settings.mergeIdenticalEfficiencyCells &&
    calculationsReadyForMerge.value;
  const cells: Array<{ column: BasicCalculatorColumn; colspan: number }> = [];

  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (!column) continue;

    let colspan = 1;
    if (shouldMergeCells && column.kind === "efficiency") {
      const text = columnText(view, column);
      while (index + colspan < columns.length) {
        const nextColumn = columns[index + colspan];
        if (
          !nextColumn ||
          nextColumn.kind !== "efficiency" ||
          columnText(view, nextColumn) !== text
        ) {
          break;
        }
        colspan += 1;
      }
    } else if (
      shouldMergeCells &&
      (column.kind === "equivalentCurrentTradeEfficiency" ||
        column.kind === "equivalentLevelThreeTradeEfficiency")
    ) {
      const text = columnText(view, column);
      while (index + colspan < columns.length) {
        const nextColumn = columns[index + colspan];
        if (
          !nextColumn ||
          (nextColumn.kind !== "equivalentCurrentTradeEfficiency" &&
            nextColumn.kind !== "equivalentLevelThreeTradeEfficiency") ||
          columnText(view, nextColumn) !== text
        ) {
          break;
        }
        colspan += 1;
      }
    }

    cells.push({ column, colspan });
    index += colspan - 1;
  }

  return cells;
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

function updateGlobalFirstItemProgress(value: number | null): void {
  updateSetting(
    "firstItemProgress",
    value === null || !Number.isFinite(value)
      ? 0
      : Math.max(0, Math.min(100, value)) / 100,
  );
}

function updateBaseEfficiencyBonus(
  key: "tradingBaseEfficiencyBonus" | "manufactureBaseEfficiencyBonus",
  value: number | null,
): void {
  updateSetting(
    key,
    value === null || !Number.isFinite(value)
      ? 0
      : Math.max(0, Math.trunc(value)),
  );
}

function jieEfficiencyFallbackText(
  reason: NonNullable<
    BasicCalculatorRowCalculation["jieEfficiencyFallbackReason"]
  >,
): string {
  return reason === "fixedOrder"
    ? "遇到固定订单时，精0孑平均效率会回退到最高效率。"
    : "缺少订单分布时，精0孑平均效率会回退到最高效率。";
}

function toggleSort(group: BasicCalculatorGroup, columnId: string): void {
  const currentSort = groupSortState(group);
  updateConfig((draft) => {
    draft.settings.sortColumnId = columnId;
    draft.settings.sortDirection =
      currentSort.column?.id === columnId
        ? currentSort.direction === "asc"
          ? "desc"
          : "asc"
        : "desc";
    draft.settings.sortColumnCustomized = true;
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
  columnDraft.kind =
    props.mode === "efficiency" ? "operatorEfficiency" : "efficiency";
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
      EFFICIENCY_COLUMN_LABELS[columnDraft.kind] ||
      (columnDraft.kind === "efficiency"
        ? `${formatNumber(columnDraft.hours)}小时效率`
        : columnDraft.kind === "tradeOrders"
          ? "订单类型"
          : columnDraft.kind === "tradeBaseEfficiency"
            ? "基础效率"
            : "自定义列"),
    kind: columnDraft.kind,
    ...(columnDraft.kind === "efficiency"
      ? { hours: Math.max(0.01, columnDraft.hours), unit: "%" }
      : {}),
    ...(columnDraft.kind === "tradeBaseEfficiency"
      ? { unit: "龙门币/小时" }
      : {}),
    ...(columnDraft.kind === "baseProductionRate" ||
    columnDraft.kind === "actualProductionRate"
      ? { unit: "龙门币/小时" }
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

function setMergedRowPopoverOpen(
  groupId: string,
  rowId: string,
  open: boolean,
): void {
  const key = `${groupId}:${rowId}`;
  if (open) activeMergedRowPopover.value = key;
  else if (activeMergedRowPopover.value === key)
    activeMergedRowPopover.value = "";
}

function openMergedRowEditor(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): void {
  activeMergedRowPopover.value = "";
  openRowEditor(group, row);
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
    ...(group.coreOperator
      ? { hiddenOperators: [group.coreOperator.name] }
      : {}),
  };
  updateConfig((draft) => {
    draft.groups.find((item) => item.id === group.id)?.rows.push(row);
  });
  openRowEditor(group, row);
}

function openGroupEditor(group?: BasicCalculatorGroup): void {
  groupDraft.value = group
    ? {
        ...(JSON.parse(JSON.stringify(group)) as BasicCalculatorGroup),
        defaultProducts: {
          trading: group.defaultProducts?.trading ?? "",
          manufacture: group.defaultProducts?.manufacture ?? "",
        },
      }
    : {
        id: `group-${Date.now().toString(36)}`,
        name: props.mode === "efficiency" ? "新效率组" : "新组合组",
        facility: props.mode === "efficiency" ? "trading" : "manufacture",
        facilityLevel: 3,
        defaultProducts: { trading: "", manufacture: "" },
        ...(props.mode === "combination"
          ? { coreOperator: { name: operators.value[0]?.name ?? "红云" } }
          : {}),
        columnIds: config.value?.groups[0]?.columnIds ?? [],
        rows: [],
      };
  if (props.mode === "efficiency" && groupDraft.value) {
    delete groupDraft.value.coreOperator;
    groupDraft.value.facility = "trading";
  }
  groupModalOpen.value = true;
}

function saveGroup(): void {
  const draft = groupDraft.value;
  if (
    !draft ||
    !draft.name.trim() ||
    (draft.coreOperator &&
      (!draft.coreOperator.name ||
        !draft.facility ||
        draft.facilityLevel === undefined))
  )
    return;
  updateConfig((next) => {
    const index = next.groups.findIndex((group) => group.id === draft.id);
    const group = JSON.parse(JSON.stringify(draft)) as BasicCalculatorGroup;
    group.defaultProducts = {
      trading: draft.defaultProducts.trading,
      manufacture: draft.defaultProducts.manufacture,
    };
    if (props.mode === "efficiency") {
      delete group.coreOperator;
      group.facility = "trading";
    }
    if (index >= 0) {
      const previousGroup = next.groups[index]!;
      const previousCoreOperator = previousGroup.coreOperator;
      const nextCoreOperator = group.coreOperator;
      if (previousCoreOperator && nextCoreOperator) {
        group.rows = previousGroup.rows.map((row) => ({
          ...row,
          hiddenOperators:
            previousCoreOperator.name === nextCoreOperator.name
              ? row.hiddenOperators
              : [
                  ...new Set([
                    ...(row.hiddenOperators ?? []),
                    nextCoreOperator.name,
                  ]),
                ],
          schedule: synchronizeBasicCalculatorGroupSchedule(
            row.schedule,
            previousGroup,
            group,
          ),
        }));
      } else {
        group.rows = previousGroup.rows;
      }
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
    window.localStorage.removeItem(storageKey.value);
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
  return operatorProgression(group, operator).elite;
}

function operatorProgression(
  group: BasicCalculatorGroup,
  operator: BasicCalculatorOperator,
): ResolvedOperatorProgression {
  const data = operatorFor(operator.name);
  const profile = data ? catalog.value?.operators[data.name] : undefined;
  const facility = operator.room ?? group.facility ?? "manufacture";
  return resolveOperatorProgression({
    operatorId: data?.id ?? operator.name,
    facility,
    operatorSkillFile: profile?.skillFile,
    maxEliteLevel: data?.maxEliteLevel,
    manualElite: operator.elite,
    manualLevel: operator.level,
    profile: activeProfile.value,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  });
}

function displayOperatorProgressionSuffix(
  group: BasicCalculatorGroup,
  operator: BasicCalculatorOperator,
): string {
  const data = operatorFor(operator.name);
  const profile = data ? catalog.value?.operators[data.name] : undefined;
  const facility = operator.room ?? group.facility ?? "manufacture";
  const progression = operatorProgression(group, operator);
  const eliteSuffix =
    progression.elite === 1 ? "Ⅰ" : progression.elite === 2 ? "Ⅱ" : "";
  const unlocksAtLevel30 = progressionNodesForFacility(
    profile?.skillFile,
    facility,
    data?.rarity ?? 0,
  ).some((node) => node.type === "level" && node.value === 30);
  return `${eliteSuffix}${progression.level === 30 && unlocksAtLevel30 ? "(Lv30)" : ""}`;
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
          <h1>{{ calculatorTitle }}</h1>
          <p v-if="props.mode === 'combination'">
            按组合、产物和工作时长比较基建技能效果。
          </p>
        </div>
        <a-space wrap>
          <a-button :icon="h(SettingOutlined)" @click="openColumnEditor"
            >列设置</a-button
          >
          <a-button
            :icon="h(PlusOutlined)"
            type="primary"
            @click="openGroupEditor()"
            >{{
              props.mode === "efficiency" ? "新建效率组" : "新建组合组"
            }}</a-button
          >
          <a-popconfirm
            cancel-text="取消"
            ok-text="恢复"
            :title="`恢复默认${calculatorTitle}、列和页面设置？`"
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
        <a-form-item label="干员名称">
          <a-space wrap>
            <a-checkbox
              :checked="config.settings.showOperatorProgressionInNames"
              @change="
                updateSetting(
                  'showOperatorProgressionInNames',
                  $event.target.checked,
                )
              "
            >
              显示练度
            </a-checkbox>
            <a-checkbox
              :checked="config.settings.mergeIdenticalRows"
              @change="
                updateSetting('mergeIdenticalRows', $event.target.checked)
              "
            >
              合并相同内容
            </a-checkbox>
          </a-space>
        </a-form-item>
        <a-form-item v-if="props.mode === 'combination'" label="效率显示">
          <a-space wrap>
            <a-radio-group
              :value="config.settings.efficiencyDisplay"
              @change="updateSetting('efficiencyDisplay', $event.target.value)"
            >
              <a-radio-button value="first">合计</a-radio-button>
              <a-radio-button value="second">平均</a-radio-button>
              <a-radio-button value="both">两种</a-radio-button>
            </a-radio-group>
            <a-checkbox
              :checked="config.settings.mergeIdenticalEfficiencyCells"
              @change="
                updateSetting(
                  'mergeIdenticalEfficiencyCells',
                  $event.target.checked,
                )
              "
            >
              合并相同效率单元格
            </a-checkbox>
          </a-space>
        </a-form-item>
        <a-form-item v-if="props.mode === 'combination'" label="精0孑计算方式">
          <a-radio-group
            :value="config.settings.preferMaxJieEfficiency"
            @change="
              updateSetting('preferMaxJieEfficiency', $event.target.value)
            "
          >
            <a-radio-button :value="true">最高</a-radio-button>
            <a-radio-button :value="false">平均</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item v-if="props.mode === 'combination'" label="全局首件进度">
          <a-input-number
            :max="100"
            :min="0"
            :step="1"
            :value="config.settings.firstItemProgress * 100"
            addon-after="%"
            @update:value="updateGlobalFirstItemProgress"
          />
        </a-form-item>
        <a-form-item label="贸易站基础效率加值">
          <a-input-number
            :min="0"
            :precision="0"
            :step="1"
            :value="config.settings.tradingBaseEfficiencyBonus"
            addon-after="%"
            @update:value="
              updateBaseEfficiencyBonus('tradingBaseEfficiencyBonus', $event)
            "
          />
        </a-form-item>
        <a-form-item label="制造站基础效率加值">
          <a-input-number
            :min="0"
            :precision="0"
            :step="1"
            :value="config.settings.manufactureBaseEfficiencyBonus"
            addon-after="%"
            @update:value="
              updateBaseEfficiencyBonus(
                'manufactureBaseEfficiencyBonus',
                $event,
              )
            "
          />
        </a-form-item>
        <a-form-item v-if="props.mode === 'efficiency'" label="效率显示">
          <a-checkbox
            :checked="config.settings.mergeIdenticalEfficiencyCells"
            @change="
              updateSetting(
                'mergeIdenticalEfficiencyCells',
                $event.target.checked,
              )
            "
          >
            合并相同效率单元格
          </a-checkbox>
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
              <span v-if="props.mode === 'efficiency' && group.facility">
                {{ ROOM_LABELS[group.facility] }} ·
                {{ group.facilityLevel ?? 1 }}级
              </span>
              <span v-else-if="group.coreOperator && group.facility">
                {{ group.coreOperator.name }} ·
                {{ ROOM_LABELS[group.facility] }}
              </span>
              <span v-else>无核心干员</span>
              <span class="basic-calculator-group-header-actions" @click.stop>
                <a-button
                  :icon="h(EditOutlined)"
                  type="text"
                  @click="openGroupEditor(group)"
                />
                <a-popconfirm
                  cancel-text="取消"
                  ok-text="删除"
                  :title="`删除这个${props.mode === 'efficiency' ? '效率' : '组合'}组？`"
                  @confirm="deleteGroup(group.id)"
                >
                  <a-button :icon="h(DeleteOutlined)" danger type="text" />
                </a-popconfirm>
              </span>
            </div>
          </template>
          <div class="basic-calculator-group-toolbar">
            <span
              v-if="
                props.mode === 'combination' &&
                group.coreOperator &&
                group.facilityLevel !== undefined
              "
            >
              核心：{{ group.coreOperator.name }} · {{ group.facilityLevel }}级
            </span>
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
                    :class="{
                      'basic-calculator-efficiency-column':
                        column.kind === 'efficiency',
                    }"
                    :aria-sort="
                      groupSortState(group).column?.id === column.id
                        ? groupSortState(group).direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    "
                  >
                    <button
                      class="basic-calculator-sort-button"
                      type="button"
                      @click="toggleSort(group, column.id)"
                    >
                      <span>{{ column.label }}</span>
                      <SortAscendingOutlined
                        v-if="
                          groupSortState(group).column?.id === column.id &&
                          groupSortState(group).direction === 'asc'
                        "
                      />
                      <SortDescendingOutlined
                        v-else-if="
                          groupSortState(group).column?.id === column.id
                        "
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
                    <div
                      v-if="view.sourceRows.length === 1"
                      class="basic-calculator-row-actions"
                    >
                      <a-button
                        :icon="h(EditOutlined)"
                        aria-label="编辑行"
                        size="small"
                        type="text"
                        @click="openRowEditor(group, view.row)"
                      />
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
                    </div>
                    <div v-else class="basic-calculator-row-actions">
                      <a-popover
                        :open="
                          activeMergedRowPopover ===
                          `${group.id}:${view.row.id}`
                        "
                        placement="bottomLeft"
                        trigger="click"
                        @open-change="
                          setMergedRowPopoverOpen(group.id, view.row.id, $event)
                        "
                      >
                        <template #content>
                          <div class="basic-calculator-merged-row-actions">
                            <div
                              v-for="(sourceRow, index) in view.sourceRows"
                              :key="sourceRow.id"
                              class="basic-calculator-merged-row-action"
                            >
                              <span class="basic-calculator-merged-row-name">
                                {{
                                  operatorNameText(group, sourceRow) ||
                                  `未显示干员 ${index + 1}`
                                }}
                              </span>
                              <a-button
                                :icon="h(EditOutlined)"
                                :aria-label="`编辑${operatorNameText(group, sourceRow) || `第 ${index + 1} 行`}`"
                                size="small"
                                type="text"
                                @click="openMergedRowEditor(group, sourceRow)"
                              />
                              <a-popconfirm
                                cancel-text="取消"
                                ok-text="删除"
                                title="删除这一行？"
                                @confirm="deleteRow(group.id, sourceRow.id)"
                              >
                                <a-button
                                  :icon="h(DeleteOutlined)"
                                  :aria-label="`删除${operatorNameText(group, sourceRow) || `第 ${index + 1} 行`}`"
                                  danger
                                  size="small"
                                  type="text"
                                />
                              </a-popconfirm>
                            </div>
                          </div>
                        </template>
                        <a-button
                          :icon="h(MoreOutlined)"
                          aria-label="管理合并行"
                          size="small"
                          type="text"
                        />
                      </a-popover>
                    </div>
                  </td>
                  <td
                    v-for="cell in tableCellColumns(view)"
                    :key="cell.column.id"
                    :colspan="cell.colspan"
                    :class="{
                      'basic-calculator-efficiency-column':
                        cell.column.kind === 'efficiency',
                      'basic-calculator-name-cell':
                        cell.column.kind === 'operatorNames',
                      'basic-calculator-note-cell': cell.column.kind === 'note',
                    }"
                  >
                    <div
                      v-if="cell.column.kind === 'operators'"
                      class="basic-calculator-avatars"
                    >
                      <template
                        v-for="entry in viewVisibleOperators(view)"
                        :key="`${entry.rowId}-${entry.operator.name}`"
                      >
                        <span
                          v-if="entry.dividerBefore"
                          class="calculator-run-order-divider basic-calculator-run-order-divider"
                          title="跑单槽"
                        />
                        <OperatorAvatarDisplay
                          :display-name="entry.operator.name"
                          :elite-level="
                            operatorEliteLevel(view.group, entry.operator)
                          "
                          :operator="operatorFor(entry.operator.name)"
                          :plain="true"
                          :proportional-layout="true"
                          :show-elite-level="
                            config.settings.avatar.showEliteLevel
                          "
                          :show-profession="
                            config.settings.avatar.showProfession
                          "
                          :show-rarity="config.settings.avatar.showRarity"
                          :size="58"
                          :special-label="
                            operatorFor(entry.operator.name)
                              ? undefined
                              : entry.operator.name.slice(0, 2)
                          "
                        />
                      </template>
                    </div>
                    <span
                      v-else-if="cell.column.kind === 'operatorNames'"
                      class="basic-calculator-operator-name-list"
                    >
                      <template
                        v-for="part in viewVisibleOperatorNameParts(view)"
                        :key="part.key"
                      >
                        <span>{{ part.separator }}</span>
                        <span
                          v-if="part.dividerBefore"
                          class="calculator-run-order-divider basic-calculator-run-order-divider"
                          title="跑单槽"
                        />
                        <OperatorSkillTooltip
                          :operator="part.operator"
                          target-tag="span"
                        >
                          <span>{{ part.label }}</span>
                        </OperatorSkillTooltip>
                      </template>
                    </span>
                    <span
                      v-else-if="cell.column.kind === 'efficiency'"
                      class="basic-calculator-efficiency-value"
                    >
                      {{ columnText(view, cell.column) }}
                      <a-tooltip
                        v-if="
                          view.jieEfficiencyFallbackReason &&
                          !config.settings.preferMaxJieEfficiency
                        "
                        :title="
                          jieEfficiencyFallbackText(
                            view.jieEfficiencyFallbackReason,
                          )
                        "
                      >
                        <WarningOutlined
                          aria-label="精0孑平均效率回退"
                          class="basic-calculator-efficiency-fallback"
                        />
                      </a-tooltip>
                    </span>
                    <span v-else>{{ columnText(view, cell.column) }}</span>
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
            <template v-if="props.mode === 'combination'">
              <a-select-option value="efficiency">工作时间效率</a-select-option>
              <a-select-option value="operatorField"
                >干员 JSON 数值</a-select-option
              >
              <a-select-option value="storageDelta"
                >仓库容量差值</a-select-option
              >
              <a-select-option value="orderDelta">订单上限差值</a-select-option>
              <a-select-option value="note">备注</a-select-option>
            </template>
            <template v-else>
              <a-select-option value="operatorEfficiency"
                >干员效率</a-select-option
              >
              <a-select-option value="facilityEfficiency"
                >整站效率</a-select-option
              >
              <a-select-option value="equivalentCurrentTradeEfficiency"
                >等效当前贸易效率</a-select-option
              >
              <a-select-option value="equivalentLevelThreeTradeEfficiency"
                >等效3级贸易效率</a-select-option
              >
              <a-select-option value="equivalentManufactureEfficiency"
                >等效制造效率</a-select-option
              >
              <a-select-option value="baseProductionRate"
                >基础产出速率</a-select-option
              >
              <a-select-option value="actualProductionRate"
                >实际产出速率</a-select-option
              >
            </template>
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
      :title="`${props.mode === 'efficiency' ? '效率' : '组合'}组设置`"
      @cancel="groupModalOpen = false"
      @ok="saveGroup"
    >
      <a-form v-if="groupDraft" layout="vertical">
        <a-form-item
          :label="props.mode === 'efficiency' ? '效率组名称' : '组合组名称'"
          ><a-input v-model:value="groupDraft.name"
        /></a-form-item>
        <a-form-item v-if="groupDraft.coreOperator" label="核心干员">
          <a-select v-model:value="groupDraft.coreOperator.name" show-search>
            <a-select-option
              v-for="option in operatorOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item v-if="props.mode === 'efficiency'" label="工作设施">
          <a-input value="贸易站" disabled />
        </a-form-item>
        <a-form-item v-else-if="groupDraft.coreOperator" label="工作设施">
          <a-select v-model:value="groupDraft.facility">
            <a-select-option value="manufacture">制造站</a-select-option>
            <a-select-option value="trading">贸易站</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="props.mode === 'efficiency' || groupDraft.coreOperator"
          label="设施等级"
        >
          <a-input-number
            v-model:value="groupDraft.facilityLevel"
            :max="3"
            :min="1"
          />
        </a-form-item>
        <a-form-item label="贸易站默认产物">
          <a-select v-model:value="groupDraft.defaultProducts.trading">
            <a-select-option
              v-for="option in TRADING_PRODUCT_OPTIONS"
              :key="option.value || 'unspecified'"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item v-if="props.mode === 'combination'" label="制造站默认产物">
          <a-select v-model:value="groupDraft.defaultProducts.manufacture">
            <a-select-option
              v-for="option in MANUFACTURE_PRODUCT_OPTIONS"
              :key="option.value || 'unspecified'"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
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
        v-if="rowDraft && rowDraftGroup && rowDraftSchedule && config"
        class="basic-calculator-row-editor"
      >
        <a-space align="center">
          <span>开启跑单</span>
          <a-switch
            v-model:checked="rowDraftRunOrderEnabled"
            aria-label="开启跑单"
            size="small"
          />
        </a-space>
        <a-form v-if="props.mode === 'combination'" layout="vertical">
          <a-form-item
            :extra="`留空时使用全局首件进度 ${formatNumber(config.settings.firstItemProgress * 100)}%`"
            label="首件进度"
          >
            <a-input-number
              :max="100"
              :min="0"
              :placeholder="`全局 ${formatNumber(config.settings.firstItemProgress * 100)}%`"
              :step="1"
              :value="rowDraftFirstItemProgress"
              addon-after="%"
              @update:value="rowDraftFirstItemProgress = $event"
            />
          </a-form-item>
        </a-form>
        <BasicCalculatorScheduleEditor
          ref="rowEditor"
          v-model:model-value="rowDraftSchedule"
          :session-key="rowDraftGroupId + ':' + rowDraft.id"
          :fixed-operator="
            rowDraftGroup.coreOperator && rowDraftGroup.facility
              ? {
                  type: rowDraftGroup.facility,
                  name: rowDraftGroup.coreOperator.name,
                }
              : undefined
          "
          :facility-colors="facilityColors"
          :product-colors="productColors"
          :default-products="rowDraftGroup.defaultProducts"
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
.calculator-run-order-divider {
  align-self: center;
  flex: 0 0 1px;
  height: 40px;
  margin-inline: 8px;
  border-inline-start: 1px solid #b7c6c2;
}

.basic-calculator-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.basic-calculator-groups :deep(.ant-collapse-header) {
  align-items: center;
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
.basic-calculator-efficiency-column {
  min-inline-size: 104px;
}
.basic-calculator-efficiency-value {
  align-items: center;
  display: inline-flex;
  gap: 4px;
}
.basic-calculator-efficiency-fallback {
  color: #d48806;
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
.basic-calculator-avatars .basic-calculator-run-order-divider {
  height: 58px;
}
.basic-calculator-operator-name-list .basic-calculator-run-order-divider {
  display: inline-block;
  height: 14px;
  margin-inline: 4px;
  vertical-align: middle;
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
.basic-calculator-merged-row-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-block-size: 280px;
  max-inline-size: 420px;
  min-inline-size: 220px;
  overflow: auto;
}
.basic-calculator-merged-row-action {
  align-items: center;
  display: flex;
  gap: 4px;
}
.basic-calculator-merged-row-name {
  flex: 1;
  min-inline-size: 0;
  overflow-wrap: anywhere;
  text-align: start;
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
