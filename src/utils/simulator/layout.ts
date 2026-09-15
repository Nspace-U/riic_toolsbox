import type {
  LayoutEntry,
  Plan,
  RoomAssignment,
  RoomKey,
} from "@/types/schedule";
import {
  BUILD_CHAIN_REQUIRED,
  LAYOUT_INPUT_ROWS,
  ROOM_ORDER,
  canAddLayoutEntry,
  createDefaultRoomAssignment,
  roomLevelRange,
  roomSlotCount,
  ScheduleError,
} from "@/utils/schedule";

export interface LayoutAdditionPlan {
  types: RoomKey[];
}

export function roomsForLayout(
  layout: LayoutEntry[],
): Record<string, RoomAssignment[]> {
  const rooms: Record<string, RoomAssignment[]> = {};
  ROOM_ORDER.forEach((type) => {
    const count = layout.filter((entry) => entry.type === type).length;
    if (count > 0) {
      rooms[type] = Array.from({ length: count }, () =>
        createDefaultRoomAssignment(type),
      );
    }
  });
  return rooms;
}

export function normalizeRoomCapacity(
  room: RoomAssignment,
  type: RoomKey,
  level: number,
): RoomAssignment {
  const capacity = roomSlotCount(type, level);
  if (!room.operators || room.operators.length <= capacity) {
    return room;
  }

  room.operators = room.operators.slice(0, capacity);
  if (room.operatorStates) {
    room.operatorStates = Object.fromEntries(
      Object.entries(room.operatorStates).filter(([name]) =>
        room.operators?.includes(name),
      ),
    );
    if (Object.keys(room.operatorStates).length === 0) {
      delete room.operatorStates;
    }
  }
  return room;
}

export function resizeRoomsForLayout(plan: Plan, layout: LayoutEntry[]): void {
  const nextRooms: Record<string, RoomAssignment[] | unknown> = {
    ...plan.rooms,
  };
  ROOM_ORDER.forEach((type) => {
    const expected = layout.filter((entry) => entry.type === type).length;
    if (expected === 0) {
      delete nextRooms[type];
      return;
    }
    const previous = Array.isArray(plan.rooms[type])
      ? (plan.rooms[type] as RoomAssignment[])
      : [];
    const entries = layout.filter((entry) => entry.type === type);
    nextRooms[type] = Array.from({ length: expected }, (_, index) =>
      normalizeRoomCapacity(
        previous[index] ?? createDefaultRoomAssignment(type),
        type,
        entries[index]?.level ?? 1,
      ),
    );
  });
  plan.rooms = nextRooms;
}

export function layoutEntryLevelMax(type: RoomKey): number {
  return roomLevelRange(type).max;
}

export function layoutTextFor(layout: LayoutEntry[]): string {
  function levelsFor(type: RoomKey): string {
    const levels = layout
      .filter((entry) => entry.type === type)
      .map((entry) => entry.level)
      .join("");
    return levels || "0";
  }

  const coreTypes = LAYOUT_INPUT_ROWS[0] ?? [];
  const functionalTypes = LAYOUT_INPUT_ROWS[1]?.slice(0, 4) ?? [];
  const dormitoryType = LAYOUT_INPUT_ROWS[1]?.[4];
  return [
    coreTypes.map((type) => levelsFor(type)).join(" "),
    `${functionalTypes.map((type) => levelsFor(type)).join("")} ${dormitoryType ? levelsFor(dormitoryType) : "0"}`,
  ].join("\n");
}

export function layoutBuildChain(type: RoomKey): RoomKey[] {
  const requiredType = BUILD_CHAIN_REQUIRED[type];
  return requiredType ? [...layoutBuildChain(requiredType), type] : [type];
}

export function layoutAdditionPlan(
  layout: LayoutEntry[],
  type: RoomKey,
): LayoutAdditionPlan | undefined {
  const candidateLayout = [...layout];
  const chain = layoutBuildChain(type);
  const typesToAdd = chain.filter(
    (entryType, index) =>
      index === chain.length - 1 ||
      !candidateLayout.some((entry) => entry.type === entryType),
  );

  for (const entryType of typesToAdd) {
    const result = canAddLayoutEntry(candidateLayout, entryType);
    if (!result.ok) {
      return undefined;
    }
    candidateLayout.push({
      type: entryType,
      level: layoutEntryLevelMax(entryType),
    });
  }

  return { types: typesToAdd };
}

export function layoutWithBuildChain(
  requestedLayout: LayoutEntry[],
): LayoutEntry[] {
  const requestedByType = new Map<RoomKey, LayoutEntry[]>();
  const includedTypes = new Set<RoomKey>();

  requestedLayout.forEach((entry) => {
    const entries = requestedByType.get(entry.type) ?? [];
    entries.push(entry);
    requestedByType.set(entry.type, entries);
    includedTypes.add(entry.type);
    layoutBuildChain(entry.type)
      .slice(0, -1)
      .forEach((requiredType) => includedTypes.add(requiredType));
  });

  const buildOrder: RoomKey[] = [
    "control",
    "trading",
    "manufacture",
    "power",
    "meeting",
    "processing",
    "hire",
    "training",
    "dormitory",
  ];
  return buildOrder.flatMap((type) => {
    if (!includedTypes.has(type)) {
      return [];
    }
    const requestedEntries = requestedByType.get(type);
    return requestedEntries?.length
      ? requestedEntries.map((entry) => ({ ...entry }))
      : [{ type, level: layoutEntryLevelMax(type) }];
  });
}

export function validateAddedLayout(layout: LayoutEntry[]): LayoutEntry[] {
  const validatedLayout: LayoutEntry[] = [];
  layout.forEach((entry) => {
    const result = canAddLayoutEntry(validatedLayout, entry.type);
    if (!result.ok) {
      throw new ScheduleError(result.reason);
    }
    validatedLayout.push(entry);
  });
  return validatedLayout;
}

export function cascadeLayoutTypes(type: RoomKey): RoomKey[] {
  if (type === "meeting") {
    return ["processing", "hire", "training"];
  }
  if (type === "processing") {
    return ["hire", "training"];
  }
  if (type === "hire") {
    return ["training"];
  }
  return [];
}
