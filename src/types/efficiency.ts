import type { RoomKey, ScheduleDocument } from '@/types/schedule'

export type EfficiencyStat =
  | 'tradeSpd'
  | 'tradeNetEff'
  | 'manuProd'
  | 'clueSpeed'
  | 'clueChance'
  | 'hireSpd'
  | 'droneCharge'
  | 'orderLimit'
  | 'storageCap'
  | 'moodRecover'
  | 'moodCost'
  | 'facilityCount'
  | 'basePointGain'
  | 'basePointConvert'
  | 'tradeOrder'
  | 'zeroOpMood'
  | 'zeroOpBonus'
  | 'facBase'
  | 'abyssalBoost'
  | 'moodSwap'
  | 'skillTagConvert'

export type EfficiencyPerSource =
  | 'basePoint'
  | 'baseFacilityWithGroup'
  | 'facilityCount'
  | 'facilityLevel'
  | 'facilityLevelTotal'
  | 'ownLevel'
  | 'trainLevel'
  | 'dormLevel'
  | 'dormHere'
  | 'dormOccupants'
  | 'dormOccupantsOwn'
  | 'dormNotFull'
  | 'recruitSlots'
  | 'opCount'
  | 'opGroupInBase'
  | 'opGroupInFacility'
  | 'skillOwners'
  | 'skillTagCount'
  | 'stat'
  | 'facCap'
  | 'capTier'
  | 'manuRecipes'
  | 'moodDrop'
  | 'orderCount'
  | 'orderLimitNet'
  | 'droneLimit'
  | 'abyssalBoost'

export interface EfficiencyPer {
  per: number
  value: number
  cap?: number
  capUnit?: 'count' | 'value'
  source: EfficiencyPerSource | string
  group?: string
  term?: string
  tag?: string
  stat?: string
  facility?: RoomKey | 'same'
  other?: boolean
  exclude?: RoomKey[]
  floor?: boolean
  moodCheck?: boolean
  fullMood?: boolean
  tiers?: Array<{ cap?: number; value: number }>
  [key: string]: unknown
}

export interface EfficiencyCurve {
  type: 'ramp' | string
  startValue: number
  startHours: number
  step: number
  cap: number
  [key: string]: unknown
}

export type ComparisonOperator = 'ge' | 'gt' | 'le' | 'lt'

export interface EfficiencyCondition {
  type: string
  op?: string
  facility?: RoomKey | 'same'
  facilities?: RoomKey[]
  group?: string
  term?: string
  a?: string | number
  b?: string | number
  min?: number
  value?: number
  stat?: string
  assist?: boolean
  other?: boolean
  moodCheck?: boolean
  fullMood?: boolean
  exclude?: RoomKey[]
  negate?: boolean
  [key: string]: unknown
}

export interface EfficiencyOrderRule {
  type: 'fixed' | 'fixValues' | 'tailor' | 'breach' | 'invest' | string
  orderName?: string
  qty?: number
  material?: string | null
  amount?: number
  time?: number
  priority?: number
  ignoreEff?: boolean
  level?: 'α' | 'β' | string
  [key: string]: unknown
}

export interface EfficiencyEffect {
  target: RoomKey | 'any' | string
  stat: EfficiencyStat | string
  value?: number
  per?: EfficiencyPer
  curve?: EfficiencyCurve
  condition?: EfficiencyCondition
  facilities?: RoomKey[]
  scope?: 'self' | 'room' | 'op' | string
  op?: string
  scopeGroup?: string
  subjects?: 'single' | 'spread' | string
  other?: boolean
  stack?: 'max' | string
  maxGroup?: string
  baseValue?: number
  recipe?: string
  term?: string
  from?: string
  to?: string
  rate?: number
  order?: EfficiencyOrderRule
  group?: string
  except?: string[]
  self?: boolean
  tagFrom?: string[]
  tagTo?: string
  text?: string
  suppresses?: string[]
  [key: string]: unknown
}

export interface EfficiencySkillStage {
  unlock: { type: 'elite' | 'level' | string; value: number }
  name: string
  effects: EfficiencyEffect[]
  [key: string]: unknown
}

export interface EfficiencySkillChain {
  slot: number
  room: RoomKey | string
  stages: EfficiencySkillStage[]
  [key: string]: unknown
}

export interface OperatorSkillFile {
  id: string
  name: string
  chains: EfficiencySkillChain[]
}

export interface EfficiencyOperator {
  id: string
  name: string
  rarity: number
  termKeys: string[]
  skillFile?: OperatorSkillFile
  skillNames?: string[]
}

export interface EfficiencyTerm {
  name?: string
  members?: string[]
  definition?: string
}

export interface EfficiencyCatalog {
  operators: Record<string, EfficiencyOperator>
  terms: Record<string, EfficiencyTerm>
}

export interface EfficiencyFacility {
  id: string
  type: RoomKey
  level: number
  index: number
}

export interface FacilityAttributeValue {
  base: number
  skill: number
  total: number
}

export interface FacilityAttributes {
  orderLimit?: FacilityAttributeValue
  storageCap?: FacilityAttributeValue
}

export interface ProductionValue {
  product: string
  amountPerHour: number
  amountPerDay: number
  materialPerHour?: Record<string, number>
}

export interface OperatorEfficiencyDetail {
  operator: string
  skill?: string
  stat: string
  value: number
  facility: RoomKey
}

export interface FacilityEfficiencyResult {
  facility: EfficiencyFacility
  baseEfficiency: number
  operatorEfficiency: number
  skillEfficiency: number
  efficiency: number
  attributes: FacilityAttributes
  production?: ProductionValue
  details: OperatorEfficiencyDetail[]
}

export interface MoodSnapshot {
  operator: string
  facility: RoomKey
  start: number
  end: number
  costRate: number
  working: boolean
}

export interface EfficiencyPlanResult {
  name: string
  durationHours: number
  facilities: FacilityEfficiencyResult[]
  moods: MoodSnapshot[]
  basePoints: Record<string, number>
  warnings: string[]
}

export interface EfficiencyResult {
  document: ScheduleDocument
  plans: EfficiencyPlanResult[]
  dailyHours: number
  dailyFacilities: FacilityEfficiencyResult[]
  warnings: string[]
}
