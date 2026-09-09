import type {
  JsonValue,
  LayoutEntry,
  ParsedSchedule,
  Plan,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import { ROOM_KEYS } from "@/types/schedule";
import {
  DEFAULT_SOURCE_MATERIAL,
  ROOM_ORDER,
  ScheduleError,
  cloneSchedule,
  roomLevelRange,
  validateLayout,
  validatePlans,
  validateSchedule,
} from "@/utils/schedule";
import type { ScheduleAdapter } from "@/adapters";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(path: string, message: string): never {
  throw new ScheduleError(`${path}：${message}`);
}

function clampLevel(type: RoomKey, level: number): number {
  const range = roomLevelRange(type);
  return Math.max(range.min, Math.min(range.max, Math.round(level)));
}

function maxOperatorsForRoom(
  plans: Plan[],
  type: RoomKey,
  position: number,
): number {
  let max = 0;
  plans.forEach((plan) => {
    const rooms = plan.rooms[type];
    if (!Array.isArray(rooms)) {
      return;
    }
    const room = rooms[position];
    if (isRecord(room) && Array.isArray(room.operators)) {
      max = Math.max(max, room.operators.length);
    }
  });
  return max;
}

function inferLayout(plans: Plan[]): LayoutEntry[] {
  const layout: LayoutEntry[] = [];
  ROOM_ORDER.forEach((type) => {
    const maxLength = plans.reduce((max, plan) => {
      const rooms = plan.rooms[type];
      return Array.isArray(rooms) ? Math.max(max, rooms.length) : max;
    }, 0);
    if (maxLength === 0) {
      return;
    }

    const count =
      type === "power"
        ? Math.max(
            maxLength,
            plans.reduce((max, plan) => {
              const rooms = plan.rooms[type];
              if (!Array.isArray(rooms)) {
                return max;
              }
              const operatorCount = rooms.reduce((total, room) => {
                return (
                  total +
                  (isRecord(room) && Array.isArray(room.operators)
                    ? room.operators.length
                    : 0)
                );
              }, 0);
              return Math.max(max, operatorCount);
            }, 0),
          )
        : maxLength;

    for (let position = 0; position < count; position += 1) {
      const inferredLevel =
        type === "control"
          ? maxOperatorsForRoom(plans, type, 0) || 1
          : type === "trading" || type === "manufacture"
            ? maxOperatorsForRoom(plans, type, position) || 3
            : type === "dormitory"
              ? 5
              : 3;
      layout.push({ type, level: clampLevel(type, inferredLevel) });
    }
  });
  return layout;
}

function completeInferredRooms(plans: Plan[], layout: LayoutEntry[]): Plan[] {
  return plans.map((plan) => {
    const rooms = { ...plan.rooms };
    ROOM_KEYS.forEach((type) => {
      const expected = layout.filter((entry) => entry.type === type).length;
      if (expected === 0) {
        return;
      }
      const existing = Array.isArray(rooms[type]) ? [...rooms[type]] : [];
      if (type === "power" && existing.length === 1) {
        const mergedRoom = existing[0];
        if (
          isRecord(mergedRoom) &&
          Array.isArray(mergedRoom.operators) &&
          mergedRoom.operators.length > 1
        ) {
          const typedRoom = mergedRoom as RoomAssignment;
          const operators = typedRoom.operators ?? [];
          const operatorStates = typedRoom.operatorStates;
          const roomMeta = { ...typedRoom };
          delete roomMeta.operators;
          delete roomMeta.operatorStates;
          rooms[type] = operators.map((operator) => ({
            ...roomMeta,
            operators: [operator],
            ...(operatorStates?.[operator]
              ? { operatorStates: { [operator]: operatorStates[operator] } }
              : {}),
          }));
          return;
        }
      }
      while (existing.length < expected) {
        existing.push({ skip: true });
      }
      rooms[type] = existing;
    });
    return { ...plan, rooms };
  });
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
  const resolvedLayout = layout ?? inferLayout(plans);
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
  applyDocumentDefaults(document);
  validateSchedule(document);
  return { document, inferredLayout: !hasLayout };
}

export function serializeMaaSchedule(document: ScheduleDocument): string {
  validateSchedule(document);
  const normalized = cloneSchedule(document);
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
