export type EliteLevel = 0 | 1 | 2

export interface OperatorAvatars {
  elite0: string
  elite1: string
  elite2: string
}

export interface OperatorSkill {
  slot: string
  unlockCondition: string
  name: string
  replacement: string
  skillChain: string
  facility: string
  iconFile: string
  iconStatus: string
  description: string
}

export interface Operator {
  id: string
  name: string
  implementationDate?: string
  implementationOrder?: number
  profession: string
  branch: string
  rarity: number
  avatars: OperatorAvatars
  skills: OperatorSkill[]
}

export interface BaseSkillTerm {
  name: string
  definition: string
  members: string[]
}

export type BaseSkillTerms = Record<string, BaseSkillTerm>

export interface BaseDataMetadata {
  versionId: number
  source: string
  sourceUrl: string
  clientVersion: string
  resVersion: string
  syncedAt: string
  missingAvatars?: string[]
}

export interface BaseData {
  operators: Operator[]
  terms: BaseSkillTerms
  metadata?: BaseDataMetadata
}
