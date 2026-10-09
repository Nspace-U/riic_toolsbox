import type { OperatorProgressionProfile } from "./operatorProgression";

export const ROOM_KEYS = [
  "control",
  "trading",
  "manufacture",
  "power",
  "meeting",
  "hire",
  "processing",
  "training",
  "recycle",
  "dormitory",
] as const;

export type RoomKey = (typeof ROOM_KEYS)[number];

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface LayoutEntry {
  type: RoomKey;
  level: number;
  [key: string]: unknown;
}

export interface OperatorState {
  mood?: number;
  elite?: number;
  level?: number;
  [key: string]: unknown;
}

export interface RoomAssignment {
  operators?: string[];
  runOrderOperators?: string[];
  skip?: boolean;
  product?: string;
  sourceMaterial?: string;
  operatorStates?: Record<string, OperatorState>;
  [key: string]: unknown;
}

export type DroneOrder = "pre" | "post";

export interface PlanDrones {
  enable?: boolean;
  room?: "trading" | "manufacture";
  index?: number;
  rule?: string;
  order?: DroneOrder;
  [key: string]: unknown;
}

export interface PlanSettings {
  period?: string[][];
  [key: string]: unknown;
}

export interface Rooms {
  [roomKey: string]: RoomAssignment[] | unknown;
}

export interface Plan {
  name?: string;
  description?: string;
  description_post?: string;
  period?: string[][];
  duration?: number;
  settings?: PlanSettings;
  drones?: PlanDrones;
  rooms: Rooms;
  [key: string]: unknown;
}

export type OverflowMode = "continue" | "zero";
export type FiammettaMode = "queue" | "direct";

export interface FiammettaScheduleState {
  queue?: RoomAssignment[];
  direct?: RoomAssignment;
}

export interface ScheduleSettings {
  clueExchanging?: boolean;
  dormFullTreat?: boolean;
  fiammettaMode?: FiammettaMode;
  fiammettaDirectCount?: number;
  preferMaxJieEfficiency?: boolean;
  lmdDroneStrategy?: string;
  tradeOrderCount?: Record<string, number>;
  overflowMode?: OverflowMode;
  droneOverflowMode?: OverflowMode;
  firstItemProgress?: number | Record<string, number>;
  progressionProfile?: OperatorProgressionProfile;
  treatSkillsAsUnlocked?: boolean;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
  runOrderEnabled?: boolean;
  recycleBoostItemId?: string;
}

export interface ScheduleDocument {
  title?: string;
  description?: string;
  layout: LayoutEntry[];
  plans: Plan[];
  fiammetta?: FiammettaScheduleState;
  settings?: ScheduleSettings;
  [key: string]: unknown;
}

export interface ParsedSchedule {
  document: ScheduleDocument;
  inferredLayout: boolean;
}

export interface StoredDocument {
  id: string;
  document: ScheduleDocument;
  inferredLayout: boolean;
  sourceFileName: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  hiddenAutoTags?: string[];
}

export interface ResolvedRoomAssignment {
  assignment: RoomAssignment;
  inherited: boolean;
  sourcePlanIndex?: number;
}
