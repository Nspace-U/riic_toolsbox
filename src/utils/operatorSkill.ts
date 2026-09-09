import type {
  Operator,
  OperatorSkill,
  SkillTermReference,
} from "@/types/baseData";

const ALTER_TERM: SkillTermReference = { key: "cc.g.sp", name: "异格" };

export function getOperatorSkillTermKeys(skills: OperatorSkill[]): string[] {
  return [
    ...new Set(
      skills.flatMap((skill) =>
        skill.termReferences.map((reference) => reference.key),
      ),
    ),
  ];
}

export function getOperatorTerms(operator: Operator): SkillTermReference[] {
  const termEntries = new Map<string, SkillTermReference>();
  const addTerm = (reference: SkillTermReference): void => {
    if (!termEntries.has(reference.name)) {
      termEntries.set(reference.name, reference);
    }
  };
  if (operator.isSpChar) {
    addTerm(ALTER_TERM);
  }
  operator.termReferences.forEach((reference) => {
    addTerm(reference);
  });

  return [...termEntries.values()];
}
