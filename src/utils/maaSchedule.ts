import {
  MAA_ROOM_KEYS,
  type MaaJsonValue,
  type MaaLayoutEntry,
  type MaaPlan,
  type MaaRoomAssignment,
  type MaaRoomKey,
  type MaaScheduleDocument,
  type ParsedMaaSchedule,
} from '@/types/maaSchedule'

export const MAA_ROOM_LABELS: Record<MaaRoomKey, string> = {
  control: '控制中枢',
  trading: '贸易站',
  manufacture: '制造站',
  power: '发电站',
  meeting: '会客室',
  hire: '办公室',
  dormitory: '宿舍',
  processing: '加工站',
  training: '训练室',
}

export const MAA_ROOM_ORDER: MaaRoomKey[] = [...MAA_ROOM_KEYS]

export const MAA_PRODUCT_LABELS: Record<string, string> = {
  LMD: '龙门币',
  Orundum: '合成玉',
  'Pure Gold': '赤金',
  'Battle Record': '作战记录',
  'Originium Shard': '源石碎片',
}

export const MAA_UNSUPPORTED_PRODUCT_LABELS: Record<string, string> = {
  Dualchip: '双芯片（仅保留，不参与本工具制造计算）',
}

export const DEFAULT_MAA_SOURCE_MATERIAL = '固源岩'

export const MAA_PRODUCT_OPTIONS = Object.entries(MAA_PRODUCT_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export const MAA_SOURCE_MATERIAL_OPTIONS = [
  { value: '固源岩', label: '固源岩' },
  { value: '装置', label: '装置' },
]

const ROOM_KEY_SET = new Set<string>(MAA_ROOM_KEYS)

export class MaaScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaaScheduleError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function fail(path: string, message: string): never {
  throw new MaaScheduleError(`${path}：${message}`)
}

function isMaaRoomKey(value: unknown): value is MaaRoomKey {
  return typeof value === 'string' && ROOM_KEY_SET.has(value)
}

function levelRange(type: MaaRoomKey): { min: number; max: number } {
  return type === 'control' || type === 'dormitory'
    ? { min: 1, max: 5 }
    : { min: 1, max: 3 }
}

export function roomSlotCount(type: MaaRoomKey, level: number): number {
  if (type === 'control' || type === 'trading' || type === 'manufacture') {
    return level
  }
  if (type === 'power' || type === 'hire' || type === 'processing') {
    return 1
  }
  if (type === 'meeting' || type === 'training') {
    return 2
  }
  return 5
}

function validateLayout(layout: unknown): MaaLayoutEntry[] {
  if (!Array.isArray(layout)) {
    fail('layout', '必须是数组')
  }
  if (layout.length === 0) {
    fail('layout', '至少需要一个设施')
  }

  return layout.map((entry, index) => {
    if (!isRecord(entry)) {
      fail(`layout[${index}]`, '必须是对象')
    }
    if (!isMaaRoomKey(entry.type)) {
      fail(`layout[${index}].type`, '不是支持的设施类型')
    }
    if (typeof entry.level !== 'number' || !Number.isInteger(entry.level)) {
      fail(`layout[${index}].level`, '必须是整数')
    }
    const range = levelRange(entry.type)
    if (entry.level < range.min || entry.level > range.max) {
      fail(`layout[${index}].level`, `必须在 ${range.min} 到 ${range.max} 之间`)
    }
    return entry as MaaLayoutEntry
  })
}

function validateOperators(room: MaaRoomAssignment, path: string): string[] {
  if (!hasOwn(room, 'operators')) {
    return []
  }
  if (!Array.isArray(room.operators)) {
    fail(`${path}.operators`, '必须是干员名称字符串数组')
  }

  const names = room.operators.map((operator, index) => {
    if (typeof operator !== 'string' || !operator.trim()) {
      fail(`${path}.operators[${index}]`, '必须是非空字符串')
    }
    return operator
  })
  if (new Set(names).size !== names.length) {
    fail(`${path}.operators`, '同一房间中不能重复出现同名干员')
  }
  return names
}

function validateRoomCapacity(
  room: MaaRoomAssignment,
  type: MaaRoomKey,
  level: number,
  path: string,
): void {
  const names = room.operators ?? []
  const capacity = roomSlotCount(type, level)
  if (names.length > capacity) {
    fail(`${path}.operators`, `超过该设施 ${capacity} 个槽位上限`)
  }
}

function validateOperatorStates(room: MaaRoomAssignment, names: string[], path: string): void {
  if (!hasOwn(room, 'operatorStates')) {
    return
  }
  if (!isRecord(room.operatorStates)) {
    fail(`${path}.operatorStates`, '必须是对象')
  }

  Object.entries(room.operatorStates).forEach(([name, state]) => {
    if (!names.includes(name)) {
      fail(`${path}.operatorStates.${name}`, '该干员不在同一房间的 operators 中')
    }
    if (!isRecord(state)) {
      fail(`${path}.operatorStates.${name}`, '必须是对象')
    }
    if (hasOwn(state, 'mood')) {
      if (typeof state.mood !== 'number' || !Number.isFinite(state.mood) || state.mood < 0 || state.mood > 24) {
        fail(`${path}.operatorStates.${name}.mood`, '必须是 0 到 24 之间的数字')
      }
    }
    if (hasOwn(state, 'elite')) {
      if (typeof state.elite !== 'number' || !Number.isInteger(state.elite) || state.elite < 0 || state.elite > 2) {
        fail(`${path}.operatorStates.${name}.elite`, '必须是 0 到 2 之间的整数')
      }
    }
  })
}

function validateRoom(room: unknown, type: MaaRoomKey, index: number, planIndex: number): MaaRoomAssignment {
  const path = `plans[${planIndex}].rooms.${type}[${index}]`
  if (!isRecord(room)) {
    fail(path, '必须是对象')
  }
  if (hasOwn(room, 'skip') && typeof room.skip !== 'boolean') {
    fail(`${path}.skip`, '必须是布尔值')
  }
  if (hasOwn(room, 'product') && (typeof room.product !== 'string' || !room.product.trim())) {
    fail(`${path}.product`, '必须是非空字符串')
  }
  if (hasOwn(room, 'sourceMaterial') && typeof room.sourceMaterial !== 'string') {
    fail(`${path}.sourceMaterial`, '必须是字符串')
  }
  const names = validateOperators(room as MaaRoomAssignment, path)
  validateOperatorStates(room as MaaRoomAssignment, names, path)
  return room as MaaRoomAssignment
}

function validatePlan(plan: unknown, index: number, layout: MaaLayoutEntry[] | undefined): MaaPlan {
  const path = `plans[${index}]`
  if (!isRecord(plan)) {
    fail(path, '必须是对象')
  }
  if (!isRecord(plan.rooms)) {
    fail(`${path}.rooms`, '必须是对象')
  }

  const rooms = plan.rooms
  const operatorsInPlan = new Map<string, string>()
  MAA_ROOM_KEYS.forEach((type) => {
    const rawRooms = rooms[type]
    if (rawRooms !== undefined && !Array.isArray(rawRooms)) {
      fail(`${path}.rooms.${type}`, '必须是数组')
    }
    const roomList = Array.isArray(rawRooms) ? rawRooms : []
    roomList.forEach((room, roomIndex) => {
      const validatedRoom = validateRoom(room, type, roomIndex, index)
      const roomPath = `${path}.rooms.${type}[${roomIndex}]`
      if (layout) {
        const layoutEntry = layout.filter((entry) => entry.type === type)[roomIndex]
        if (layoutEntry) {
          validateRoomCapacity(validatedRoom, type, layoutEntry.level, roomPath)
        }
      }
      ;(validatedRoom.operators ?? []).forEach((operator) => {
        const previousRoom = operatorsInPlan.get(operator)
        if (previousRoom) {
          fail(`${path}.rooms.${type}[${roomIndex}].operators`, `干员“${operator}”已在 ${previousRoom} 中配置，同一队列不能重复`)
        }
        operatorsInPlan.set(operator, roomPath)
      })
    })
  })
  return plan as MaaPlan
}

function clampLevel(type: MaaRoomKey, level: number): number {
  const range = levelRange(type)
  return Math.max(range.min, Math.min(range.max, Math.round(level)))
}

function maxOperatorsForRoom(plans: MaaPlan[], type: MaaRoomKey, position: number): number {
  let max = 0
  plans.forEach((plan) => {
    const rooms = plan.rooms[type]
    if (!Array.isArray(rooms)) {
      return
    }
    const room = rooms[position]
    if (isRecord(room) && Array.isArray(room.operators)) {
      max = Math.max(max, room.operators.length)
    }
  })
  return max
}

function inferLayout(plans: MaaPlan[]): MaaLayoutEntry[] {
  const layout: MaaLayoutEntry[] = []
  MAA_ROOM_ORDER.forEach((type) => {
    const maxLength = plans.reduce((max, plan) => {
      const rooms = plan.rooms[type]
      return Array.isArray(rooms) ? Math.max(max, rooms.length) : max
    }, 0)
    if (maxLength === 0) {
      return
    }

    const count = type === 'power'
      ? Math.max(maxLength, plans.reduce((max, plan) => {
        const rooms = plan.rooms[type]
        if (!Array.isArray(rooms)) {
          return max
        }
        const operatorCount = rooms.reduce((total, room) => {
          return total + (isRecord(room) && Array.isArray(room.operators) ? room.operators.length : 0)
        }, 0)
        return Math.max(max, operatorCount)
      }, 0))
      : maxLength

    for (let position = 0; position < count; position += 1) {
      const inferredLevel = type === 'control'
        ? maxOperatorsForRoom(plans, type, 0) || 1
        : type === 'trading' || type === 'manufacture'
          ? maxOperatorsForRoom(plans, type, position) || 3
          : type === 'dormitory'
            ? 5
            : 3
      layout.push({ type, level: clampLevel(type, inferredLevel) })
    }
  })
  return layout
}

function completeInferredRooms(plans: MaaPlan[], layout: MaaLayoutEntry[]): MaaPlan[] {
  return plans.map((plan) => {
    const rooms = { ...plan.rooms }
    MAA_ROOM_KEYS.forEach((type) => {
      const expected = layout.filter((entry) => entry.type === type).length
      if (expected === 0) {
        return
      }
      const existing = Array.isArray(rooms[type]) ? [...rooms[type]] : []
      if (type === 'power' && existing.length === 1) {
        const mergedRoom = existing[0]
        if (isRecord(mergedRoom) && Array.isArray(mergedRoom.operators) && mergedRoom.operators.length > 1) {
          const typedRoom = mergedRoom as MaaRoomAssignment
          const operators = typedRoom.operators ?? []
          const operatorStates = typedRoom.operatorStates
          const roomMeta = { ...typedRoom }
          delete roomMeta.operators
          delete roomMeta.operatorStates
          rooms[type] = operators.map((operator) => ({
            ...roomMeta,
            operators: [operator],
            ...(operatorStates?.[operator]
              ? { operatorStates: { [operator]: operatorStates[operator] } }
              : {}),
          }))
          return
        }
      }
      while (existing.length < expected) {
        existing.push({ skip: true })
      }
      rooms[type] = existing
    })
    return { ...plan, rooms }
  })
}

function applyDocumentDefaults(document: MaaScheduleDocument): void {
  document.plans.forEach((plan) => {
    const rooms = plan.rooms.manufacture
    if (!Array.isArray(rooms)) {
      return
    }
    rooms.forEach((room) => {
      if (!isRecord(room) || room.product !== 'Originium Shard') {
        return
      }
      if (!hasOwn(room, 'sourceMaterial') || room.sourceMaterial === '') {
        room.sourceMaterial = DEFAULT_MAA_SOURCE_MATERIAL
      }
    })
  })
}

function parseRoot(value: unknown): Record<string, unknown> & { plans: unknown[] } {
  if (!isRecord(value)) {
    throw new MaaScheduleError('JSON 根节点必须是对象')
  }
  if (!Array.isArray(value.plans) || value.plans.length === 0) {
    throw new MaaScheduleError('缺少非空 plans 数组')
  }
  return value as Record<string, unknown> & { plans: unknown[] }
}

export function parseMaaScheduleText(text: string): ParsedMaaSchedule {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as MaaJsonValue
  } catch {
    throw new MaaScheduleError('文件不是有效的严格 JSON，不支持 JSONC 注释')
  }

  const root = parseRoot(parsed)
  const hasLayout = hasOwn(root, 'layout')
  const layout = hasLayout ? validateLayout(root.layout) : undefined
  const plans = root.plans.map((plan, index) => validatePlan(plan, index, layout))
  const resolvedLayout = layout ?? inferLayout(plans)
  if (resolvedLayout.length === 0) {
    fail('layout', '无法从 plans 推断出设施布局')
  }
  const resolvedPlans = hasLayout ? plans : completeInferredRooms(plans, resolvedLayout)
  resolvedPlans.forEach((plan, index) => validatePlan(plan, index, resolvedLayout))
  const { plans: _plans, layout: _layout, ...rest } = root
  const document: MaaScheduleDocument = {
    ...rest,
    layout: resolvedLayout,
    plans: resolvedPlans,
  }
  applyDocumentDefaults(document)
  return { document, inferredLayout: !hasLayout }
}

export function validateMaaSchedule(document: MaaScheduleDocument): void {
  if (!isRecord(document)) {
    throw new MaaScheduleError('文档根节点必须是对象')
  }
  validateLayout(document.layout)
  if (!Array.isArray(document.plans) || document.plans.length === 0) {
    throw new MaaScheduleError('缺少非空 plans 数组')
  }
  document.plans.forEach((plan, index) => validatePlan(plan, index, document.layout))
}

export function serializeMaaSchedule(document: MaaScheduleDocument): string {
  validateMaaSchedule(document)
  const normalized = cloneMaaSchedule(document)
  applyDocumentDefaults(normalized)
  validateMaaSchedule(normalized)
  return JSON.stringify(normalized, null, 2)
}

export function cloneMaaSchedule(document: MaaScheduleDocument): MaaScheduleDocument {
  return JSON.parse(JSON.stringify(document)) as MaaScheduleDocument
}

export function createEmptyMaaSchedule(): MaaScheduleDocument {
  return {
    title: '新建排班表',
    description: '',
    layout: [{ type: 'control', level: 5 }],
    plans: [
      {
        name: '队列1',
        duration: 720,
        rooms: {
          control: [{ skip: true }],
        },
      },
    ],
  }
}

export function roomCount(document: MaaScheduleDocument, type: MaaRoomKey): number {
  return document.layout.filter((entry) => entry.type === type).length
}
