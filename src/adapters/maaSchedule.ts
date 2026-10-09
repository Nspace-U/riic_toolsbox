import type {
  JsonValue,
  ParsedSchedule,
  ScheduleDocument,
} from "@/types/schedule";
import { ROOM_KEYS } from "@/types/schedule";
import {
  DEFAULT_SOURCE_MATERIAL,
  ScheduleError,
  validateLayout,
  validatePlans,
  validateSchedule,
} from "@/utils/schedule";
import type { ScheduleAdapter } from "@/adapters";
import type { EfficiencyCatalog } from "@arknights/riic-efficiency";
import {
  analyzeSchedulePeriods,
  completeInferredRooms,
  inferScheduleLayout,
  mapSpecialOperators,
} from "@arknights/riic-efficiency";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(path: string, message: string): never {
  throw new ScheduleError(`${path}：${message}`);
}

const MAA_PRODUCT_TO_INTERNAL: Readonly<Record<string, string>> = {
  LMD: "龙门币",
  Orundum: "合成玉",
  "Pure Gold": "赤金",
  "Battle Record": "中级作战记录",
  "Originium Shard": "源石碎片",
};

const INTERNAL_PRODUCT_TO_MAA: Readonly<Record<string, string>> = {
  龙门币: "LMD",
  合成玉: "Orundum",
  赤金: "Pure Gold",
  中级作战记录: "Battle Record",
  源石碎片: "Originium Shard",
};

function mapMaaProducts(
  document: ScheduleDocument,
  mapping: Readonly<Record<string, string>>,
): void {
  document.plans.forEach((plan) => {
    Object.values(plan.rooms).forEach((value) => {
      if (!Array.isArray(value)) {
        return;
      }
      value.forEach((room) => {
        if (!isRecord(room) || typeof room.product !== "string") {
          return;
        }
        room.product = mapping[room.product] ?? room.product;
      });
    });
  });
}

function removeRoomDescriptions(document: ScheduleDocument): void {
  document.plans.forEach((plan) => {
    ROOM_KEYS.forEach((type) => {
      const rooms = plan.rooms[type];
      if (!Array.isArray(rooms)) {
        return;
      }
      rooms.forEach((room) => {
        if (isRecord(room)) {
          delete room.description;
        }
      });
    });
  });
}

function fiammettaTarget(value: unknown): string | undefined {
  if (
    !isRecord(value) ||
    value.enable !== true ||
    typeof value.target !== "string"
  ) {
    return undefined;
  }
  return value.target.trim() || undefined;
}

function importFiammetta(document: ScheduleDocument): void {
  const queue = document.plans.map((plan) => {
    const target = fiammettaTarget(plan.Fiammetta);
    delete plan.Fiammetta;
    return target ? { operators: [target] } : {};
  });
  const settings = {
    ...(document.settings ?? {}),
    fiammettaMode: "queue" as const,
  };
  delete (settings as Record<string, unknown>).featherFixedOps;
  delete (settings as Record<string, unknown>).featherTargets;
  document.settings = settings;
  document.fiammetta = { ...(document.fiammetta ?? {}), queue };
}

function applyDocumentDefaults(document: ScheduleDocument): void {
  document.plans.forEach((plan) => {
    const rooms = plan.rooms.manufacture;
    if (!Array.isArray(rooms)) {
      return;
    }
    rooms.forEach((room) => {
      if (!isRecord(room) || room.product !== "源石碎片") {
        return;
      }
      if (!hasOwn(room, "sourceMaterial") || room.sourceMaterial === "") {
        room.sourceMaterial = DEFAULT_SOURCE_MATERIAL;
      }
    });
  });
}

function normalizePlanPeriods(document: ScheduleDocument): void {
  document.plans.forEach((plan) => {
    if (plan.period === undefined || !plan.settings) {
      return;
    }
    delete plan.settings.period;
    if (Object.keys(plan.settings).length === 0) {
      delete plan.settings;
    }
  });
}

function syncPeriodDurations(document: ScheduleDocument): void {
  const analysis = analyzeSchedulePeriods(document);
  if (!analysis.enabled || analysis.errors.length > 0) {
    return;
  }
  document.plans.forEach((plan, index) => {
    const duration = analysis.durations[index];
    if (duration !== undefined) {
      plan.duration = duration;
    }
  });
}

function mapMaaDrones(document: ScheduleDocument, importing: boolean): void {
  document.plans.forEach((plan) => {
    const drones = plan.drones;
    if (!isRecord(drones) || typeof drones.index !== "number") {
      return;
    }
    drones.index += importing ? -1 : 1;
  });
}

function parseRoot(
  value: unknown,
): Record<string, unknown> & { plans: unknown[] } {
  if (!isRecord(value)) {
    throw new ScheduleError("JSON 根节点必须是对象");
  }
  if (!Array.isArray(value.plans) || value.plans.length === 0) {
    throw new ScheduleError("缺少非空 plans 数组");
  }
  return value as Record<string, unknown> & { plans: unknown[] };
}

export function parseMaaScheduleText(text: string): ParsedSchedule {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    throw new ScheduleError("文件不是有效的严格 JSON，不支持 JSONC 注释");
  }

  const root = parseRoot(parsed);
  const hasLayout = hasOwn(root, "layout");
  const layout = hasLayout ? validateLayout(root.layout) : undefined;
  const plans = validatePlans(root.plans, layout);
  const resolvedLayout = layout ?? inferScheduleLayout(plans);
  if (resolvedLayout.length === 0) {
    fail("layout", "无法从 plans 推断出设施布局");
  }
  const resolvedPlans = hasLayout
    ? plans
    : completeInferredRooms(plans, resolvedLayout);
  const document: ScheduleDocument = {
    ...root,
    layout: resolvedLayout,
    plans: resolvedPlans,
  };
  if (document.settings) {
    delete document.settings.recycleBoostItemId;
  }
  removeRoomDescriptions(document);
  mapMaaProducts(document, MAA_PRODUCT_TO_INTERNAL);
  mapMaaDrones(document, true);
  importFiammetta(document);
  applyDocumentDefaults(document);
  normalizePlanPeriods(document);
  syncPeriodDurations(document);
  validateSchedule(document);
  return { document, inferredLayout: !hasLayout };
}

export interface MaaScheduleSerializeOptions {
  catalog?: EfficiencyCatalog;
}

export function serializeMaaSchedule(
  document: ScheduleDocument,
  options: MaaScheduleSerializeOptions = {},
): string {
  validateSchedule(document);
  const mapping = mapSpecialOperators(document, options.catalog);
  const issue = mapping.issues[0];
  if (issue) {
    throw new ScheduleError(issue.errorMessage);
  }
  const normalized = mapping.document;
  delete normalized.importFiammetta;
  const fiammetta = normalized.fiammetta;
  delete normalized.fiammetta;
  const directTargets = fiammetta?.direct?.operators?.filter(Boolean) ?? [];
  normalized.plans.forEach((plan, planIndex) => {
    if (plan.period !== undefined && plan.settings) {
      delete plan.settings.period;
      if (Object.keys(plan.settings).length === 0) {
        delete plan.settings;
      }
    }
    delete plan.Fiammetta;
    ROOM_KEYS.forEach((type) => {
      const rooms = plan.rooms[type];
      if (!Array.isArray(rooms)) {
        return;
      }
      rooms.forEach((room) => {
        if (!isRecord(room)) {
          return;
        }
        delete room.description;
        if (!Array.isArray(room.operators)) {
          return;
        }
        const operators = room.operators.filter(Boolean);
        if (operators.length > 0) {
          room.operators = operators;
        } else {
          delete room.operators;
        }
      });
    });
    const target =
      normalized.settings?.fiammettaMode === "queue"
        ? fiammetta?.queue?.[planIndex]?.operators?.find(Boolean)
        : directTargets[planIndex];
    if (target) {
      plan.Fiammetta = { enable: true, target, order: "pre" };
    }
  });
  applyDocumentDefaults(normalized);
  mapMaaDrones(normalized, false);
  mapMaaProducts(normalized, INTERNAL_PRODUCT_TO_MAA);
  if (normalized.settings) {
    delete normalized.settings.recycleBoostItemId;
    if (Object.keys(normalized.settings).length === 0) {
      delete normalized.settings;
    }
  }
  validateSchedule(normalized);
  return JSON.stringify(normalized, null, 2);
}

export const maaScheduleAdapter: ScheduleAdapter = {
  id: "maa-json",
  label: "Maa JSON",
  fileExtension: "json",
  parse: parseMaaScheduleText,
  serialize: serializeMaaSchedule,
};
