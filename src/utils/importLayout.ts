import type {
  LayoutEntry,
  Plan,
  RoomAssignment,
  RoomKey,
} from "@/types/schedule";
import {
  ROOM_LIMITS,
  ROOM_ORDER,
  ROOM_POWER_VALUES,
  roomSlotCount,
  createDefaultRoomAssignment,
} from "@/utils/schedule";
import { ROOM_KEYS } from "@/types/schedule";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maxOperatorsForRoom(
  plans: Plan[],
  type: RoomKey,
  position: number,
): number {
  return plans.reduce((max, plan) => {
    const rooms = plan.rooms[type];
    if (!Array.isArray(rooms)) {
      return max;
    }
    const room = rooms[position];
    return isRecord(room) && Array.isArray(room.operators)
      ? Math.max(max, room.operators.length)
      : max;
  }, 0);
}

function roomCount(plans: Plan[], type: RoomKey): number {
  return plans.reduce((max, plan) => {
    const rooms = plan.rooms[type];
    return Array.isArray(rooms) ? Math.max(max, rooms.length) : max;
  }, 0);
}

function powerOfLayout(layout: LayoutEntry[]): {
  provided: number;
  used: number;
  net: number;
} {
  return layout.reduce(
    (summary, entry) => {
      const power = ROOM_POWER_VALUES[entry.type][entry.level - 1] ?? 0;
      if (power >= 0) {
        summary.provided += power;
      } else {
        summary.used += -power;
      }
      summary.net = summary.provided - summary.used;
      return summary;
    },
    { provided: 0, used: 0, net: 0 },
  );
}

function addLevel(
  type: RoomKey,
  levels: number[],
  layout: LayoutEntry[],
): void {
  levels.slice(0, ROOM_LIMITS[type]).forEach((level) => {
    layout.push({ type, level });
  });
}

export function dormitoryLevels(
  count: number,
  remainingPower: number,
): number[] {
  const levels: number[] = [];
  let remaining = Math.max(0, remainingPower);
  while (levels.length < Math.min(count, 4) && remaining >= 10) {
    levels.push(1);
    remaining -= 10;
  }
  const costs = [10, 10, 15, 20];
  for (let index = 0; index < levels.length; index += 1) {
    while (levels[index]! < 5) {
      const nextLevel = levels[index]!;
      const cost = costs[nextLevel - 1] ?? 0;
      if (cost > remaining) {
        break;
      }
      levels[index] = nextLevel + 1;
      remaining -= cost;
    }
  }
  return levels;
}

export function inferScheduleLayout(plans: Plan[]): LayoutEntry[] {
  const layout: LayoutEntry[] = [];
  const counts = Object.fromEntries(
    ROOM_KEYS.map((type) => [type, roomCount(plans, type)]),
  ) as Record<RoomKey, number>;

  if (counts.control > 0) {
    addLevel("control", [5], layout);
  }
  (["trading", "manufacture"] as const).forEach((type: RoomKey) => {
    addLevel(
      type,
      Array.from({ length: counts[type] }, (_, index) =>
        Math.max(1, Math.min(3, maxOperatorsForRoom(plans, type, index) || 3)),
      ),
      layout,
    );
  });
  const powerCount = Math.min(
    ROOM_LIMITS.power,
    Math.max(
      counts.power,
      plans.reduce((max, plan) => {
        const rooms = plan.rooms.power;
        if (!Array.isArray(rooms)) {
          return max;
        }
        return Math.max(
          max,
          rooms.reduce(
            (total, room) =>
              total +
              (isRecord(room) && Array.isArray(room.operators)
                ? room.operators.filter(Boolean).length
                : 0),
            0,
          ),
        );
      }, 0),
    ),
  );
  addLevel(
    "power",
    Array.from({ length: powerCount }, () => 3),
    layout,
  );

  const functionalTypes = [
    "meeting",
    "processing",
    "hire",
    "training",
  ] as const;
  const fullLevels = [3, 3, 3, 3];
  const fallbackLevels = [1, 3, 1, 3];
  const functionalCost = (levels: readonly number[]): number =>
    functionalTypes.reduce(
      (total, type, index) =>
        total +
        (counts[type] > 0
          ? -(ROOM_POWER_VALUES[type][levels[index]! - 1] ?? 0)
          : 0),
      0,
    );
  const corePower = powerOfLayout(layout);
  const functionalLevels =
    corePower.net >= functionalCost(fullLevels) ? fullLevels : fallbackLevels;
  functionalTypes.forEach((type: RoomKey, index) => {
    addLevel(
      type,
      Array.from({ length: counts[type] }, () => functionalLevels[index]!),
      layout,
    );
  });

  const beforeDormitory = powerOfLayout(layout);
  addLevel(
    "dormitory",
    dormitoryLevels(counts.dormitory, beforeDormitory.net),
    layout,
  );
  return layout;
}

export function completeInferredRooms(
  plans: Plan[],
  layout: LayoutEntry[],
): Plan[] {
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
          const operatorStates = typedRoom.operatorStates;
          const roomMeta = { ...typedRoom };
          delete roomMeta.operators;
          delete roomMeta.operatorStates;
          const operators = typedRoom.operators ?? [];
          rooms[type] = operators.filter(Boolean).map((operator) => ({
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
        existing.push(createDefaultRoomAssignment(type));
      }
      rooms[type] = existing;
    });
    return { ...plan, rooms };
  });
}

export function resizeImportedRooms(
  plans: Plan[],
  layout: LayoutEntry[],
): Plan[] {
  return plans.map((plan) => {
    const rooms = { ...plan.rooms };
    ROOM_ORDER.forEach((type) => {
      const entries = layout.filter((entry) => entry.type === type);
      if (entries.length === 0) {
        delete rooms[type];
        return;
      }
      const source = Array.isArray(rooms[type]) ? rooms[type] : [];
      rooms[type] = entries.map((entry, index) => {
        const room = isRecord(source[index])
          ? ({ ...(source[index] as RoomAssignment) } as RoomAssignment)
          : createDefaultRoomAssignment(type);
        const capacity = roomSlotCount(type, entry.level);
        if (Array.isArray(room.operators)) {
          room.operators = room.operators.slice(0, capacity);
          if (room.operators.length === 0) {
            delete room.operators;
          }
        }
        if (room.operatorStates) {
          const names = new Set(room.operators ?? []);
          room.operatorStates = Object.fromEntries(
            Object.entries(room.operatorStates).filter(([name]) =>
              names.has(name),
            ),
          );
          if (Object.keys(room.operatorStates).length === 0) {
            delete room.operatorStates;
          }
        }
        return room;
      });
    });
    return { ...plan, rooms };
  });
}

export function importPowerSummary(layout: LayoutEntry[]): {
  provided: number;
  used: number;
  net: number;
} {
  return powerOfLayout(layout);
}
