import type {
  EfficiencyCatalog,
  EfficiencyResult,
  FacilityEfficiencyResult,
} from "@/types/efficiency";
import type {
  OperatorState,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import type { OperatorProgressionProfile } from "@/types/operatorProgression";
import { calculateEfficiency } from "@/utils/efficiency/calculate";

export type BasicCalculatorColumnKind =
  | "operators"
  | "operatorNames"
  | "storageDelta"
  | "orderDelta"
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
  mood?: number;
  elite?: number;
  level?: number;
}

export interface BasicCalculatorExtraRoom {
  type: RoomKey;
  level: number;
  operators?: BasicCalculatorOperator[];
  count?: number;
  product?: string;
  sourceMaterial?: string;
}

export interface BasicCalculatorRow {
  id: string;
  operators: BasicCalculatorOperator[];
  displayOperators?: BasicCalculatorOperator[];
  coreOperator?: BasicCalculatorOperator;
  controlOperators?: BasicCalculatorOperator[];
  product?: string;
  sourceMaterial?: string;
  note?: string;
  extraRooms?: BasicCalculatorExtraRoom[];
}

export interface BasicCalculatorGroup {
  id: string;
  name: string;
  facility: Extract<RoomKey, "trading" | "manufacture">;
  facilityLevel: number;
  coreOperator: BasicCalculatorOperator;
  baselineEfficiency: number;
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
  efficiencyDisplay: "first" | "second" | "both";
  jieCalculation: "max" | "integral";
  sortColumnId: string;
  sortDirection: "asc" | "desc";
  defaultControlOperators: string[];
}

export const DEFAULT_BASIC_CALCULATOR_SETTINGS: BasicCalculatorSettings = {
  avatar: {
    showAvatar: true,
    showProfession: false,
    showEliteLevel: false,
    showRarity: false,
  },
  efficiencyDisplay: "both",
  jieCalculation: "max",
  sortColumnId: "efficiency-24",
  sortDirection: "desc",
  defaultControlOperators: ["Lancet-2", "Castle-3", "12F", "杜林", "夜刀"],
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
  workOperators: BasicCalculatorOperator[];
  participants: BasicCalculatorOperator[];
}

export interface BasicCalculatorCalculationOptions {
  progressionProfile?: OperatorProgressionProfile;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
}

export interface BasicCalculatorRowCalculation {
  efficiency: Record<string, BasicCalculatorEfficiencyValue>;
  storageDelta?: number;
  orderDelta?: number;
}

export interface BasicCalculatorWorkerRequest {
  type: "calculate";
  requestId: number;
  catalog: EfficiencyCatalog;
  groups: BasicCalculatorGroup[];
  columns: BasicCalculatorColumn[];
  settings: BasicCalculatorSettings;
  progressionProfile?: OperatorProgressionProfile;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
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

function normalizeExtraRooms(
  rooms: BasicCalculatorExtraRoom[] | undefined,
): BasicCalculatorExtraRoom[] | undefined {
  if (!rooms?.length) return rooms;
  return rooms.flatMap((room) => {
    const count = Math.max(1, room.count ?? 1);
    return Array.from({ length: count }, () => ({
      ...room,
      ...(room.operators ? { operators: clone(room.operators) } : {}),
      count: undefined,
    }));
  });
}

function normalizeRow(row: BasicCalculatorRow): BasicCalculatorRow {
  const next = clone(row);
  const extraRooms = normalizeExtraRooms(next.extraRooms);
  if (extraRooms) {
    next.extraRooms = extraRooms.map((room) => {
      const normalized = { ...room };
      delete normalized.count;
      return normalized;
    });
  }
  return next;
}

function normalizeConfig(config: BasicCalculatorConfig): BasicCalculatorConfig {
  const next = clone(config);
  next.groups.forEach((group) => {
    group.rows = group.rows.map(normalizeRow);
  });
  return next;
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
  return clone(config);
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
    config.settings = {
      ...config.settings,
      ...clone(patch.settings),
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
  defaults: BasicCalculatorConfig,
  current: BasicCalculatorConfig,
): BasicCalculatorPatch {
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
    if (key === "avatar" || key === "defaultControlOperators") {
      return;
    }
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
  if (
    !sameValue(
      defaults.settings.defaultControlOperators,
      current.settings.defaultControlOperators,
    )
  ) {
    settings.defaultControlOperators = [
      ...current.settings.defaultControlOperators,
    ];
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

function stateForOperator(operator: BasicCalculatorOperator): OperatorState {
  return {
    ...(operator.mood === undefined ? {} : { mood: operator.mood }),
    ...(operator.elite === undefined ? {} : { elite: operator.elite }),
    ...(operator.level === undefined ? {} : { level: operator.level }),
  };
}

function addRoomAssignment(
  rooms: Record<string, unknown[]>,
  type: RoomKey,
  assignment: Record<string, unknown>,
): void {
  const list = (rooms[type] ?? []) as Record<string, unknown>[];
  list.push(assignment);
  rooms[type] = list;
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

export function buildBasicCalculatorSchedule(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
  durationHours: number,
  settings: BasicCalculatorSettings,
  includeCore: boolean = true,
): ScheduleDocument {
  const core = includeCore
    ? (row.coreOperator ?? group.coreOperator)
    : undefined;
  const participants = uniqueOperators([
    ...(core ? [core] : []),
    ...row.operators,
    ...(row.extraRooms ?? []).flatMap((room) => room.operators ?? []),
  ]);
  const controlOperators = uniqueOperators(
    row.controlOperators ?? [
      ...settings.defaultControlOperators.map((name) => ({
        name,
        room: "control" as const,
      })),
      ...row.operators.filter((operator) => operator.room === "control"),
    ],
  );
  const workOperators = participants.filter(
    (operator) => !operator.room || operator.room === group.facility,
  );
  const extraRooms = row.extraRooms ?? [];
  const layout = [
    { type: "control" as const, level: 5 },
    { type: group.facility, level: group.facilityLevel },
    ...extraRooms.map((room) => ({ type: room.type, level: room.level })),
  ];
  const rooms: Record<string, unknown[]> = {};
  const controlStates = Object.fromEntries(
    controlOperators.map((operator) => [
      operator.name,
      stateForOperator(operator),
    ]),
  );
  addRoomAssignment(rooms, "control", {
    operators: controlOperators.map(({ name }) => name),
    operatorStates: controlStates,
  });
  addRoomAssignment(rooms, group.facility, {
    operators: workOperators.map(({ name }) => name),
    product: row.product,
    sourceMaterial: row.sourceMaterial,
    operatorStates: Object.fromEntries(
      workOperators.map((operator) => [
        operator.name,
        stateForOperator(operator),
      ]),
    ),
  });
  extraRooms.forEach((room) => {
    const operators =
      room.operators ??
      participants.filter((operator) => operator.room === room.type);
    addRoomAssignment(rooms, room.type, {
      operators: operators.map(({ name }) => name),
      product: room.product,
      sourceMaterial: room.sourceMaterial,
      operatorStates: Object.fromEntries(
        operators.map((operator) => [
          operator.name,
          stateForOperator(operator),
        ]),
      ),
    });
  });
  return {
    title: `${group.name} · ${row.id}`,
    layout,
    plans: [
      {
        name: row.id,
        duration: Math.round(durationHours * 60),
        rooms,
      },
    ],
    settings: {
      clueExchanging: true,
      dormFullTreat: true,
      preferMaxJieEfficiency: settings.jieCalculation === "max",
      firstItemProgress: 0,
    },
  };
}

export function evaluateBasicCalculatorRow(
  catalog: EfficiencyCatalog,
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
  durationHours: number,
  settings: BasicCalculatorSettings,
  options: BasicCalculatorCalculationOptions = {},
): BasicCalculatorEvaluation {
  const document = buildBasicCalculatorSchedule(
    group,
    row,
    durationHours,
    settings,
  );
  const result = calculateEfficiencyForBasicCalculator(
    document,
    catalog,
    options,
  );
  const core = row.coreOperator ?? group.coreOperator;
  const visibleRow: BasicCalculatorRow = {
    ...row,
    operators: row.operators.filter((operator) => operator.name !== core.name),
  };
  const visibleDocument = buildBasicCalculatorSchedule(
    group,
    visibleRow,
    durationHours,
    settings,
    false,
  );
  const visibleResult = calculateEfficiencyForBasicCalculator(
    visibleDocument,
    catalog,
    options,
  );
  const facilityIndex =
    result.plans[0]?.facilities.findIndex(
      (facility) => facility.facility.type === group.facility,
    ) ?? -1;
  const participants = uniqueOperators([core, ...row.operators]).filter(
    (operator) => !operator.room || operator.room === group.facility,
  );
  const visibleFacilityIndex =
    visibleResult.plans[0]?.facilities.findIndex(
      (facility) => facility.facility.type === group.facility,
    ) ?? -1;
  return {
    result,
    facilityIndex,
    visibleResult,
    visibleFacilityIndex,
    workOperators: participants,
    participants,
  };
}

export function calculateBasicCalculatorRowValues(
  catalog: EfficiencyCatalog,
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
  columns: BasicCalculatorColumn[],
  settings: BasicCalculatorSettings,
  options: BasicCalculatorCalculationOptions = {},
): BasicCalculatorRowCalculation {
  const hours = new Set(
    columns
      .filter((column) => column.kind === "efficiency")
      .map((column) => column.hours ?? 24),
  );
  hours.add(24);
  const efficiency: Record<string, BasicCalculatorEfficiencyValue> = {};
  let evaluation24: BasicCalculatorEvaluation | undefined;
  [...hours].forEach((duration) => {
    const evaluation = evaluateBasicCalculatorRow(
      catalog,
      group,
      row,
      duration,
      settings,
      options,
    );
    if (duration === 24) evaluation24 = evaluation;
    efficiency[String(duration)] = basicCalculatorEfficiencyValue(
      evaluation,
      group,
    );
  });
  const facility = evaluation24
    ? visibleFacilityResultOf(evaluation24)
    : undefined;
  return {
    efficiency,
    storageDelta: facility?.attributes.storageCap?.skill ?? 0,
    orderDelta: facility?.attributes.orderLimit?.skill ?? 0,
  };
}

function calculateEfficiencyForBasicCalculator(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
  options: BasicCalculatorCalculationOptions,
): EfficiencyResult {
  return calculateEfficiency(document, catalog, {
    dormitoryDefaultIncludesMoodRecovery:
      options.dormitoryDefaultIncludesMoodRecovery,
    progressionProfile: options.progressionProfile,
    treatSkillsAsUnlocked: false,
  });
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
  group: BasicCalculatorGroup,
): BasicCalculatorEfficiencyValue {
  const facility = facilityResultOf(evaluation);
  if (!facility) {
    return { first: 0 };
  }
  const first = facility.skillEfficiency - group.baselineEfficiency;
  const denominator = evaluation.participants.length - 1;
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

export function columnHours(column: BasicCalculatorColumn): number | undefined {
  return column.kind === "efficiency" ? column.hours : undefined;
}

export function sortBasicCalculatorColumns(
  columns: BasicCalculatorColumn[],
): BasicCalculatorColumn[] {
  const timeColumns = columns
    .filter((column) => columnHours(column) !== undefined)
    .sort(
      (first, second) => (columnHours(first) ?? 0) - (columnHours(second) ?? 0),
    );
  if (timeColumns.length === 0) return columns;
  const firstTimeIndex = columns.findIndex(
    (column) => columnHours(column) !== undefined,
  );
  const before = columns
    .slice(0, firstTimeIndex)
    .filter((column) => columnHours(column) === undefined);
  const after = columns
    .slice(firstTimeIndex)
    .filter((column) => columnHours(column) === undefined);
  return [...before, ...timeColumns, ...after];
}
