export const ROOM_KEYS = [
  "control",
  "trading",
  "manufacture",
  "power",
  "meeting",
  "hire",
  "processing",
  "training",
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
  skip?: boolean;
  product?: string;
  sourceMaterial?: string;
  operatorStates?: Record<string, OperatorState>;
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
  rooms: Rooms;
  [key: string]: unknown;
}

export type OverflowMode = "continue" | "zero";

export interface ScheduleSettings {
  clueExchanging?: boolean;
  dormFullTreat?: boolean;
  featherFixedOps?: string[];
  preferMaxJieEfficiency?: boolean;
  orderProgress?: Record<string, number>;
  overflowMode?: OverflowMode;
  firstItemProgress?: Record<string, number>;
}

export interface ScheduleDocument {
  title?: string;
  description?: string;
  layout: LayoutEntry[];
  plans: Plan[];
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
}
