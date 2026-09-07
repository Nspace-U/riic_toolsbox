import type {
  Operator,
  OperatorSkill,
  SkillTermReference,
} from '@/types/baseData'

export function getOperatorSkillTermKeys(skills: OperatorSkill[]): string[] {
  return [...new Set(skills.flatMap((skill) => skill.termReferences.map((reference) => reference.key)))]
}

export function getOperatorTerms(
  operator: Operator,
): SkillTermReference[] {
  const termEntries = new Map<string, SkillTermReference>()
  operator.skills.flatMap((skill) => skill.termReferences).forEach((reference) => {
    termEntries.set(reference.key, reference)
  })

  return [...termEntries.values()]
}
