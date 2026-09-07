import type { BaseSkillTerm, BaseSkillTerms, Operator, OperatorSkill } from '@/types/baseData'

export function getOperatorSkillTermKeys(skills: OperatorSkill[]): string[] {
  return [...new Set(skills.flatMap((skill) => {
    return [...skill.description.matchAll(/\[T=([^\]]+)\][\s\S]*?\[\/T\]/g)].map((match) => match[1] ?? '')
  }))]
}

export function getOperatorTerms(
  operator: Operator,
  terms: BaseSkillTerms,
): Array<[string, BaseSkillTerm]> {
  const termEntries = new Map<string, BaseSkillTerm>()
  getOperatorSkillTermKeys(operator.skills).forEach((key) => {
    const term = terms[key]
    if (term) {
      termEntries.set(key, term)
    }
  })

  Object.entries(terms).forEach(([key, term]) => {
    if (term.members.includes(operator.name) && !termEntries.has(key)) {
      termEntries.set(key, term)
    }
  })

  return [...termEntries.entries()]
}
