export const MAA_ROOM_KEYS = [
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

export type MaaRoomKey = (typeof MAA_ROOM_KEYS)[number]

export type MaaJsonValue =
  | string
  | number
  | boolean
  | null
  | MaaJsonValue[]
  | { [key: string]: MaaJsonValue }

export interface MaaLayoutEntry {
  type: MaaRoomKey
  level: number
  [key: string]: unknown
}

export interface MaaOperatorState {
  mood?: number
  elite?: number
  [key: string]: unknown
}

export interface MaaRoomAssignment {
  operators?: string[]
  skip?: boolean
  product?: string
  sourceMaterial?: string
  operatorStates?: Record<string, MaaOperatorState>
  [key: string]: unknown
}

export interface MaaRooms {
  [roomKey: string]: MaaRoomAssignment[] | unknown
}

export interface MaaPlan {
  name?: string
  description?: string
  description_post?: string
  period?: string[][]
  duration?: number
  rooms: MaaRooms
  [key: string]: unknown
}

export interface MaaScheduleDocument {
  title?: string
  description?: string
  layout: MaaLayoutEntry[]
  plans: MaaPlan[]
  [key: string]: unknown
}

export interface ParsedMaaSchedule {
  document: MaaScheduleDocument
  inferredLayout: boolean
}

export interface StoredMaaDocument {
  id: string
  document: MaaScheduleDocument
  inferredLayout: boolean
  sourceFileName: string
  createdAt: string
  updatedAt: string
}