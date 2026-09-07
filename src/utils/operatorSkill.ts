import type {
  Operator,
  OperatorSkill,
  SkillTermReference,
} from '@/types/baseData'

const ALTER_TERM: SkillTermReference = { key: 'cc.g.sp', name: '异格' }

export function getOperatorSkillTermKeys(skills: OperatorSkill[]): string[] {
  return [...new Set(skills.flatMap((skill) => skill.termReferences.map((reference) => reference.key)))]
}

export function getOperatorTerms(
  operator: Operator,
): SkillTermReference[] {
  const termEntries = new Map<string, SkillTermReference>()
  if (operator.isSpChar) {
    termEntries.set(ALTER_TERM.key, ALTER_TERM)
  }
  operator.skills.flatMap((skill) => skill.termReferences).forEach((reference) => {
    termEntries.set(reference.key, reference)
  })

  return [...termEntries.values()]
}
