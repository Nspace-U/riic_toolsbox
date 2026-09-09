import type { EliteLevel } from "@/types/baseData";
import type { OperatorSkillFile } from "@/types/efficiency";
import type {
  OperatorProgressionEntry,
  OperatorProgressionNode,
  OperatorProgressionResolverInput,
  ResolvedOperatorProgression,
} from "@/types/operatorProgression";
import type { RoomKey } from "@/types/schedule";

const NON_WORK_ROOMS = new Set<RoomKey>([
  "dormitory",
  "processing",
  "training",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampElite(value: number): EliteLevel {
  return value === 2 ? 2 : value === 1 ? 1 : 0;
}

function clampLevel(value: number): number {
  return Math.max(0, Math.min(90, Math.round(value)));
}

function nodeKey(type: "elite" | "level", value: number): string {
  return `${type}-${value}`;
}

function nodeLabel(type: "elite" | "level", value: number): string {
  return type === "elite" ? `精英${value}` : `${value}级`;
}

export function progressionEntryFromUnknown(
  value: unknown,
  fallbackId = "",
): OperatorProgressionEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = typeof value.id === "string" ? value.id : fallbackId;
  const name = typeof value.name === "string" ? value.name : "";
  const elite = Number(value.elite);
  const level = Number(value.level);
  const rarity = Number(value.rarity);
  if (
    !id ||
    !name ||
    !Number.isInteger(elite) ||
    elite < 0 ||
    elite > 2 ||
    !Number.isInteger(level) ||
    level < 0 ||
    level > 90 ||
    typeof value.own !== "boolean" ||
    !Number.isInteger(rarity) ||
    rarity < 1 ||
    rarity > 6
  ) {
    return undefined;
  }
  return {
    id,
    name,
    elite: clampElite(elite),
    level,
    owned: value.own,
    rarity,
  };
}

export function parseOperatorProgressionImport(
  value: unknown,
): OperatorProgressionEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("练度 JSON 必须是非空数组");
  }
  const entries = value.map((item) => progressionEntryFromUnknown(item));
  if (entries.some((entry) => !entry)) {
    throw new Error("练度 JSON 包含无效干员记录");
  }
  const validEntries = entries as OperatorProgressionEntry[];
  if (
    new Set(validEntries.map((entry) => entry.id)).size !== validEntries.length
  ) {
    throw new Error("练度 JSON 包含重复干员 ID");
  }
  return validEntries;
}

export function cloneProgressionEntries(
  entries: Record<string, OperatorProgressionEntry>,
): Record<string, OperatorProgressionEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([id, entry]) => [id, { ...entry }]),
  );
}

export function progressionNodes(
  operatorSkillFile: OperatorSkillFile | undefined,
): OperatorProgressionNode[] {
  if (!operatorSkillFile) {
    return [];
  }
  const grouped = new Map<string, OperatorProgressionNode>();
  operatorSkillFile.chains.forEach((chain) => {
    chain.stages.forEach((stage) => {
      const type = stage.unlock.type === "level" ? "level" : "elite";
      const value = Number(stage.unlock.value);
      if (!Number.isInteger(value)) {
        return;
      }
      const key = nodeKey(type, value);
      const node = grouped.get(key) ?? {
        key,
        type,
        value,
        label: nodeLabel(type, value),
        facilities: [],
      };
      if (!node.facilities.includes(chain.room as RoomKey)) {
        node.facilities.push(chain.room as RoomKey);
      }
      grouped.set(key, node);
    });
  });
  return [...grouped.values()].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "elite" ? -1 : 1;
    }
    return left.value - right.value;
  });
}

function meetsNode(
  entry: Pick<OperatorProgressionEntry, "elite" | "level">,
  node: OperatorProgressionNode,
): boolean {
  return node.type === "elite"
    ? entry.elite >= node.value
    : entry.level >= node.value;
}

function meetsAllNodes(
  entry: Pick<OperatorProgressionEntry, "elite" | "level">,
  nodes: OperatorProgressionNode[],
): boolean {
  return nodes.every((node) => meetsNode(entry, node));
}

export function minimumProgressionForNodes(
  nodes: OperatorProgressionNode[],
): Pick<OperatorProgressionEntry, "elite" | "level"> {
  if (nodes.length === 0) {
    return { elite: 0, level: 0 };
  }

  const eliteNodes = nodes.filter((node) => node.type === "elite");
  const levelNodes = nodes.filter((node) => node.type === "level");
  const elite = clampElite(
    Math.max(0, ...eliteNodes.map((node) => node.value)),
  );
  const level = Math.max(1, ...levelNodes.map((node) => node.value));
  return { elite, level };
}

export function maximumProgressionForFacility(
  operatorSkillFile: OperatorSkillFile | undefined,
  facility: RoomKey,
  maxEliteLevel: EliteLevel = 0,
): Pick<OperatorProgressionEntry, "elite" | "level"> {
  if (facility === "meeting") {
    return { elite: maxEliteLevel, level: 1 };
  }
  if (NON_WORK_ROOMS.has(facility)) {
    return { elite: 0, level: 0 };
  }
  const nodes = progressionNodes(operatorSkillFile).filter((node) =>
    node.facilities.includes(facility),
  );
  return minimumProgressionForNodes(nodes);
}

export function highestEliteLevel(
  operatorSkillFile: OperatorSkillFile | undefined,
): EliteLevel {
  const nodes = progressionNodes(operatorSkillFile).filter(
    (node) => node.type === "elite",
  );
  return clampElite(Math.max(0, ...nodes.map((node) => node.value)));
}

export function resolveOperatorProgression(
  input: OperatorProgressionResolverInput,
): ResolvedOperatorProgression {
  const profileEntry = input.profile?.entries[input.operatorId];
  const defaultProgression = maximumProgressionForFacility(
    input.operatorSkillFile,
    input.facility,
    input.maxEliteLevel,
  );
  const manualElite =
    input.manualElite === undefined ? undefined : clampElite(input.manualElite);
  const manualLevel =
    input.manualLevel === undefined ? undefined : clampLevel(input.manualLevel);
  const hasManual = manualElite !== undefined || manualLevel !== undefined;
  const sourceElite = profileEntry?.elite ?? defaultProgression.elite;
  const sourceLevel = profileEntry?.level ?? defaultProgression.level;
  const base = {
    elite: manualElite ?? sourceElite,
    level: manualLevel ?? sourceLevel,
    owned: profileEntry?.owned ?? !input.profile,
  };

  if (input.treatSkillsAsUnlocked) {
    const maximum = maximumProgressionForFacility(
      input.operatorSkillFile,
      input.facility,
      input.maxEliteLevel,
    );
    return {
      elite: Math.max(base.elite, maximum.elite) as EliteLevel,
      level: Math.max(base.level, maximum.level),
      owned: base.owned,
      upgraded: base.elite < maximum.elite || base.level < maximum.level,
    };
  }

  if (profileEntry && !profileEntry.owned && !hasManual) {
    return {
      ...defaultProgression,
      owned: false,
      upgraded: true,
    };
  }

  return {
    ...base,
    upgraded: !hasManual && !profileEntry,
  };
}

export function nodesForOperator(
  operatorSkillFile: OperatorSkillFile | undefined,
): OperatorProgressionNode[] {
  return progressionNodes(operatorSkillFile);
}

export function entryHasNode(
  entry: Pick<OperatorProgressionEntry, "elite" | "level">,
  node: OperatorProgressionNode,
): boolean {
  return meetsNode(entry, node);
}

export function entryUnlocksFacility(
  entry: Pick<OperatorProgressionEntry, "elite" | "level">,
  operatorSkillFile: OperatorSkillFile | undefined,
  facility: RoomKey,
): boolean {
  const nodes = progressionNodes(operatorSkillFile).filter((node) =>
    node.facilities.includes(facility),
  );
  return meetsAllNodes(entry, nodes);
}
