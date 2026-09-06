import type { BaseDataMetadata, BaseSkillTerms, Operator, OperatorSkill } from '@/types/baseData'

export interface TorappuCharacter {
  name?: string
  implementationDate?: string
  branch?: string
  rarity?: string
  profession?: string
  subProfessionId?: string
  phaseCount?: number
}

export interface TorappuCondition {
  phase?: string
  level?: number
}

export interface TorappuBuffData {
  buffId?: string
  cond?: TorappuCondition
}

export interface TorappuBuildingCharacter {
  charId?: string
  buffChar?: Array<{ buffData?: TorappuBuffData[] }>
}

export interface TorappuBuff {
  buffId?: string
  buffName?: string
  skillIcon?: string
  roomType?: string
  description?: string
}

export interface TorappuCharacterTable {
  [operatorId: string]: TorappuCharacter
}

export interface TorappuBuildingData {
  chars?: Record<string, TorappuBuildingCharacter>
  buffs?: Record<string, TorappuBuff>
}

interface TorappuSkillRecord extends OperatorSkill {
  phase: number
  level: number
}

const PROFESSION_LABELS: Record<string, string> = {
  CASTER: '术师',
  MEDIC: '医疗',
  PIONEER: '先锋',
  SNIPER: '狙击',
  SPECIAL: '特种',
  SUPPORT: '辅助',
  TANK: '重装',
  WARRIOR: '近卫',
}

const FACILITY_LABELS: Record<string, string> = {
  CONTROL: '控制中枢',
  DORMITORY: '宿舍',
  HIRE: '办公室',
  MANUFACTURE: '制造站',
  MEETING: '会客室',
  POWER: '发电站',
  TRADING: '贸易站',
  TRAINING: '训练室',
  WORKSHOP: '加工站',
}

const DESCRIPTION_COLORS: Record<string, string> = {
  'cc.kw': '#00B0FF',
  'cc.rem': '#8C8C8C',
  'cc.vdown': '#FF6237',
  'cc.vup': '#0098DC',
}

function rarityValue(value: string | undefined): number {
  const match = value?.match(/\d+/)
  return match ? Number(match[0]) : 0
}

function professionLabel(value: string | undefined): string {
  return value ? (PROFESSION_LABELS[value] ?? value) : ''
}

function phaseValue(condition: TorappuCondition | undefined): number {
  const match = condition?.phase?.match(/\d+/)
  return match ? Number(match[0]) : 0
}

function conditionLevel(condition: TorappuCondition | undefined): number {
  return condition?.level ?? 1
}

function conditionLabel(condition: TorappuCondition | undefined): string {
  const phase = phaseValue(condition)
  const level = conditionLevel(condition)
  return level === 1 ? `精英${phase}` : `${level}级`
}

function normalizeDescription(description: string | undefined, terms: BaseSkillTerms): string {
  const normalizedDescription = (description ?? '').replace(/<<(?=[$@])/g, '')
  const withTermColors = normalizedDescription.replace(
    /<\$([^>]+)><@([^>]+)>([\s\S]*?)<\/><\/>/g,
    (_match: string, termTag: string, colorTag: string, text: string) => {
      const color = DESCRIPTION_COLORS[colorTag] ?? '#0098DC'
      const content = `[C=${color}]${text}[/C]`
      return terms[termTag] ? `[T=${termTag}]${content}[/T]` : content
    },
  )
  const withTerms = withTermColors.replace(
    /<\$([^>]+)>([\s\S]*?)<\/>/g,
    (_match: string, termTag: string, text: string) => (
      terms[termTag] ? `[T=${termTag}]${text}[/T]` : text
    ),
  )
  const withColors = withTerms.replace(
    /<@([^>]+)>([\s\S]*?)<\/>/g,
    (_match: string, tag: string, text: string) => {
      const color = DESCRIPTION_COLORS[tag] ?? '#0098DC'
      return `[C=${color}]${text}[/C]`
    },
  )
  return withColors
}

function avatarFileName(operatorId: string, eliteLevel: number): string {
  if (eliteLevel === 0) {
    return `${operatorId}.png`
  }
  if (eliteLevel === 1) {
    return `${operatorId}_1+.png`
  }
  return `${operatorId}_2.png`
}

function buildAvatars(
  operatorId: string,
  character: TorappuCharacter,
  missingAvatars: Set<string>,
): Operator['avatars'] {
  const phaseCount = character.phaseCount ?? 0
  const elite0 = avatarFileName(operatorId, 0)
  const elite1 = avatarFileName(operatorId, 1)
  const elite2 = avatarFileName(operatorId, 2)
  return {
    elite0: missingAvatars.has(elite0) ? '' : elite0,
    elite1: phaseCount >= 2 && !missingAvatars.has(elite1) ? elite1 : '',
    elite2: phaseCount >= 3 && !missingAvatars.has(elite2) ? elite2 : '',
  }
}

function buildReplacement(records: TorappuSkillRecord[], index: number): string {
  if (records.length === 1) {
    return records[0]?.slot === '1'
      ? '独立技能，无替换关系'
      : `独立技能（槽位${records[0]?.slot ?? '?'}技能，与其他槽位技能可同时生效）`
  }

  const current = records[index]
  const previous = records[index - 1]
  const next = records[index + 1]
  const clauses: string[] = []
  if (previous && current) {
    clauses.push(`在${current.unlockCondition}时替换「${previous.name}」`)
  }
  if (next && current) {
    clauses.push(`在${next.unlockCondition}时被「${next.name}」替换`)
  }
  return clauses.join('，')
}

function buildSkills(
  buildingCharacter: TorappuBuildingCharacter,
  buffs: Record<string, TorappuBuff>,
  terms: BaseSkillTerms,
): OperatorSkill[] {
  const skills: OperatorSkill[] = []

  for (const [slotIndex, slotData] of (buildingCharacter.buffChar ?? []).entries()) {
    const slot = String(slotIndex + 1)
    const records: TorappuSkillRecord[] = []
    for (const buffData of slotData.buffData ?? []) {
      const buffId = buffData.buffId ?? ''
      const buff = buffs[buffId]
      if (!buff) {
        continue
      }

      const unlockCondition = conditionLabel(buffData.cond)
      records.push({
        slot,
        unlockCondition,
        name: buff.buffName ?? buffId,
        replacement: '',
        skillChain: '',
        facility: FACILITY_LABELS[buff.roomType ?? ''] ?? buff.roomType ?? '',
        iconFile: buff.skillIcon ? `${buff.skillIcon}.png` : '',
        iconStatus: '正常',
        description: normalizeDescription(buff.description, terms),
        phase: phaseValue(buffData.cond),
        level: conditionLevel(buffData.cond),
      })
    }

    records.sort((left, right) => left.phase - right.phase || left.level - right.level)
    const skillChain = records.map((record) => `${record.name}(${record.unlockCondition})`).join(' → ')
    records.forEach((record, index) => {
      record.replacement = buildReplacement(records, index)
      record.skillChain = skillChain
      const { phase: _phase, level: _level, ...skill } = record
      skills.push(skill)
    })
  }

  return skills
}

export function parseTorappuData(
  characterTable: TorappuCharacterTable,
  buildingData: TorappuBuildingData,
  legacyOperators: Operator[],
  terms: BaseSkillTerms,
  metadata: BaseDataMetadata,
): Operator[] {
  const buildingCharacters = buildingData.chars ?? {}
  const buffs = buildingData.buffs ?? {}
  const legacyById = new Map(legacyOperators.map((operator) => [operator.id, operator]))
  const missingAvatars = new Set(metadata.missingAvatars ?? [])
  const operators: Operator[] = []

  for (const [operatorId, buildingCharacter] of Object.entries(buildingCharacters)) {
    if (!operatorId.startsWith('char_')) {
      continue
    }
    const character = characterTable[operatorId]
    if (!character?.name) {
      continue
    }

    const legacyOperator = legacyById.get(operatorId)
    operators.push({
      id: operatorId,
      name: character.name,
      implementationDate: character.implementationDate,
      profession: professionLabel(character.profession),
      branch: character.branch ?? legacyOperator?.branch ?? character.subProfessionId ?? '',
      rarity: rarityValue(character.rarity),
      avatars: buildAvatars(operatorId, character, missingAvatars),
      skills: buildSkills(buildingCharacter, buffs, terms),
    })
  }

  return operators
}
