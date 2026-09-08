export const ROOM_KEYS = [
  'control',
  'trading',
  'manufacture',
  'power',
  'meeting',
  'hire',
  'dormitory',
  'processing',
  'training',
] as const

export type RoomKey = (typeof ROOM_KEYS)[number]

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface LayoutEntry {
  type: RoomKey
  level: number
  [key: string]: unknown
}

export interface OperatorState {
  mood?: number
  elite?: number
  [key: string]: unknown
}

export interface RoomAssignment {
  operators?: string[]
  skip?: boolean
  product?: string
  sourceMaterial?: string
  operatorStates?: Record<string, OperatorState>
  [key: string]: unknown
}

export interface Rooms {
  [roomKey: string]: RoomAssignment[] | unknown
}

export interface Plan {
  name?: string
  description?: string
  description_post?: string
  period?: string[][]
  duration?: number
  rooms: Rooms
  [key: string]: unknown
}

export interface ScheduleDocument {
  title?: string
  description?: string
  layout: LayoutEntry[]
  plans: Plan[]
  [key: string]: unknown
}

export interface ParsedSchedule {
  document: ScheduleDocument
  inferredLayout: boolean
}

export interface StoredDocument {
  id: string
  document: ScheduleDocument
  inferredLayout: boolean
  sourceFileName: string
  createdAt: string
  updatedAt: string
}
