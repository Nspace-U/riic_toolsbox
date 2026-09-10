import {
  ROOM_KEYS,
  type LayoutEntry,
  type Plan,
  type RoomAssignment,
  type RoomKey,
  type ScheduleSettings,
  type ScheduleDocument,
} from "@/types/schedule";

export const ROOM_LABELS: Record<RoomKey, string> = {
  control: "控制中枢",
  trading: "贸易站",
  manufacture: "制造站",
  power: "发电站",
  meeting: "会客室",
  hire: "办公室",
  processing: "加工站",
  training: "训练室",
  dormitory: "宿舍",
};

export const ROOM_REPRESENTATIVE_COLORS: Record<RoomKey, string> = {
  control: "#216A66",
  trading: "#2486B3",
  manufacture: "#E2C60C",
  power: "#9DCB3B",
  meeting: "#E27B5A",
  hire: "#C2C2C2",
  processing: "#D0D60D",
  training: "#8A1F39",
  dormitory: "#37CBBF",
};

export const PRODUCT_REPRESENTATIVE_COLORS: Record<string, string> = {
  "Pure Gold": "#B87321",
  Orundum: "#B52D2D",
  "Originium Shard": "#B52D2D",
};

export const ROOM_ORDER: RoomKey[] = [...ROOM_KEYS];

export const LAYOUT_TEXT_ROWS: ReadonlyArray<ReadonlyArray<RoomKey>> = [
  ["control"],
  ["trading"],
  ["manufacture"],
  ["power"],
  ["meeting", "hire", "processing", "training"],
  ["dormitory"],
];

export function orderedLayoutEntries<T extends LayoutEntry>(
  layout: T[],
): Array<{ entry: T; index: number }> {
  return layout
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const orderDifference =
        ROOM_ORDER.indexOf(left.entry.type) -
        ROOM_ORDER.indexOf(right.entry.type);
      return orderDifference || left.index - right.index;
    });
}

export const ROOM_LEVEL_LIMITS: Record<RoomKey, { min: number; max: number }> =
  {
    control: { min: 5, max: 5 },
    trading: { min: 1, max: 3 },
    manufacture: { min: 1, max: 3 },
    power: { min: 3, max: 3 },
    meeting: { min: 1, max: 3 },
    hire: { min: 1, max: 3 },
    dormitory: { min: 1, max: 5 },
    processing: { min: 1, max: 3 },
    training: { min: 1, max: 3 },
  };

export const ROOM_LIMITS: Record<RoomKey, number> = {
  control: 1,
  trading: 5,
  manufacture: 5,
  power: 3,
  meeting: 1,
  hire: 1,
  dormitory: 4,
  processing: 1,
  training: 1,
};

export const BUILD_CHAIN_REQUIRED: Partial<Record<RoomKey, RoomKey>> = {
  processing: "meeting",
  hire: "processing",
  training: "hire",
};

export const CORE_ROOM_KEYS: RoomKey[] = ["trading", "manufacture", "power"];

export const ROOM_POWER_VALUES: Record<RoomKey, number[]> = {
  control: [0, 0, 0, 0, 0],
  trading: [-10, -30, -60],
  manufacture: [-10, -30, -60],
  power: [60, 130, 270],
  meeting: [-10, -30, -60],
  hire: [-10, -30, -60],
  dormitory: [-10, -20, -30, -45, -65],
  processing: [-10, -10, -10],
  training: [-10, -30, -60],
};

export const PRODUCT_LABELS: Record<string, string> = {
  LMD: "龙门币",
  Orundum: "合成玉",
  "Pure Gold": "赤金",
  "Battle Record": "作战记录",
  "Originium Shard": "源石碎片",
};

export const UNSUPPORTED_PRODUCT_LABELS: Record<string, string> = {
  Dualchip: "双芯片（仅保留，不参与本工具制造计算）",
};

export const DEFAULT_SOURCE_MATERIAL = "固源岩";

export const PRODUCT_OPTIONS = Object.entries(PRODUCT_LABELS).map(
  ([value, label]) => ({
    value,
    label,
  }),
);

export const SOURCE_MATERIAL_OPTIONS = [
  { value: "固源岩", label: "固源岩" },
  { value: "装置", label: "装置" },
];

const ROOM_KEY_SET = new Set<string>(ROOM_KEYS);

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(path: string, message: string): never {
  throw new ScheduleError(`${path}：${message}`);
}

function isRoomKey(value: unknown): value is RoomKey {
  return typeof value === "string" && ROOM_KEY_SET.has(value);
}

export function roomLevelRange(type: RoomKey): { min: number; max: number } {
  return ROOM_LEVEL_LIMITS[type];
}

export function parseLayoutText(text: string): LayoutEntry[] {
  const normalizedText = text.replace(/\r\n?/g, "\n").trimEnd();
  if (!normalizedText.trim()) {
    throw new ScheduleError("布局输入不能为空");
  }

  const rawLines = normalizedText.split("\n");
  if (rawLines.length > LAYOUT_TEXT_ROWS.length) {
    throw new ScheduleError("布局输入最多需要 6 行");
  }

  const lines = [
    ...rawLines,
    ...Array.from(
      { length: LAYOUT_TEXT_ROWS.length - rawLines.length },
      () => "",
    ),
  ];
  const layout: LayoutEntry[] = [];

  lines.forEach((rawLine, rowIndex) => {
    const line = rawLine.replace(/\s/g, "");
    const rowTypes = LAYOUT_TEXT_ROWS[rowIndex] ?? [];
    if (!line) {
      return;
    }

    if (rowIndex === 4) {
      if (line.length > rowTypes.length) {
        throw new ScheduleError(
          `第 ${rowIndex + 1} 行最多填写 ${rowTypes.length} 个数字`,
        );
      }
      [...line].forEach((character, typeIndex) => {
        if (character === "0") {
          return;
        }
        const type = rowTypes[typeIndex];
        if (!type || !/^\d$/.test(character)) {
          throw new ScheduleError(
            `第 ${rowIndex + 1} 行第 ${typeIndex + 1} 个位置必须是 0 到 3 的数字`,
          );
        }
        const level = Number(character);
        const range = roomLevelRange(type);
        if (level < range.min || level > range.max) {
          throw new ScheduleError(
            `${ROOM_LABELS[type]}等级必须在 ${range.min} 到 ${range.max} 之间`,
          );
        }
        layout.push({ type, level });
      });
      return;
    }

    if (rowIndex === 0 && line.length !== 1) {
      throw new ScheduleError("第 1 行只能填写 1 个控制中枢等级");
    }
    const type = rowTypes[0];
    if (!type) {
      return;
    }
    if (line.length > ROOM_LIMITS[type]) {
      throw new ScheduleError(
        `第 ${rowIndex + 1} 行最多填写 ${ROOM_LIMITS[type]} 个数字`,
      );
    }

    [...line].forEach((character) => {
      if (!/^\d$/.test(character) || character === "0") {
        throw new ScheduleError(
          `第 ${rowIndex + 1} 行必须填写 ${roomLevelRange(type).min} 到 ${roomLevelRange(type).max} 的设施等级数字`,
        );
      }
      const level = Number(character);
      const range = roomLevelRange(type);
      if (level < range.min || level > range.max) {
        throw new ScheduleError(
          `${ROOM_LABELS[type]}等级必须在 ${range.min} 到 ${range.max} 之间`,
        );
      }
      layout.push({ type, level });
    });
  });

  if (!layout.some((entry) => entry.type === "control")) {
    throw new ScheduleError("第 1 行必须填写控制中枢等级");
  }
  return layout;
}

export function roomSlotCount(type: RoomKey, level: number): number {
  if (type === "control" || type === "trading" || type === "manufacture") {
    return level;
  }
  if (type === "power" || type === "hire" || type === "processing") {
    return 1;
  }
  if (type === "meeting" || type === "training") {
    return 2;
  }
  return 5;
}

export function validateLayout(layout: unknown): LayoutEntry[] {
  if (!Array.isArray(layout)) {
    fail("layout", "必须是数组");
  }
  if (layout.length === 0) {
    fail("layout", "至少需要一个设施");
  }

  return layout.map((entry, index) => {
    if (!isRecord(entry)) {
      fail(`layout[${index}]`, "必须是对象");
    }
    if (!isRoomKey(entry.type)) {
      fail(`layout[${index}].type`, "不是支持的设施类型");
    }
    if (typeof entry.level !== "number" || !Number.isInteger(entry.level)) {
      fail(`layout[${index}].level`, "必须是整数");
    }
    const range = roomLevelRange(entry.type);
    if (entry.level < range.min || entry.level > range.max) {
      fail(
        `layout[${index}].level`,
        `必须在 ${range.min} 到 ${range.max} 之间`,
      );
    }
    return entry as LayoutEntry;
  });
}

function validateOperators(room: RoomAssignment, path: string): string[] {
  if (!hasOwn(room, "operators")) {
    return [];
  }
  if (!Array.isArray(room.operators)) {
    fail(`${path}.operators`, "必须是干员名称字符串数组");
  }

  const names = room.operators.map((operator, index) => {
    if (typeof operator !== "string" || !operator.trim()) {
      fail(`${path}.operators[${index}]`, "必须是非空字符串");
    }
    return operator;
  });
  if (new Set(names).size !== names.length) {
    fail(`${path}.operators`, "同一房间中不能重复出现同名干员");
  }
  return names;
}

function validateRoomCapacity(
  room: RoomAssignment,
  type: RoomKey,
  level: number,
  path: string,
): void {
  const names = room.operators ?? [];
  const capacity = roomSlotCount(type, level);
  if (names.length > capacity) {
    fail(`${path}.operators`, `超过该设施 ${capacity} 个槽位上限`);
  }
}

function validateOperatorStates(
  room: RoomAssignment,
  names: string[],
  path: string,
): void {
  if (!hasOwn(room, "operatorStates")) {
    return;
  }
  if (!isRecord(room.operatorStates)) {
    fail(`${path}.operatorStates`, "必须是对象");
  }

  Object.entries(room.operatorStates).forEach(([name, state]) => {
    if (!names.includes(name)) {
      fail(
        `${path}.operatorStates.${name}`,
        "该干员不在同一房间的 operators 中",
      );
    }
    if (!isRecord(state)) {
      fail(`${path}.operatorStates.${name}`, "必须是对象");
    }
    if (hasOwn(state, "mood")) {
      if (
        typeof state.mood !== "number" ||
        !Number.isFinite(state.mood) ||
        state.mood < 0 ||
        state.mood > 24
      ) {
        fail(
          `${path}.operatorStates.${name}.mood`,
          "必须是 0 到 24 之间的数字",
        );
      }
    }
    if (hasOwn(state, "elite")) {
      if (
        typeof state.elite !== "number" ||
        !Number.isInteger(state.elite) ||
        state.elite < 0 ||
        state.elite > 2
      ) {
        fail(
          `${path}.operatorStates.${name}.elite`,
          "必须是 0 到 2 之间的整数",
        );
      }
    }
    if (hasOwn(state, "level")) {
      if (
        typeof state.level !== "number" ||
        !Number.isInteger(state.level) ||
        state.level < 1 ||
        state.level > 90
      ) {
        fail(
          `${path}.operatorStates.${name}.level`,
          "必须是 1 到 90 之间的整数",
        );
      }
    }
  });
}

function validateNumberMap(value: unknown, path: string): void {
  if (!isRecord(value)) {
    fail(path, "必须是对象");
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (
      !key.trim() ||
      typeof entry !== "number" ||
      !Number.isFinite(entry) ||
      entry < 0
    ) {
      fail(`${path}.${key}`, "必须是非负有限数字");
    }
  });
}

function validateSettings(settings: unknown): ScheduleSettings {
  if (!isRecord(settings)) {
    fail("settings", "必须是对象");
  }
  if (
    hasOwn(settings, "clueExchanging") &&
    typeof settings.clueExchanging !== "boolean"
  ) {
    fail("settings.clueExchanging", "必须是布尔值");
  }
  if (
    hasOwn(settings, "dormFullTreat") &&
    typeof settings.dormFullTreat !== "boolean"
  ) {
    fail("settings.dormFullTreat", "必须是布尔值");
  }
  if (
    hasOwn(settings, "preferMaxJieEfficiency") &&
    typeof settings.preferMaxJieEfficiency !== "boolean"
  ) {
    fail("settings.preferMaxJieEfficiency", "必须是布尔值");
  }
  if (
    hasOwn(settings, "overflowMode") &&
    settings.overflowMode !== "continue" &&
    settings.overflowMode !== "zero"
  ) {
    fail("settings.overflowMode", "必须是 continue 或 zero");
  }
  if (hasOwn(settings, "featherFixedOps")) {
    if (
      !Array.isArray(settings.featherFixedOps) ||
      settings.featherFixedOps.some(
        (name) => typeof name !== "string" || !name.trim(),
      )
    ) {
      fail("settings.featherFixedOps", "必须是干员名称字符串数组");
    }
  }
  if (hasOwn(settings, "orderProgress")) {
    validateNumberMap(settings.orderProgress, "settings.orderProgress");
    Object.entries(settings.orderProgress as Record<string, number>).forEach(
      ([key, value]) => {
        if (value > 100) {
          fail(`settings.orderProgress.${key}`, "必须在 0 到 100 之间");
        }
      },
    );
  }
  if (hasOwn(settings, "firstItemProgress")) {
    validateNumberMap(settings.firstItemProgress, "settings.firstItemProgress");
    Object.entries(
      settings.firstItemProgress as Record<string, number>,
    ).forEach(([key, value]) => {
      if (value > 1) {
        fail(`settings.firstItemProgress.${key}`, "必须在 0 到 1 之间");
      }
    });
  }
  return settings as ScheduleSettings;
}

function validateRoom(
  room: unknown,
  type: RoomKey,
  index: number,
  planIndex: number,
): RoomAssignment {
  const path = `plans[${planIndex}].rooms.${type}[${index}]`;
  if (!isRecord(room)) {
    fail(path, "必须是对象");
  }
  if (hasOwn(room, "skip") && typeof room.skip !== "boolean") {
    fail(`${path}.skip`, "必须是布尔值");
  }
  if (
    hasOwn(room, "product") &&
    (typeof room.product !== "string" || !room.product.trim())
  ) {
    fail(`${path}.product`, "必须是非空字符串");
  }
  if (
    hasOwn(room, "sourceMaterial") &&
    typeof room.sourceMaterial !== "string"
  ) {
    fail(`${path}.sourceMaterial`, "必须是字符串");
  }
  const names = validateOperators(room as RoomAssignment, path);
  validateOperatorStates(room as RoomAssignment, names, path);
  return room as RoomAssignment;
}

function validatePlan(
  plan: unknown,
  index: number,
  layout: LayoutEntry[] | undefined,
): Plan {
  const path = `plans[${index}]`;
  if (!isRecord(plan)) {
    fail(path, "必须是对象");
  }
  if (!isRecord(plan.rooms)) {
    fail(`${path}.rooms`, "必须是对象");
  }

  const rooms = plan.rooms;
  const operatorsInPlan = new Map<string, string>();
  ROOM_KEYS.forEach((type) => {
    const rawRooms = rooms[type];
    if (rawRooms !== undefined && !Array.isArray(rawRooms)) {
      fail(`${path}.rooms.${type}`, "必须是数组");
    }
    const roomList = Array.isArray(rawRooms) ? rawRooms : [];
    roomList.forEach((room, roomIndex) => {
      const validatedRoom = validateRoom(room, type, roomIndex, index);
      const roomPath = `${path}.rooms.${type}[${roomIndex}]`;
      if (layout) {
        const layoutEntry = layout.filter((entry) => entry.type === type)[
          roomIndex
        ];
        if (layoutEntry) {
          validateRoomCapacity(
            validatedRoom,
            type,
            layoutEntry.level,
            roomPath,
          );
        }
      }
      (validatedRoom.operators ?? []).forEach((operator) => {
        const previousRoom = operatorsInPlan.get(operator);
        if (previousRoom) {
          fail(
            `${path}.rooms.${type}[${roomIndex}].operators`,
            `干员“${operator}”已在 ${previousRoom} 中配置，同一队列不能重复`,
          );
        }
        operatorsInPlan.set(operator, roomPath);
      });
    });
  });
  return plan as Plan;
}

export function validatePlans(plans: unknown, layout?: LayoutEntry[]): Plan[] {
  if (!Array.isArray(plans) || plans.length === 0) {
    fail("plans", "必须是非空数组");
  }
  return plans.map((plan, index) => validatePlan(plan, index, layout));
}

export function canAddLayoutEntry(
  layout: LayoutEntry[],
  type: RoomKey,
): { ok: true } | { ok: false; reason: string } {
  const count = layout.filter((entry) => entry.type === type).length;
  const limit = ROOM_LIMITS[type];
  if (count >= limit) {
    return { ok: false, reason: `${ROOM_LABELS[type]}最多 ${limit} 个` };
  }

  const requiredType = BUILD_CHAIN_REQUIRED[type];
  if (requiredType && !layout.some((entry) => entry.type === requiredType)) {
    return { ok: false, reason: `需先建造 ${ROOM_LABELS[requiredType]}` };
  }

  if (CORE_ROOM_KEYS.includes(type)) {
    const coreCount = CORE_ROOM_KEYS.reduce(
      (total, roomType) =>
        total + layout.filter((entry) => entry.type === roomType).length,
      0,
    );
    if (coreCount >= 9) {
      return { ok: false, reason: "贸易站 + 制造站 + 发电站合计最多 9 个" };
    }
  }

  return { ok: true };
}

export function facilityPower(type: RoomKey, level: number): number {
  const value = ROOM_POWER_VALUES[type][level - 1];
  return value ?? 0;
}

export function validateSchedule(document: ScheduleDocument): void {
  if (!isRecord(document)) {
    throw new ScheduleError("文档根节点必须是对象");
  }
  validateLayout(document.layout);
  if (Object.prototype.hasOwnProperty.call(document, "settings")) {
    validateSettings(document.settings);
  }
  if (!Array.isArray(document.plans) || document.plans.length === 0) {
    throw new ScheduleError("缺少非空 plans 数组");
  }
  validatePlans(document.plans, document.layout);
}

export function cloneSchedule(document: ScheduleDocument): ScheduleDocument {
  return JSON.parse(JSON.stringify(document)) as ScheduleDocument;
}

export function createEmptySchedule(): ScheduleDocument {
  return {
    title: "新建排班表",
    description: "",
    settings: {
      clueExchanging: false,
      dormFullTreat: true,
      featherFixedOps: [],
      preferMaxJieEfficiency: true,
      overflowMode: "continue",
    },
    layout: [{ type: "control", level: 5 }],
    plans: [
      {
        name: "队列1",
        duration: 720,
        rooms: {
          control: [{ skip: true }],
        },
      },
    ],
  };
}

export function roomCount(document: ScheduleDocument, type: RoomKey): number {
  return document.layout.filter((entry) => entry.type === type).length;
}
