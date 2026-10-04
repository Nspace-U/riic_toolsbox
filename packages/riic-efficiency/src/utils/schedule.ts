import {
  ROOM_KEYS,
  type LayoutEntry,
  type OperatorState,
  type Plan,
  type RoomAssignment,
  type RoomKey,
  type ResolvedRoomAssignment,
  type ScheduleSettings,
  type ScheduleDocument,
} from "../types/schedule";
import type { BaseSkillTerms } from "../types/baseData";
import type { EfficiencyCatalog } from "../types/efficiency";
import { isKnownSpecialOperator } from "./specialOperators";

export interface SchedulePeriodAnalysis {
  enabled: boolean;
  durations: Array<number | undefined>;
  errors: string[];
  warnings: string[];
}

export class SchedulePeriodError extends Error {
  constructor(messages: readonly string[]) {
    super(messages.join("；"));
    this.name = "SchedulePeriodError";
  }
}

interface PeriodInterval {
  end: number;
  planIndex: number;
  start: number;
}

export function schedulePeriodMinute(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return undefined;
  }
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : undefined;
}

export function schedulePeriodForRange(
  start: string,
  end: string,
): string[][] | undefined {
  const startMinute = schedulePeriodMinute(start);
  const endMinute = schedulePeriodMinute(end);
  if (startMinute === undefined || endMinute === undefined) {
    return undefined;
  }
  if (startMinute <= endMinute) {
    return [[start, end]];
  }
  return [
    [start, "23:59"],
    ["00:00", end],
  ];
}

function formatSchedulePeriodMinute(value: number): string {
  const normalized = Math.max(0, Math.min(1439, value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function periodIntervals(
  period: unknown,
  planIndex: number,
): { intervals: PeriodInterval[]; start?: number; error?: string } {
  if (!Array.isArray(period) || period.length === 0 || period.length > 2) {
    return {
      intervals: [],
      error: `队列 ${planIndex + 1} 的 period 必须包含一个时间段，或包含规范的跨午夜两个时间段`,
    };
  }
  const intervals: PeriodInterval[] = [];
  let start: number | undefined;
  for (const [intervalIndex, rawInterval] of period.entries()) {
    if (!Array.isArray(rawInterval) || rawInterval.length !== 2) {
      return {
        intervals: [],
        error: `队列 ${planIndex + 1} 的 period[${intervalIndex}] 必须是开始和结束时间`,
      };
    }
    const intervalStart = schedulePeriodMinute(rawInterval[0]);
    const intervalEnd = schedulePeriodMinute(rawInterval[1]);
    if (intervalStart === undefined || intervalEnd === undefined) {
      return {
        intervals: [],
        error: `队列 ${planIndex + 1} 的 period 时间必须是 HH:mm 格式且在 00:00 到 23:59 之间`,
      };
    }
    start ??= intervalStart;
    const addInterval = (
      intervalStartValue: number,
      intervalEndValue: number,
    ) =>
      intervals.push({
        end: intervalEndValue + 1,
        planIndex,
        start: intervalStartValue,
      });
    if (intervalStart === intervalEnd) {
      addInterval(intervalStart, intervalEnd);
    } else if (intervalStart < intervalEnd) {
      addInterval(intervalStart, intervalEnd);
    } else {
      addInterval(intervalStart, 1439);
      addInterval(0, intervalEnd);
    }
  }
  if (period.length === 2) {
    const first = period[0];
    const second = period[1];
    const firstStart = schedulePeriodMinute(first?.[0]);
    const firstEnd = schedulePeriodMinute(first?.[1]);
    const secondStart = schedulePeriodMinute(second?.[0]);
    const secondEnd = schedulePeriodMinute(second?.[1]);
    if (
      firstStart === undefined ||
      firstEnd !== 1439 ||
      secondStart !== 0 ||
      secondEnd === undefined ||
      firstStart <= secondEnd
    ) {
      return {
        intervals: [],
        error: `队列 ${planIndex + 1} 的多个 period 只能表示一个规范的跨午夜时间段`,
      };
    }
  }
  return { intervals, start };
}

export function analyzeSchedulePeriods(
  document: ScheduleDocument,
): SchedulePeriodAnalysis {
  const enabled = document.plans.some((plan) => plan.period !== undefined);
  if (!enabled) {
    return {
      durations: document.plans.map(() => undefined),
      enabled: false,
      errors: [],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const durations = document.plans.map(() => undefined as number | undefined);
  const intervals: PeriodInterval[] = [];
  const starts: number[] = [];

  document.plans.forEach((plan, planIndex) => {
    if (plan.period === undefined) {
      errors.push(`队列 ${planIndex + 1} 缺少 period 时间设置`);
      return;
    }
    const parsed = periodIntervals(plan.period, planIndex);
    if (parsed.error || parsed.start === undefined) {
      errors.push(parsed.error ?? `队列 ${planIndex + 1} 的 period 无效`);
      return;
    }
    if (
      document.plans.length === 1 &&
      parsed.intervals.length === 1 &&
      parsed.intervals[0]?.start === 0 &&
      parsed.intervals[0]?.end === 1440
    ) {
      errors.push("单队列不能使用 00:00 到 23:59 表示全天");
    }
    starts.push(parsed.start);
    intervals.push(...parsed.intervals);
  });

  const orderedIntervals = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let coveredUntil = 0;
  orderedIntervals.forEach((interval, index) => {
    if (interval.start < coveredUntil) {
      errors.push(
        `队列 ${interval.planIndex + 1} 的 period 与其他队列时间重叠`,
      );
      coveredUntil = Math.max(coveredUntil, interval.end);
      return;
    }
    if (index > 0 && interval.start > coveredUntil) {
      warnings.push(
        `定时换班存在 ${formatSchedulePeriodMinute(coveredUntil)} 到 ${formatSchedulePeriodMinute(interval.start - 1)} 的时间空档`,
      );
    }
    coveredUntil = interval.end;
  });
  const firstInterval = orderedIntervals[0];
  if (firstInterval && firstInterval.start > 0) {
    warnings.unshift(
      `定时换班存在 00:00 到 ${formatSchedulePeriodMinute(firstInterval.start - 1)} 的时间空档`,
    );
  }
  if (coveredUntil < 1440) {
    warnings.push(
      `定时换班存在 ${formatSchedulePeriodMinute(coveredUntil)} 到 23:59 的时间空档`,
    );
  }

  if (errors.length === 0 && starts.length === document.plans.length) {
    durations.forEach((_, index) => {
      const start = starts[index];
      const nextStart = starts[(index + 1) % starts.length];
      if (start === undefined || nextStart === undefined) {
        return;
      }
      durations[index] =
        starts.length === 1
          ? start === schedulePeriodMinute(document.plans[0]?.period?.[0]?.[1])
            ? 1
            : 1440
          : (nextStart - start + 1440) % 1440;
    });
  }
  return { durations, enabled: true, errors, warnings };
}

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
  赤金: "#B87321",
  合成玉: "#B52D2D",
  源石碎片: "#B52D2D",
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

export const LAYOUT_INPUT_ROWS: ReadonlyArray<ReadonlyArray<RoomKey>> = [
  ["trading", "manufacture"],
  ["meeting", "processing", "hire", "training", "dormitory"],
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
  龙门币: "龙门币",
  合成玉: "合成玉",
  赤金: "赤金",
  中级作战记录: "作战记录",
  源石碎片: "源石碎片",
};

export const RESOURCE_KEY_ALIASES: Readonly<Record<string, string>> = {
  LMD: "龙门币",
  Orundum: "合成玉",
  "Pure Gold": "赤金",
  "Battle Record": "中级作战记录",
  "Originium Shard": "源石碎片",
  作战记录: "中级作战记录",
  贵金属: "赤金",
};

export function canonicalResourceKey(resource: string): string {
  const normalized = resource.trim();
  return RESOURCE_KEY_ALIASES[normalized] ?? normalized;
}

export const DEFAULT_SOURCE_MATERIAL = "固源岩";

export const DEFAULT_ROOM_PRODUCTS: Partial<Record<RoomKey, string>> = {
  trading: "龙门币",
  manufacture: "赤金",
};

export function createDefaultRoomAssignment(type: RoomKey): RoomAssignment {
  const product = DEFAULT_ROOM_PRODUCTS[type];
  return product ? { product } : {};
}

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

export const PRODUCT_ITEM_ICONS: Record<string, string> = {
  龙门币: "GOLD.png",
  合成玉: "DIAMOND_SHD.png",
  赤金: "MTL_GOLD3.png",
  中级作战记录: "sprite_exp_card_t3.png",
  源石碎片: "MTL_DIAMOND_SHD.png",
};

export const RESOURCE_ITEM_ICONS: Record<string, string> = {
  ...PRODUCT_ITEM_ICONS,
  无人机: "AP_BASE.png",
  信用: "SOCIAL_PT.png",
  公开招募标签刷新次数: "TKT_RECRUIT.png",
  固源岩: "MTL_SL_G2.png",
  装置: "MTL_SL_BOSS2.png",
};

export const ROOM_ITEM_ICONS: Partial<Record<RoomKey, string>> = {
  power: "AP_BASE.png",
  meeting: "SOCIAL_PT.png",
  hire: "TKT_RECRUIT.png",
};

export function facilityProductIconFile(
  type: RoomKey,
  product: string | undefined,
): string | undefined {
  if (type === "trading" || type === "manufacture") {
    return product ? PRODUCT_ITEM_ICONS[product] : undefined;
  }
  return ROOM_ITEM_ICONS[type];
}

export function resourceItemIconFile(product: string): string | undefined {
  return RESOURCE_ITEM_ICONS[product];
}

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

export interface ScheduleTag {
  label: string;
  automatic: boolean;
}

const FULL_RIGHT_ROOM_KEYS: RoomKey[] = [
  "meeting",
  "processing",
  "hire",
  "training",
];

function uniqueScheduleTags(tags: readonly string[]): string[] {
  return Array.from(
    new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)),
  );
}

export function automaticScheduleTags(document: ScheduleDocument): string[] {
  const layoutTag = ["trading", "manufacture", "power"]
    .map(
      (type) => document.layout.filter((entry) => entry.type === type).length,
    )
    .join("");
  const isRightFull = FULL_RIGHT_ROOM_KEYS.every((type) =>
    document.layout.some(
      (entry) =>
        entry.type === type && entry.level === ROOM_LEVEL_LIMITS[type].max,
    ),
  );
  return [
    layoutTag,
    ...(isRightFull ? ["右满"] : ["右不满"]),
    `${document.plans.length}队列`,
  ];
}

export function scheduleTags(
  document: ScheduleDocument,
  customTags: readonly string[] = [],
  hiddenAutoTags: readonly string[] = [],
): ScheduleTag[] {
  const automaticTags = uniqueScheduleTags(automaticScheduleTags(document));
  const hiddenTags = new Set(uniqueScheduleTags(hiddenAutoTags));
  const visibleAutomaticTags = automaticTags.filter(
    (tag) => !hiddenTags.has(tag),
  );
  const automaticTagSet = new Set(automaticTags);
  const visibleCustomTags = uniqueScheduleTags(customTags).filter(
    (tag) => !automaticTagSet.has(tag),
  );
  return [
    ...visibleAutomaticTags.map((label) => ({ label, automatic: true })),
    ...visibleCustomTags.map((label) => ({ label, automatic: false })),
  ];
}

export function isFixedLevelRoom(type: RoomKey): boolean {
  const range: { min: number; max: number } | undefined =
    ROOM_LEVEL_LIMITS[type];
  return range ? range.min === range.max : false;
}

export interface NormalizedLayoutLevels {
  changed: boolean;
  layout: LayoutEntry[];
}

export function normalizeLayoutLevels(
  layout: LayoutEntry[],
): NormalizedLayoutLevels {
  let changed = false;
  const normalizedLayout = layout.map((entry) => {
    if (!isFixedLevelRoom(entry.type)) {
      return entry;
    }
    const fixedLevel = ROOM_LEVEL_LIMITS[entry.type].max;
    if (entry.level === fixedLevel) {
      return entry;
    }
    changed = true;
    return { ...entry, level: fixedLevel };
  });
  return { changed, layout: normalizedLayout };
}

export function parseLayoutText(text: string): LayoutEntry[] {
  const normalizedText = text.replace(/\r\n?/g, "\n").trim();
  if (!normalizedText) {
    throw new ScheduleError("布局输入不能为空");
  }

  const rawLines = normalizedText.split("\n");
  if (rawLines.length !== LAYOUT_INPUT_ROWS.length) {
    throw new ScheduleError("布局输入必须为 2 行");
  }

  const rowTokens = rawLines.map((rawLine) => rawLine.trim().split(/\s+/));
  if (rowTokens.some((tokens) => tokens.length !== 2)) {
    throw new ScheduleError("每行必须由两个数字段组成，并使用空格分隔");
  }

  const layout: LayoutEntry[] = [{ type: "control", level: 5 }];
  const coreTypes = LAYOUT_INPUT_ROWS[0] ?? [];
  coreTypes.forEach((type, typeIndex) => {
    const token = rowTokens[0]?.[typeIndex] ?? "";
    if (token === "0") {
      return;
    }
    if (!/^\d+$/.test(token) || token.includes("0")) {
      throw new ScheduleError(
        `${ROOM_LABELS[type]}只能使用 0 表示不建造，或填写连续的设施等级数字`,
      );
    }
    if (token.length > ROOM_LIMITS[type]) {
      throw new ScheduleError(
        `${ROOM_LABELS[type]}最多填写 ${ROOM_LIMITS[type]} 个设施等级数字`,
      );
    }
    [...token].forEach((character) => {
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

  const powerCount =
    9 -
    layout.filter((entry) => entry.type === "trading").length -
    layout.filter((entry) => entry.type === "manufacture").length;
  if (powerCount < 0 || powerCount > ROOM_LIMITS.power) {
    throw new ScheduleError(
      "贸易站、制造站和发电站的总数必须为 9，且发电站最多 3 个",
    );
  }
  layout.push(
    ...Array.from({ length: powerCount }, () => ({
      type: "power" as const,
      level: 3,
    })),
  );

  const functionalToken = rowTokens[1]?.[0] ?? "";
  const functionalTypes = LAYOUT_INPUT_ROWS[1]?.slice(0, 4) ?? [];
  if (!/^\d{4}$/.test(functionalToken)) {
    throw new ScheduleError(
      "第 2 行第 1 段必须按会客室、加工站、办公室、训练室填写 4 位数字",
    );
  }
  [...functionalToken].forEach((character, typeIndex) => {
    if (character === "0") {
      return;
    }
    const type = functionalTypes[typeIndex];
    if (!type) {
      throw new ScheduleError("第 2 行功能设施顺序无效");
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

  const dormitoryToken = rowTokens[1]?.[1] ?? "";
  const dormitoryType = LAYOUT_INPUT_ROWS[1]?.[4];
  if (!dormitoryType) {
    throw new ScheduleError("宿舍输入配置无效");
  }
  if (dormitoryToken !== "0") {
    if (!/^\d+$/.test(dormitoryToken)) {
      throw new ScheduleError(
        "宿舍只能使用 0 表示不建造，或填写连续的设施等级数字",
      );
    }
    if (dormitoryToken.length > ROOM_LIMITS[dormitoryType]) {
      throw new ScheduleError(
        `宿舍最多填写 ${ROOM_LIMITS[dormitoryType]} 个设施等级数字`,
      );
    }
    [...dormitoryToken].forEach((character) => {
      const level = Number(character);
      const range = roomLevelRange(dormitoryType);
      if (level < range.min || level > range.max) {
        throw new ScheduleError(
          `${ROOM_LABELS[dormitoryType]}等级必须在 ${range.min} 到 ${range.max} 之间`,
        );
      }
      layout.push({ type: dormitoryType, level });
    });
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
    if (typeof operator !== "string" || (operator !== "" && !operator.trim())) {
      fail(`${path}.operators[${index}]`, "必须是干员名称字符串");
    }
    return operator;
  });
  return names;
}

function validateRunOrderOperators(
  room: RoomAssignment,
  type: RoomKey,
  path: string,
): string[] {
  if (!hasOwn(room, "runOrderOperators")) return [];
  if (type !== "trading") {
    fail(`${path}.runOrderOperators`, "只支持贸易站跑单槽位");
  }
  if (!Array.isArray(room.runOrderOperators)) {
    fail(`${path}.runOrderOperators`, "必须是干员名称字符串数组");
  }
  return room.runOrderOperators.map((operator, index) => {
    if (typeof operator !== "string" || (operator !== "" && !operator.trim())) {
      fail(`${path}.runOrderOperators[${index}]`, "必须是干员名称字符串");
    }
    return operator;
  });
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
  if ((room.runOrderOperators?.length ?? 0) > capacity) {
    fail(`${path}.runOrderOperators`, `超过该设施 ${capacity} 个跑单槽位上限`);
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
    if (!name.trim() || !names.includes(name)) {
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
    hasOwn(settings, "runOrderEnabled") &&
    typeof settings.runOrderEnabled !== "boolean"
  ) {
    fail("settings.runOrderEnabled", "必须是布尔值");
  }
  if (
    hasOwn(settings, "lmdDroneStrategy") &&
    typeof settings.lmdDroneStrategy !== "string"
  ) {
    fail("settings.lmdDroneStrategy", "必须是字符串");
  }
  if (
    hasOwn(settings, "overflowMode") &&
    settings.overflowMode !== "continue" &&
    settings.overflowMode !== "zero"
  ) {
    fail("settings.overflowMode", "必须是 continue 或 zero");
  }
  if (
    hasOwn(settings, "droneOverflowMode") &&
    settings.droneOverflowMode !== "continue" &&
    settings.droneOverflowMode !== "zero"
  ) {
    fail("settings.droneOverflowMode", "必须是 continue 或 zero");
  }
  if (
    hasOwn(settings, "fiammettaMode") &&
    settings.fiammettaMode !== "queue" &&
    settings.fiammettaMode !== "direct"
  ) {
    fail("settings.fiammettaMode", "必须是 queue 或 direct");
  }
  if (hasOwn(settings, "fiammettaDirectCount")) {
    if (
      typeof settings.fiammettaDirectCount !== "number" ||
      !Number.isInteger(settings.fiammettaDirectCount) ||
      settings.fiammettaDirectCount < 0
    ) {
      fail("settings.fiammettaDirectCount", "必须是非负整数");
    }
  }
  if (hasOwn(settings, "tradeOrderCount")) {
    validateNumberMap(settings.tradeOrderCount, "settings.tradeOrderCount");
    Object.entries(settings.tradeOrderCount as Record<string, number>).forEach(
      ([key, value]) => {
        if (!Number.isInteger(value)) {
          fail(`settings.tradeOrderCount.${key}`, "必须是整数");
        }
      },
    );
  }
  if (hasOwn(settings, "firstItemProgress")) {
    if (typeof settings.firstItemProgress === "number") {
      if (
        !Number.isFinite(settings.firstItemProgress) ||
        settings.firstItemProgress < 0 ||
        settings.firstItemProgress > 1
      ) {
        fail("settings.firstItemProgress", "必须在 0 到 1 之间");
      }
    } else if (isRecord(settings.firstItemProgress)) {
      validateNumberMap(
        settings.firstItemProgress,
        "settings.firstItemProgress",
      );
      Object.entries(
        settings.firstItemProgress as Record<string, number>,
      ).forEach(([key, value]) => {
        if (value > 1) {
          fail(`settings.firstItemProgress.${key}`, "必须在 0 到 1 之间");
        }
      });
    } else {
      fail("settings.firstItemProgress", "必须是 0 到 1 之间的数字");
    }
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
  const names = [
    ...validateOperators(room as RoomAssignment, path),
    ...validateRunOrderOperators(room as RoomAssignment, type, path),
  ];
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
  if (hasOwn(plan, "drones")) {
    if (!isRecord(plan.drones)) {
      fail(`${path}.drones`, "必须是对象");
    }
    const drones = plan.drones;
    if (hasOwn(drones, "enable") && typeof drones.enable !== "boolean") {
      fail(`${path}.drones.enable`, "必须是布尔值");
    }
    if (
      hasOwn(drones, "room") &&
      drones.room !== "trading" &&
      drones.room !== "manufacture"
    ) {
      fail(`${path}.drones.room`, "必须是 trading 或 manufacture");
    }
    if (
      hasOwn(drones, "index") &&
      (typeof drones.index !== "number" ||
        !Number.isInteger(drones.index) ||
        drones.index < 0)
    ) {
      fail(`${path}.drones.index`, "必须是非负整数");
    }
    if (hasOwn(drones, "rule") && typeof drones.rule !== "string") {
      fail(`${path}.drones.rule`, "必须是字符串");
    }
    if (
      hasOwn(drones, "order") &&
      drones.order !== "pre" &&
      drones.order !== "post"
    ) {
      fail(`${path}.drones.order`, "必须是 pre 或 post");
    }
  }

  const rooms = plan.rooms;
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

export interface DuplicateOperatorWarning {
  planIndex: number;
  name: string;
  locations: string[];
}

export function findDuplicateOperators(
  document: ScheduleDocument,
  terms: BaseSkillTerms | EfficiencyCatalog["terms"] = {},
): DuplicateOperatorWarning[] {
  return document.plans.flatMap((plan, planIndex) => {
    const occurrences = new Map<string, string[]>();
    ROOM_KEYS.forEach((type) => {
      const rooms = plan.rooms[type];
      if (!Array.isArray(rooms)) {
        return;
      }
      rooms.forEach((room, roomIndex) => {
        if (!isRecord(room) || !Array.isArray(room.operators)) {
          return;
        }
        room.operators.forEach((name, slotIndex) => {
          if (
            typeof name !== "string" ||
            !name ||
            isKnownSpecialOperator(name, terms)
          ) {
            return;
          }
          const locations = occurrences.get(name) ?? [];
          locations.push(
            `${ROOM_LABELS[type]} ${roomIndex + 1} 槽位${slotIndex + 1}`,
          );
          occurrences.set(name, locations);
        });
      });
    });
    return [...occurrences.entries()]
      .filter(([, locations]) => locations.length > 1)
      .map(([name, locations]) => ({ planIndex, name, locations }));
  });
}

export function formatDuplicateOperatorWarnings(
  document: ScheduleDocument,
  terms: BaseSkillTerms = {},
): string {
  return findDuplicateOperators(document, terms)
    .map(({ planIndex, name, locations }) => {
      const plan = document.plans[planIndex];
      const planName = plan?.name?.trim() || `队列${planIndex + 1}`;
      return `${planName}：${name}（${locations.join("、")}）`;
    })
    .join("；");
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
  const clone = JSON.parse(JSON.stringify(document)) as ScheduleDocument;
  const settings = clone.settings as
    (ScheduleSettings & Record<string, unknown>) | undefined;
  if (settings) {
    delete settings.featherFixedOps;
    delete settings.featherTargets;
  }
  return clone;
}

export function createEmptySchedule(): ScheduleDocument {
  return {
    title: "新建排班表",
    description: "",
    settings: {
      clueExchanging: true,
      dormFullTreat: true,
      fiammettaMode: "direct",
      fiammettaDirectCount: 3,
      preferMaxJieEfficiency: true,
      overflowMode: "continue",
      firstItemProgress: 0,
    },
    layout: [{ type: "control", level: 5 }],
    plans: [
      {
        name: "队列1",
        duration: 720,
        rooms: {
          control: [{}],
        },
      },
    ],
  };
}

export function roomCount(document: ScheduleDocument, type: RoomKey): number {
  return document.layout.filter((entry) => entry.type === type).length;
}

function roomAssignmentAt(
  plan: Plan,
  type: RoomKey,
  position: number,
): RoomAssignment {
  const rooms = plan.rooms[type];
  if (!Array.isArray(rooms)) {
    return {};
  }
  const room = rooms[position];
  if (!isRecord(room)) {
    return {};
  }
  const assignment = room as RoomAssignment;
  if (typeof assignment.product !== "string") {
    return assignment;
  }
  const product = canonicalResourceKey(assignment.product);
  return product === assignment.product
    ? assignment
    : { ...assignment, product };
}

function inheritedOperatorStates(
  states: Record<string, OperatorState> | undefined,
): Record<string, OperatorState> | undefined {
  if (!states) {
    return undefined;
  }
  const result = Object.fromEntries(
    Object.entries(states).map(([name, state]) => {
      const progressionState = { ...state };
      delete progressionState.mood;
      return [name, progressionState];
    }),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

export function resolveRoomAssignment(
  document: ScheduleDocument,
  planIndex: number,
  type: RoomKey,
  position: number,
): ResolvedRoomAssignment {
  const plan = document.plans[planIndex];
  const current = plan ? roomAssignmentAt(plan, type, position) : {};
  if (!current.skip || document.plans.length === 0) {
    return { assignment: current, inherited: false };
  }

  for (let offset = 1; offset <= document.plans.length; offset += 1) {
    const sourcePlanIndex =
      (planIndex - offset + document.plans.length) % document.plans.length;
    const sourcePlan = document.plans[sourcePlanIndex];
    if (!sourcePlan) {
      continue;
    }
    const source = roomAssignmentAt(sourcePlan, type, position);
    if (source.skip || !source.operators?.some(Boolean)) {
      continue;
    }
    const operatorStates = inheritedOperatorStates(source.operatorStates);
    return {
      inherited: true,
      sourcePlanIndex,
      assignment: {
        ...current,
        skip: false,
        operators: source.operators ? [...source.operators] : undefined,
        ...(operatorStates
          ? { operatorStates }
          : { operatorStates: undefined }),
      },
    };
  }

  return {
    assignment: { ...current, operators: undefined, operatorStates: undefined },
    inherited: false,
  };
}
