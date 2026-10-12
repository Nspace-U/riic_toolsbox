import type {
  EfficiencyCatalog,
  EfficiencyResult,
  FacilityEfficiencyResult,
  EfficiencyRuleset,
  OperatorProgressionProfile,
  TradeOrderSummary,
} from "@arknights/riic-efficiency";
import type {
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import { DEFAULT_SOURCE_MATERIAL } from "@/utils/schedule";
import { calculateEfficiency } from "@arknights/riic-efficiency";

export type BasicCalculatorProductFacility = "trading" | "manufacture";
export type BasicCalculatorProductDefaults = Record<
  BasicCalculatorProductFacility,
  string
>;

export type BasicCalculatorColumnKind =
  | "operators"
  | "operatorNames"
  | "storageDelta"
  | "orderDelta"
  | "tradeOrders"
  | "tradeBaseEfficiency"
  | "operatorEfficiency"
  | "facilityEfficiency"
  | "equivalentCurrentTradeEfficiency"
  | "equivalentLevelThreeTradeEfficiency"
  | "equivalentManufactureEfficiency"
  | "baseProductionRate"
  | "actualProductionRate"
  | "efficiency"
  | "note"
  | "operatorField";

export type BasicCalculatorAggregate = "list" | "sum" | "max" | "min";

export interface BasicCalculatorColumn {
  id: string;
  label: string;
  kind: BasicCalculatorColumnKind;
  hours?: number;
  path?: string;
  unit?: string;
  aggregate?: BasicCalculatorAggregate;
  visible?: boolean;
}

export interface BasicCalculatorOperator {
  name: string;
  room?: RoomKey;
  runOrder?: boolean;
  mood?: number;
  elite?: number;
  level?: number;
}

export interface BasicCalculatorRow {
  id: string;
  schedule: ScheduleDocument;
  hiddenOperators?: string[];
}

export interface BasicCalculatorGroup {
  id: string;
  name: string;
  facility?: RoomKey;
  facilityLevel?: number;
  coreOperator?: BasicCalculatorOperator;
  defaultProducts?: BasicCalculatorProductDefaults;
  columnIds: string[];
  rows: BasicCalculatorRow[];
}

export interface BasicCalculatorSettings {
  avatar: {
    showAvatar: boolean;
    showProfession: boolean;
    showEliteLevel: boolean;
    showRarity: boolean;
  };
  showOperatorProgressionInNames: boolean;
  mergeIdenticalRows: boolean;
  mergeIdenticalEfficiencyCells: boolean;
  efficiencyDisplay: "first" | "second" | "both";
  preferMaxJieEfficiency: boolean;
  firstItemProgress: number;
  sortColumnId: string;
  sortDirection: "asc" | "desc";
  sortColumnCustomized: boolean;
}

export const DEFAULT_BASIC_CALCULATOR_SETTINGS: BasicCalculatorSettings = {
  avatar: {
    showAvatar: false,
    showProfession: false,
    showEliteLevel: false,
    showRarity: false,
  },
  showOperatorProgressionInNames: true,
  mergeIdenticalRows: true,
  mergeIdenticalEfficiencyCells: true,
  efficiencyDisplay: "first",
  preferMaxJieEfficiency: true,
  firstItemProgress: 0,
  sortColumnId: "efficiency-24",
  sortDirection: "desc",
  sortColumnCustomized: false,
};

export type BasicCalculatorAsset = Omit<BasicCalculatorConfig, "settings"> & {
  settings?: never;
};

export interface BasicCalculatorConfig {
  version: number;
  settings: BasicCalculatorSettings;
  columns: BasicCalculatorColumn[];
  groups: BasicCalculatorGroup[];
}

export interface BasicCalculatorPatch {
  version: number;
  settings?: Partial<Omit<BasicCalculatorSettings, "avatar">> & {
    avatar?: Partial<BasicCalculatorSettings["avatar"]>;
  };
  columnUpdates?: Record<string, BasicCalculatorColumn>;
  addedColumns?: BasicCalculatorColumn[];
  removedColumnIds?: string[];
  columnOrder?: string[];
  groupUpdates?: Record<
    string,
    Omit<BasicCalculatorGroup, "rows" | "columnIds">
  >;
  addedGroups?: BasicCalculatorGroup[];
  removedGroupIds?: string[];
  groupOrder?: string[];
  groupColumnIds?: Record<string, string[]>;
  rowUpdates?: Record<string, Record<string, BasicCalculatorRow>>;
  addedRows?: Record<string, BasicCalculatorRow[]>;
  removedRowIds?: Record<string, string[]>;
  rowOrder?: Record<string, string[]>;
}

export interface BasicCalculatorEvaluation {
  result: EfficiencyResult;
  facilityIndex: number;
  visibleResult: EfficiencyResult;
  visibleFacilityIndex: number;
  baselineEfficiency: number;
  workOperators: BasicCalculatorOperator[];
  participants: BasicCalculatorOperator[];
  hasCoreOperator: boolean;
}

export interface BasicCalculatorCalculationOptions {
  progressionProfile?: OperatorProgressionProfile;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
  preferMaxJieEfficiency?: boolean;
  firstItemProgress?: number;
  allowRowFirstItemProgressOverride?: boolean;
}

export interface BasicCalculatorRowCalculation {
  efficiency: Record<string, BasicCalculatorEfficiencyValue>;
  jieEfficiencyFallbackReason?: "fixedOrder" | "missingOrders";
  storageDelta?: number;
  orderDelta?: number;
  tradeOrderRule?: string;
  tradeOrders?: TradeOrderSummary[];
  tradeBaseEfficiency?: number;
  operatorEfficiency?: number;
  facilityEfficiency?: number;
  equivalentCurrentTradeEfficiency?: number;
  equivalentLevelThreeTradeEfficiency?: number;
  equivalentManufactureEfficiency?: number;
  baseProductionRate?: number;
  actualProductionRate?: number;
  productionProduct?: string;
}

export interface BasicCalculatorWorkerRequest {
  type: "calculate";
  requestId: number;
  catalog: EfficiencyCatalog;
  groups: BasicCalculatorGroup[];
  columns: BasicCalculatorColumn[];
  progressionProfile?: OperatorProgressionProfile;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
  preferMaxJieEfficiency: boolean;
  firstItemProgress: number;
  allowRowFirstItemProgressOverride: boolean;
}

export interface BasicCalculatorWorkerResponse {
  requestId: number;
  results?: Record<string, BasicCalculatorRowCalculation>;
  error?: string;
}

export interface BasicCalculatorEfficiencyValue {
  first: number;
  second?: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeConfig(config: BasicCalculatorConfig): BasicCalculatorConfig {
  const normalized = clone(config);
  normalized.groups.forEach((group) => {
    group.defaultProducts = {
      trading: group.defaultProducts?.trading ?? "",
      manufacture: group.defaultProducts?.manufacture ?? "",
    };
    group.rows.forEach((row) => {
      row.schedule.plans.forEach((plan) => {
        delete plan.name;
        delete plan.duration;
      });
    });
  });
  return normalized;
}

function sameValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function reorder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result = order.flatMap((id) => {
    const item = byId.get(id);
    if (!item) {
      return [];
    }
    byId.delete(id);
    return [item];
  });
  return [...result, ...byId.values()];
}

function groupWithoutOrder(
  group: BasicCalculatorGroup,
): Omit<BasicCalculatorGroup, "rows" | "columnIds"> {
  const result = clone(group) as unknown as Record<string, unknown>;
  delete result.rows;
  delete result.columnIds;
  return result as Omit<BasicCalculatorGroup, "rows" | "columnIds">;
}

export function cloneBasicCalculatorConfig(
  config: BasicCalculatorConfig,
): BasicCalculatorConfig {
  return normalizeConfig(config);
}

export function createBasicCalculatorConfig(
  asset: BasicCalculatorAsset,
): BasicCalculatorConfig {
  return normalizeConfig({
    ...clone(asset),
    settings: clone(DEFAULT_BASIC_CALCULATOR_SETTINGS),
  });
}

export function applyBasicCalculatorPatch(
  defaults: BasicCalculatorConfig,
  patch: BasicCalculatorPatch | undefined,
): BasicCalculatorConfig {
  if (!patch || patch.version !== defaults.version) {
    return normalizeConfig(defaults);
  }

  const config = cloneBasicCalculatorConfig(defaults);
  const removedGroups = new Set(patch.removedGroupIds ?? []);
  const removedColumns = new Set(patch.removedColumnIds ?? []);
  config.groups = config.groups.filter((group) => !removedGroups.has(group.id));
  config.columns = config.columns.filter(
    (column) => !removedColumns.has(column.id),
  );

  patch.addedGroups?.forEach((group) => {
    if (!config.groups.some((item) => item.id === group.id)) {
      config.groups.push(clone(group));
    }
  });
  patch.addedColumns?.forEach((column) => {
    if (!config.columns.some((item) => item.id === column.id)) {
      config.columns.push(clone(column));
    }
  });

  config.columns = config.columns.map((column) => {
    const update = patch.columnUpdates?.[column.id];
    return update ? { ...column, ...clone(update) } : column;
  });
  config.groups = config.groups.map((group) => {
    const update = patch.groupUpdates?.[group.id];
    const nextGroup = update ? { ...group, ...clone(update) } : group;
    const removedRows = new Set(patch.removedRowIds?.[group.id] ?? []);
    const rowUpdates = patch.rowUpdates?.[group.id] ?? {};
    const rows = nextGroup.rows
      .filter((row) => !removedRows.has(row.id))
      .map((row) =>
        rowUpdates[row.id] ? { ...row, ...clone(rowUpdates[row.id]) } : row,
      );
    const nextRows = [...rows, ...(patch.addedRows?.[group.id] ?? [])];
    const order = patch.rowOrder?.[group.id];
    return {
      ...nextGroup,
      columnIds: patch.groupColumnIds?.[group.id] ?? nextGroup.columnIds,
      rows: order ? reorder(nextRows, order) : nextRows,
    };
  });

  if (patch.settings) {
    const avatar = patch.settings.avatar;
    const sortColumnCustomized =
      patch.settings.sortColumnCustomized ??
      (patch.settings.sortColumnId !== undefined ||
        patch.settings.sortDirection !== undefined);
    config.settings = {
      ...config.settings,
      ...clone(patch.settings),
      sortColumnCustomized,
      avatar: {
        ...config.settings.avatar,
        ...(avatar?.showAvatar === undefined
          ? {}
          : { showAvatar: avatar.showAvatar }),
        ...(avatar?.showProfession === undefined
          ? {}
          : { showProfession: avatar.showProfession }),
        ...(avatar?.showEliteLevel === undefined
          ? {}
          : { showEliteLevel: avatar.showEliteLevel }),
        ...(avatar?.showRarity === undefined
          ? {}
          : { showRarity: avatar.showRarity }),
      },
    };
  }
  if (patch.columnOrder) {
    config.columns = reorder(config.columns, patch.columnOrder);
  }
  if (patch.groupOrder) {
    config.groups = reorder(config.groups, patch.groupOrder);
  }
  return normalizeConfig(config);
}

export function createBasicCalculatorPatch(
  defaultConfig: BasicCalculatorConfig,
  currentConfig: BasicCalculatorConfig,
): BasicCalculatorPatch {
  const defaults = normalizeConfig(defaultConfig);
  const current = normalizeConfig(currentConfig);
  const patch: BasicCalculatorPatch = { version: defaults.version };
  const defaultGroups = new Map(
    defaults.groups.map((group) => [group.id, group]),
  );
  const currentGroups = new Map(
    current.groups.map((group) => [group.id, group]),
  );
  const defaultColumns = new Map(
    defaults.columns.map((column) => [column.id, column]),
  );
  const currentColumns = new Map(
    current.columns.map((column) => [column.id, column]),
  );

  const settings: BasicCalculatorPatch["settings"] = {};
  const avatarSettings: Partial<BasicCalculatorSettings["avatar"]> = {};
  (
    Object.keys(defaults.settings) as Array<keyof BasicCalculatorSettings>
  ).forEach((key) => {
    if (key === "avatar") return;
    if (!sameValue(defaults.settings[key], current.settings[key])) {
      settings[key] = current.settings[key] as never;
    }
  });
  (
    Object.keys(defaults.settings.avatar) as Array<
      keyof BasicCalculatorSettings["avatar"]
    >
  ).forEach((key) => {
    if (defaults.settings.avatar[key] !== current.settings.avatar[key]) {
      avatarSettings[key] = current.settings.avatar[key];
    }
  });
  if (Object.keys(avatarSettings).length > 0) {
    settings.avatar = avatarSettings;
  }
  if (Object.keys(settings).length > 0) {
    patch.settings = settings;
  }

  const columnUpdates: Record<string, BasicCalculatorColumn> = {};
  const addedColumns: BasicCalculatorColumn[] = [];
  const removedColumnIds: string[] = [];
  currentColumns.forEach((column, id) => {
    if (!defaultColumns.has(id)) {
      addedColumns.push(clone(column));
    } else if (!sameValue(column, defaultColumns.get(id))) {
      columnUpdates[id] = clone(column);
    }
  });
  defaultColumns.forEach((_column, id) => {
    if (!currentColumns.has(id)) {
      removedColumnIds.push(id);
    }
  });
  if (Object.keys(columnUpdates).length > 0)
    patch.columnUpdates = columnUpdates;
  if (addedColumns.length > 0) patch.addedColumns = addedColumns;
  if (removedColumnIds.length > 0) patch.removedColumnIds = removedColumnIds;
  if (
    !sameValue(
      defaults.columns.map(({ id }) => id),
      current.columns.map(({ id }) => id),
    )
  ) {
    patch.columnOrder = current.columns.map(({ id }) => id);
  }

  const addedGroups: BasicCalculatorGroup[] = [];
  const removedGroupIds: string[] = [];
  const groupUpdates: Record<
    string,
    Omit<BasicCalculatorGroup, "rows" | "columnIds">
  > = {};
  const rowUpdates: Record<string, Record<string, BasicCalculatorRow>> = {};
  const addedRows: Record<string, BasicCalculatorRow[]> = {};
  const removedRowIds: Record<string, string[]> = {};
  const rowOrder: Record<string, string[]> = {};
  const groupColumnIds: Record<string, string[]> = {};

  currentGroups.forEach((group, id) => {
    const defaultGroup = defaultGroups.get(id);
    if (!defaultGroup) {
      addedGroups.push(clone(group));
      return;
    }
    if (!sameValue(groupWithoutOrder(group), groupWithoutOrder(defaultGroup))) {
      groupUpdates[id] = groupWithoutOrder(group);
    }
    if (!sameValue(group.columnIds, defaultGroup.columnIds)) {
      groupColumnIds[id] = [...group.columnIds];
    }
    const defaultRows = new Map(defaultGroup.rows.map((row) => [row.id, row]));
    const currentRows = new Map(group.rows.map((row) => [row.id, row]));
    currentRows.forEach((row, rowId) => {
      if (!defaultRows.has(rowId)) {
        addedRows[id] = [...(addedRows[id] ?? []), clone(row)];
      } else if (!sameValue(row, defaultRows.get(rowId))) {
        rowUpdates[id] = { ...(rowUpdates[id] ?? {}), [rowId]: clone(row) };
      }
    });
    defaultRows.forEach((_row, rowId) => {
      if (!currentRows.has(rowId)) {
        removedRowIds[id] = [...(removedRowIds[id] ?? []), rowId];
      }
    });
    if (
      !sameValue(
        defaultGroup.rows.map(({ id: rowId }) => rowId),
        group.rows.map(({ id: rowId }) => rowId),
      )
    ) {
      rowOrder[id] = group.rows.map(({ id: rowId }) => rowId);
    }
  });
  defaultGroups.forEach((_group, id) => {
    if (!currentGroups.has(id)) removedGroupIds.push(id);
  });
  if (addedGroups.length > 0) patch.addedGroups = addedGroups;
  if (removedGroupIds.length > 0) patch.removedGroupIds = removedGroupIds;
  if (Object.keys(groupUpdates).length > 0) patch.groupUpdates = groupUpdates;
  if (Object.keys(rowUpdates).length > 0) patch.rowUpdates = rowUpdates;
  if (Object.keys(addedRows).length > 0) patch.addedRows = addedRows;
  if (Object.keys(removedRowIds).length > 0)
    patch.removedRowIds = removedRowIds;
  if (Object.keys(rowOrder).length > 0) patch.rowOrder = rowOrder;
  if (Object.keys(groupColumnIds).length > 0)
    patch.groupColumnIds = groupColumnIds;
  if (
    !sameValue(
      defaults.groups.map(({ id }) => id),
      current.groups.map(({ id }) => id),
    )
  ) {
    patch.groupOrder = current.groups.map(({ id }) => id);
  }
  return patch;
}

function uniqueOperators(
  operators: BasicCalculatorOperator[],
): BasicCalculatorOperator[] {
  const seen = new Set<string>();
  return operators.filter((operator) => {
    if (seen.has(operator.name)) {
      return false;
    }
    seen.add(operator.name);
    return true;
  });
}

export function basicCalculatorRoomAssignment(
  document: ScheduleDocument,
  type: RoomKey,
  position: number = 0,
): RoomAssignment | undefined {
  const assignments = document.plans[0]?.rooms[type];
  return Array.isArray(assignments)
    ? (assignments[position] as RoomAssignment | undefined)
    : undefined;
}

export function basicCalculatorProductForRoom(
  defaults: BasicCalculatorProductDefaults | undefined,
  type: RoomKey,
  assignment: RoomAssignment | undefined,
): string | undefined {
  if (assignment?.productOverride) return undefined;
  if (assignment?.product) return assignment.product;
  if (type !== "trading" && type !== "manufacture") return undefined;
  return defaults?.[type] || undefined;
}

function rowWithGroupProductDefaults(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): BasicCalculatorRow {
  const next = clone(row);
  next.schedule.plans.forEach((plan) => {
    (["trading", "manufacture"] as const).forEach((type) => {
      const assignments = plan.rooms[type];
      if (!Array.isArray(assignments)) return;
      (assignments as RoomAssignment[]).forEach((assignment) => {
        if (assignment.productOverride) {
          delete assignment.product;
          delete assignment.sourceMaterial;
          return;
        }
        const product = basicCalculatorProductForRoom(
          group.defaultProducts,
          type,
          assignment,
        );
        if (product) assignment.product = product;
        else delete assignment.product;
        if (product === "源石碎片" && !assignment.sourceMaterial) {
          assignment.sourceMaterial = DEFAULT_SOURCE_MATERIAL;
        }
      });
    });
  });
  return next;
}

export function basicCalculatorScheduleOperators(
  document: ScheduleDocument,
  defaultProducts?: BasicCalculatorProductDefaults,
): BasicCalculatorOperator[] {
  const positions = new Map<RoomKey, number>();
  const operators = document.layout.flatMap(({ type }) => {
    const position = positions.get(type) ?? 0;
    positions.set(type, position + 1);
    const assignment = basicCalculatorRoomAssignment(document, type, position);
    return [
      ...(assignment?.operators ?? []).map((name) => ({
        name,
        room: type,
        ...(assignment?.operatorStates?.[name] ?? {}),
      })),
      ...(document.settings?.runOrderEnabled === true &&
      type === "trading" &&
      assignment !== undefined &&
      basicCalculatorProductForRoom(defaultProducts, type, assignment) !==
        "合成玉"
        ? (assignment.runOrderOperators ?? []).map((name) => ({
            name,
            room: type,
            runOrder: true,
            ...(assignment.operatorStates?.[name] ?? {}),
          }))
        : []),
    ];
  });
  return uniqueOperators(operators);
}

export function basicCalculatorTargetFacility(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): RoomKey | undefined {
  if (group.facility) return group.facility;
  const isWorkFacility = (type: RoomKey): boolean =>
    type !== "control" && type !== "dormitory";
  return (
    basicCalculatorScheduleOperators(row.schedule, group.defaultProducts).find(
      (operator) => operator.room && isWorkFacility(operator.room),
    )?.room ??
    row.schedule.layout.find(({ type }) => isWorkFacility(type))?.type
  );
}

export function basicCalculatorOperatorFieldNames(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): string[] {
  const facility = basicCalculatorTargetFacility(group, row);
  const assignment = facility
    ? basicCalculatorRoomAssignment(row.schedule, facility)
    : undefined;
  const control = basicCalculatorRoomAssignment(row.schedule, "control");
  return uniqueOperators([
    ...(group.coreOperator ? [{ name: group.coreOperator.name }] : []),
    ...(assignment?.operators ?? []).map((name) => ({ name })),
    ...(control?.operators ?? []).map((name) => ({ name })),
  ]).map(({ name }) => name);
}

export function createBasicCalculatorSchedule(
  group: BasicCalculatorGroup,
): ScheduleDocument {
  if (
    !group.coreOperator ||
    !group.facility ||
    group.facilityLevel === undefined
  ) {
    return { layout: [], plans: [{ rooms: {} }] };
  }
  return {
    layout: [{ type: group.facility, level: group.facilityLevel }],
    plans: [
      {
        rooms: {
          [group.facility]: [{ operators: [group.coreOperator.name] }],
        },
      },
    ],
  };
}

export function synchronizeBasicCalculatorGroupSchedule(
  schedule: ScheduleDocument,
  previousGroup: BasicCalculatorGroup,
  nextGroup: BasicCalculatorGroup,
): ScheduleDocument {
  const previousCoreOperator = previousGroup.coreOperator;
  const nextCoreOperator = nextGroup.coreOperator;
  const previousFacility = previousGroup.facility;
  const nextFacility = nextGroup.facility;
  const nextFacilityLevel = nextGroup.facilityLevel;
  if (
    !previousCoreOperator ||
    !nextCoreOperator ||
    !previousFacility ||
    !nextFacility ||
    nextFacilityLevel === undefined
  ) {
    return clone(schedule);
  }
  const document = clone(schedule);
  const priorLayout = [...document.layout];
  const affectedTypes = new Set(priorLayout.map(({ type }) => type));
  let coreEntry = priorLayout.find((entry) => entry.type === previousFacility);
  if (!coreEntry) {
    coreEntry = { type: nextFacility, level: nextFacilityLevel };
    priorLayout.push(coreEntry);
  }
  const assignmentsByPlan = document.plans.map((plan) => {
    const assignments = new Map<
      ScheduleDocument["layout"][number],
      RoomAssignment
    >();
    const positions = new Map<RoomKey, number>();
    priorLayout.forEach((entry) => {
      const position = positions.get(entry.type) ?? 0;
      positions.set(entry.type, position + 1);
      const rooms = plan.rooms[entry.type];
      assignments.set(
        entry,
        Array.isArray(rooms)
          ? clone((rooms[position] as RoomAssignment | undefined) ?? {})
          : {},
      );
    });
    return assignments;
  });
  const incomingStates = assignmentsByPlan.flatMap((assignments) =>
    [...assignments.values()].flatMap((assignment) => {
      const state = assignment.operatorStates?.[nextCoreOperator.name];
      return state ? [clone(state)] : [];
    }),
  );
  coreEntry.type = nextFacility;
  coreEntry.level = nextFacilityLevel;
  affectedTypes.add(nextFacility);
  if (previousFacility !== nextFacility) {
    const entryIndex = priorLayout.indexOf(coreEntry);
    priorLayout.splice(entryIndex, 1);
    const firstSameType = priorLayout.findIndex(
      (entry) => entry.type === nextFacility,
    );
    priorLayout.splice(
      firstSameType < 0 ? priorLayout.length : firstSameType,
      0,
      coreEntry,
    );
  }

  document.plans.forEach((plan, planIndex) => {
    const assignments = assignmentsByPlan[planIndex]!;
    const target = assignments.get(coreEntry) ?? {};
    const coreName = nextCoreOperator.name;
    const oldCoreName = previousCoreOperator.name;
    let preservedState = target.operatorStates?.[coreName];
    if (!preservedState) preservedState = incomingStates[0];

    assignments.forEach((assignment, entry) => {
      if (entry === coreEntry) return;
      if (
        !assignment.operators?.includes(coreName) &&
        !assignment.operators?.includes(oldCoreName)
      )
        return;
      assignment.operators = assignment.operators?.filter(
        (name) => name !== coreName && name !== oldCoreName,
      );
      if (assignment.operatorStates) {
        delete assignment.operatorStates[coreName];
        delete assignment.operatorStates[oldCoreName];
        if (!Object.keys(assignment.operatorStates).length)
          delete assignment.operatorStates;
      }
    });

    const targetNames = target.operators ?? [];
    target.operators = [
      coreName,
      ...targetNames.filter(
        (name) => name !== coreName && name !== oldCoreName,
      ),
    ];
    const targetStates = target.operatorStates ?? {};
    if (oldCoreName !== coreName) delete targetStates[oldCoreName];
    if (preservedState) targetStates[coreName] = preservedState;
    if (Object.keys(targetStates).length) target.operatorStates = targetStates;
    else delete target.operatorStates;
    if (previousFacility !== nextFacility) {
      delete target.product;
      delete target.sourceMaterial;
    }
    assignments.set(coreEntry, target);

    const rooms = { ...plan.rooms };
    affectedTypes.forEach((type) => delete rooms[type]);
    priorLayout.forEach((entry) => {
      const entries = (rooms[entry.type] ?? []) as RoomAssignment[];
      entries.push(assignments.get(entry) ?? {});
      rooms[entry.type] = entries;
    });
    plan.rooms = rooms;
  });
  document.layout = priorLayout;
  return document;
}

function stateForAssignment(
  assignment: RoomAssignment | undefined,
  name: string,
): BasicCalculatorOperator {
  return {
    name,
    ...(assignment?.operatorStates?.[name] ?? {}),
  };
}

function scheduleForCalculation(
  schedule: ScheduleDocument,
  durationHours: number,
  options: BasicCalculatorCalculationOptions,
): ScheduleDocument {
  const document = clone(schedule);
  document.plans.forEach((plan) => {
    (["trading", "manufacture"] as const).forEach((type) => {
      const assignments = plan.rooms[type];
      if (!Array.isArray(assignments)) return;
      (assignments as RoomAssignment[]).forEach((assignment) => {
        delete assignment.productOverride;
      });
    });
  });
  const plan = document.plans[0];
  if (plan) plan.duration = Math.round(durationHours * 60);
  const rowFirstItemProgress = schedule.settings?.firstItemProgress;
  document.settings = {
    ...document.settings,
    clueExchanging: document.settings?.clueExchanging ?? true,
    dormFullTreat: document.settings?.dormFullTreat ?? true,
    preferMaxJieEfficiency: options.preferMaxJieEfficiency ?? true,
    firstItemProgress:
      options.allowRowFirstItemProgressOverride &&
      typeof rowFirstItemProgress === "number"
        ? rowFirstItemProgress
        : (options.firstItemProgress ?? 0),
  };
  return document;
}

function coreOnlySchedule(
  document: ScheduleDocument,
  facility: RoomKey,
  facilityLevel: number,
  core: BasicCalculatorOperator,
): ScheduleDocument {
  const targetAssignment = basicCalculatorRoomAssignment(document, facility);
  const assignment = clone(targetAssignment ?? {});
  assignment.operators = [core.name];
  const state = targetAssignment?.operatorStates?.[core.name];
  if (state) assignment.operatorStates = { [core.name]: clone(state) };
  else delete assignment.operatorStates;
  const targetEntry = document.layout.find((entry) => entry.type === facility);
  return {
    layout: [
      {
        type: facility,
        level: targetEntry?.level ?? facilityLevel,
      },
    ],
    plans: [
      {
        duration: 1440,
        rooms: { [facility]: [assignment] },
      },
    ],
    ...(document.settings ? { settings: clone(document.settings) } : {}),
  };
}

function coreBaselineEfficiency(
  catalog: EfficiencyCatalog,
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
  options: BasicCalculatorCalculationOptions,
): number {
  const facility = group.facility;
  const facilityLevel = group.facilityLevel;
  const coreOperator = group.coreOperator;
  if (!facility || facilityLevel === undefined || !coreOperator) return 0;
  const baselineOptions =
    group.id === "jie-0" && coreOperator.name === "孑"
      ? { ...options, preferMaxJieEfficiency: true }
      : options;
  const effectiveRow = rowWithGroupProductDefaults(group, row);
  const document = scheduleForCalculation(
    effectiveRow.schedule,
    24,
    baselineOptions,
  );
  const assignment = basicCalculatorRoomAssignment(document, facility);
  const core = stateForAssignment(assignment, coreOperator.name);
  const result = calculateEfficiencyForBasicCalculator(
    coreOnlySchedule(document, facility, facilityLevel, core),
    catalog,
    baselineOptions,
  );
  return (
    result.plans[0]?.facilities.find(
      (resultFacility) => resultFacility.facility.type === facility,
    )?.skillEfficiency ?? 0
  );
}

export function evaluateBasicCalculatorRow(
  catalog: EfficiencyCatalog,
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
  durationHours: number,
  options: BasicCalculatorCalculationOptions = {},
  baselineEfficiency?: number,
): BasicCalculatorEvaluation {
  const effectiveRow = rowWithGroupProductDefaults(group, row);
  const targetFacility = basicCalculatorTargetFacility(group, effectiveRow);
  if (!targetFacility) {
    throw new Error("当前排班没有可计算的工作设施");
  }
  const document = scheduleForCalculation(
    effectiveRow.schedule,
    durationHours,
    options,
  );
  const result = calculateEfficiencyForBasicCalculator(
    document,
    catalog,
    options,
  );
  const targetAssignment = basicCalculatorRoomAssignment(
    document,
    targetFacility,
  );
  const core = group.coreOperator
    ? stateForAssignment(targetAssignment, group.coreOperator.name)
    : undefined;
  const workOperators = uniqueOperators([
    ...(core ? [core] : []),
    ...(targetAssignment?.operators ?? []).map((name) =>
      stateForAssignment(targetAssignment, name),
    ),
  ]);
  const visibleDocument = clone(document);
  const visibleAssignment = basicCalculatorRoomAssignment(
    visibleDocument,
    targetFacility,
  );
  if (visibleAssignment && core) {
    visibleAssignment.operators = visibleAssignment.operators?.filter(
      (name) => name !== core.name,
    );
    if (visibleAssignment.operatorStates) {
      delete visibleAssignment.operatorStates[core.name];
      if (!Object.keys(visibleAssignment.operatorStates).length)
        delete visibleAssignment.operatorStates;
    }
  }
  const visibleResult = calculateEfficiencyForBasicCalculator(
    visibleDocument,
    catalog,
    options,
  );
  const baseline =
    baselineEfficiency ??
    coreBaselineEfficiency(catalog, group, effectiveRow, options);
  const facilityIndex =
    result.plans[0]?.facilities.findIndex(
      (facility) => facility.facility.type === targetFacility,
    ) ?? -1;
  const visibleFacilityIndex =
    visibleResult.plans[0]?.facilities.findIndex(
      (facility) => facility.facility.type === targetFacility,
    ) ?? -1;
  return {
    result,
    facilityIndex,
    visibleResult,
    visibleFacilityIndex,
    baselineEfficiency: baseline,
    workOperators,
    participants: workOperators,
    hasCoreOperator: core !== undefined,
  };
}

export function calculateBasicCalculatorRowValues(
  catalog: EfficiencyCatalog,
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
  columns: BasicCalculatorColumn[],
  options: BasicCalculatorCalculationOptions = {},
): BasicCalculatorRowCalculation {
  const hours = new Set(
    columns
      .filter((column) => column.kind === "efficiency")
      .map((column) => column.hours ?? 24),
  );
  hours.add(24);
  const efficiency: Record<string, BasicCalculatorEfficiencyValue> = {};
  if (!basicCalculatorTargetFacility(group, row)) return { efficiency };
  const baselineEfficiency = coreBaselineEfficiency(
    catalog,
    group,
    row,
    options,
  );
  let evaluation24: BasicCalculatorEvaluation | undefined;
  [...hours].forEach((duration) => {
    const evaluation = evaluateBasicCalculatorRow(
      catalog,
      group,
      row,
      duration,
      options,
      baselineEfficiency,
    );
    if (duration === 24) evaluation24 = evaluation;
    efficiency[String(duration)] = basicCalculatorEfficiencyValue(evaluation);
  });
  const visibleFacility = evaluation24
    ? visibleFacilityResultOf(evaluation24)
    : undefined;
  const targetFacility = evaluation24
    ? facilityResultOf(evaluation24)
    : undefined;
  const production = targetFacility?.production;
  const fallbackCalculation =
    options.preferMaxJieEfficiency === false
      ? targetFacility?.details
          .map((detail) => detail.calculation)
          .find(
            (calculation) =>
              calculation?.type === "tradeGap" &&
              calculation.fallbackReason !== undefined,
          )
      : undefined;
  const jieEfficiencyFallbackReason =
    fallbackCalculation?.type === "tradeGap"
      ? fallbackCalculation.fallbackReason
      : undefined;
  const equivalentValues = basicCalculatorTradeEquivalentValues(
    targetFacility,
    catalog.ruleset,
  );
  return {
    efficiency,
    ...(jieEfficiencyFallbackReason ? { jieEfficiencyFallbackReason } : {}),
    storageDelta: visibleFacility?.attributes.storageCap?.skill ?? 0,
    orderDelta: visibleFacility?.attributes.orderLimit?.skill ?? 0,
    operatorEfficiency: targetFacility?.operatorSkillEfficiency,
    facilityEfficiency: targetFacility?.efficiency,
    ...equivalentValues,
    ...(production
      ? {
          baseProductionRate: production.baseAmountPerHour,
          actualProductionRate:
            production.effectiveAmountPerHour ?? production.amountPerHour,
          productionProduct: production.product,
        }
      : {}),
    ...(production?.product === "龙门币"
      ? {
          tradeOrderRule: production.orderRule,
          tradeOrders: production.orders,
          tradeBaseEfficiency: production.baseAmountPerHour,
        }
      : {}),
  };
}

function basicCalculatorTradeEquivalentValues(
  facility: FacilityEfficiencyResult | undefined,
  ruleset: EfficiencyRuleset | undefined,
): Pick<
  BasicCalculatorRowCalculation,
  | "equivalentCurrentTradeEfficiency"
  | "equivalentLevelThreeTradeEfficiency"
  | "equivalentManufactureEfficiency"
> {
  const production = facility?.production;
  if (
    !facility ||
    !ruleset ||
    facility.facility.type !== "trading" ||
    production?.product !== "龙门币" ||
    !production.orderRule ||
    production.orderRule === "龙门商法"
  ) {
    return {};
  }

  const currentBase = basicCalculatorTradeBaseRates(
    ruleset,
    facility.facility.level,
  );
  const levelThreeBase = basicCalculatorTradeBaseRates(ruleset, 3);
  if (!currentBase || !levelThreeBase) return {};

  const goldRule = ruleset.manufactureRules["赤金"];
  const lmdPerGold = currentBase.lmdPerHour / currentBase.goldPerHour;
  const goldManufactureRate = goldRule ? goldRule.amount / goldRule.hours : 0;
  const extraGoldPerHour =
    production.amountPerHour / lmdPerGold +
    (production.materialPerHour?.["赤金"] ?? 0);

  return {
    equivalentCurrentTradeEfficiency:
      (production.amountPerHour / currentBase.lmdPerHour) * 100,
    equivalentLevelThreeTradeEfficiency:
      (production.amountPerHour / levelThreeBase.lmdPerHour) * 100,
    ...(goldManufactureRate > 0 && extraGoldPerHour > 0.000001
      ? {
          equivalentManufactureEfficiency:
            (extraGoldPerHour / goldManufactureRate) * 100,
        }
      : {}),
  };
}

function basicCalculatorTradeBaseRates(
  ruleset: EfficiencyRuleset,
  level: number,
): { lmdPerHour: number; goldPerHour: number } | undefined {
  const orders =
    ruleset.tradeOrdersByLevel[level] ?? ruleset.tradeOrdersByLevel[1] ?? [];
  let lmd = 0;
  let gold = 0;
  let hours = 0;
  for (const order of orders) {
    lmd += order.probability * order.gold;
    gold += order.probability * order.amount;
    hours += order.probability * order.hours;
  }
  if (hours <= 0 || lmd <= 0 || gold <= 0) return undefined;
  return { lmdPerHour: lmd / hours, goldPerHour: gold / hours };
}

function calculateEfficiencyForBasicCalculator(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
  options: BasicCalculatorCalculationOptions,
): EfficiencyResult {
  return calculateEfficiency(
    {
      ...document,
      settings: {
        ...document.settings,
        ...(options.progressionProfile
          ? { progressionProfile: options.progressionProfile }
          : {}),
        ...(options.dormitoryDefaultIncludesMoodRecovery === undefined
          ? {}
          : {
              dormitoryDefaultIncludesMoodRecovery:
                options.dormitoryDefaultIncludesMoodRecovery,
            }),
        treatSkillsAsUnlocked: false,
      },
    },
    { catalog, ruleset: catalog.ruleset },
  );
}

export function facilityResultOf(
  evaluation: BasicCalculatorEvaluation,
): FacilityEfficiencyResult | undefined {
  return evaluation.result.plans[0]?.facilities[evaluation.facilityIndex];
}

export function visibleFacilityResultOf(
  evaluation: BasicCalculatorEvaluation,
): FacilityEfficiencyResult | undefined {
  return evaluation.visibleResult.plans[0]?.facilities[
    evaluation.visibleFacilityIndex
  ];
}

export function basicCalculatorEfficiencyValue(
  evaluation: BasicCalculatorEvaluation,
): BasicCalculatorEfficiencyValue {
  const facility = facilityResultOf(evaluation);
  if (!facility) {
    return { first: 0 };
  }
  const first = facility.skillEfficiency - evaluation.baselineEfficiency;
  const denominator =
    evaluation.participants.length - Number(evaluation.hasCoreOperator);
  return {
    first,
    second: denominator > 0 ? first / denominator : undefined,
  };
}

export function operatorFieldValues(
  catalog: EfficiencyCatalog,
  operatorNames: string[],
  path: string,
): number[] {
  return operatorNames.flatMap((name) => {
    const file = catalog.operators[name]?.skillFile;
    return file ? numericValuesAtPath(file, path) : [];
  });
}

function numericValuesAtPath(value: unknown, path: string): number[] {
  const tokens = path.split(".").filter(Boolean);
  if (tokens.length === 0) {
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  }
  const [token, ...rest] = tokens;
  if (!token) {
    return [];
  }
  if (token.endsWith("[]")) {
    const key = token.slice(0, -2);
    const list = key ? (value as Record<string, unknown>)?.[key] : value;
    return Array.isArray(list)
      ? list.flatMap((item) => numericValuesAtPath(item, rest.join(".")))
      : [];
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return numericValuesAtPath(
    (value as Record<string, unknown>)[token],
    rest.join("."),
  );
}

function collectNumericPaths(
  value: unknown,
  path: string,
  paths: Set<string>,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (path) paths.add(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNumericPaths(item, `${path}[]`, paths));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  Object.entries(value).forEach(([key, item]) => {
    collectNumericPaths(item, path ? `${path}.${key}` : key, paths);
  });
}

export function operatorFieldOptions(
  catalog: EfficiencyCatalog,
): Array<{ value: string; label: string }> {
  const paths = new Set<string>();
  Object.values(catalog.operators).forEach((operator) => {
    if (operator.skillFile) collectNumericPaths(operator.skillFile, "", paths);
  });
  return [...paths]
    .sort((first, second) => first.localeCompare(second, "en"))
    .map((path) => ({ value: path, label: path }));
}

export function compareValues(
  first: string | number | undefined,
  second: string | number | undefined,
): number {
  if (typeof first === "number" && typeof second === "number") {
    return first - second;
  }
  return String(first ?? "").localeCompare(String(second ?? ""), "zh-CN");
}
