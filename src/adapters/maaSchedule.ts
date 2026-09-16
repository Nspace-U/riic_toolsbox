import type {
  JsonValue,
  ParsedSchedule,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import { ROOM_KEYS } from "@/types/schedule";
import {
  DEFAULT_SOURCE_MATERIAL,
  ROOM_LABELS,
  ScheduleError,
  cloneSchedule,
  validateLayout,
  validatePlans,
  validateSchedule,
} from "@/utils/schedule";
import type { ScheduleAdapter } from "@/adapters";
import type { EfficiencyCatalog } from "@/types/efficiency";
import {
  completeInferredRooms,
  inferScheduleLayout,
} from "@/utils/importLayout";
import { percentageMappingFor } from "@/utils/percentageOperatorMappings";
import {
  isPercentageOperator,
  isTermOperator,
  specialOperatorTermMembers,
} from "@/utils/specialOperators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(path: string, message: string): never {
  throw new ScheduleError(`${path}：${message}`);
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
      if (!isRecord(room) || room.product !== "Originium Shard") {
        return;
      }
      if (!hasOwn(room, "sourceMaterial") || room.sourceMaterial === "") {
        room.sourceMaterial = DEFAULT_SOURCE_MATERIAL;
      }
    });
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
  importFiammetta(document);
  applyDocumentDefaults(document);
  validateSchedule(document);
  return { document, inferredLayout: !hasLayout };
}

export interface MaaScheduleSerializeOptions {
  catalog?: EfficiencyCatalog;
}

function mapSpecialOperators(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog | undefined,
): void {
  const percentagePositions = new Map<string, number>();
  document.plans.forEach((plan) => {
    const used = new Set<string>();
    Object.values(plan.rooms).forEach((value) => {
      if (!Array.isArray(value)) {
        return;
      }
      value.forEach((roomValue) => {
        if (!isRecord(roomValue) || !Array.isArray(roomValue.operators)) {
          return;
        }
        roomValue.operators.forEach((name) => {
          if (
            !isPercentageOperator(name) &&
            !(catalog && isTermOperator(name, catalog))
          ) {
            used.add(name);
          }
        });
      });
    });
    Object.entries(plan.rooms).forEach(([type, value]) => {
      if (!Array.isArray(value)) {
        return;
      }
      value.forEach((roomValue) => {
        if (!isRecord(roomValue) || !Array.isArray(roomValue.operators)) {
          return;
        }
        const room = roomValue as RoomAssignment;
        const roomType = type as RoomKey;
        const operators = room.operators ?? [];
        const states = room.operatorStates;
        const mappedStates: NonNullable<RoomAssignment["operatorStates"]> = {};
        room.operators = operators.map((name) => {
          const mapping = percentageMappingFor(roomType, room.product, name);
          if (mapping) {
            const key = `${roomType}|${mapping.product ?? "*"}|${mapping.percentage}`;
            const position = percentagePositions.get(key) ?? 0;
            let next = -1;
            for (
              let offset = 0;
              offset < mapping.operators.length;
              offset += 1
            ) {
              const index = (position + offset) % mapping.operators.length;
              if (!used.has(mapping.operators[index]!)) {
                next = index;
                break;
              }
            }
            if (next < 0) {
              throw new ScheduleError(
                `${ROOM_LABELS[roomType]} 中的 ${name} 没有可用的百分比映射干员`,
              );
            }
            const mapped = mapping.operators[next]!;
            percentagePositions.set(key, (next + 1) % mapping.operators.length);
            used.add(mapped);
            if (states?.[name]) {
              mappedStates[mapped] = states[name];
            }
            return mapped;
          }
          if (isPercentageOperator(name)) {
            throw new ScheduleError(
              `${ROOM_LABELS[roomType]} 中的百分比干员“${name}”没有配置映射`,
            );
          }
          if (catalog && isTermOperator(name, catalog)) {
            const mapped = specialOperatorTermMembers(name, catalog).find(
              (candidate) => !used.has(candidate),
            );
            if (!mapped) {
              throw new ScheduleError(
                `${ROOM_LABELS[roomType]} 中的术语干员“${name}”没有可用的映射干员`,
              );
            }
            used.add(mapped);
            if (states?.[name]) {
              mappedStates[mapped] = states[name];
            }
            return mapped;
          }
          if (states?.[name]) {
            mappedStates[name] = states[name];
          }
          return name;
        });
        if (Object.keys(mappedStates).length > 0) {
          room.operatorStates = mappedStates;
        } else {
          delete room.operatorStates;
        }
      });
    });
  });
}

export function serializeMaaSchedule(
  document: ScheduleDocument,
  options: MaaScheduleSerializeOptions = {},
): string {
  validateSchedule(document);
  const normalized = cloneSchedule(document);
  mapSpecialOperators(normalized, options.catalog);
  delete normalized.importFiammetta;
  const fiammetta = normalized.fiammetta;
  delete normalized.fiammetta;
  const directTargets = fiammetta?.direct?.operators?.filter(Boolean) ?? [];
  normalized.plans.forEach((plan, planIndex) => {
    delete plan.Fiammetta;
    ROOM_KEYS.forEach((type) => {
      const rooms = plan.rooms[type];
      if (!Array.isArray(rooms)) {
        return;
      }
      rooms.forEach((room) => {
        if (!isRecord(room) || !Array.isArray(room.operators)) {
          return;
        }
        delete room.description;
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
