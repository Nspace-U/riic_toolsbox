import type { BaseSkillTerms, Operator } from "@/types/baseData";
import type {
  EfficiencyCatalog,
  EfficiencyOperator,
  EfficiencyTerm,
  OperatorSkillFile,
} from "@/types/efficiency";

function membersFromDefinition(definition: string | undefined): string[] {
  if (!definition) {
    return [];
  }
  const body = definition.split(/\r?\n/).slice(1).join("");
  return body
    .split(/[、,，]/)
    .map((member) => member.trim())
    .filter(Boolean);
}

function normalizeTerms(
  terms: BaseSkillTerms | Record<string, EfficiencyTerm>,
): Record<string, EfficiencyTerm> {
  return Object.fromEntries(
    Object.entries(terms).map(([key, term]) => [
      key,
      {
        ...term,
        members: term.members?.length
          ? [...term.members]
          : membersFromDefinition(term.definition),
      },
    ]),
  );
}

function skillNames(file: OperatorSkillFile | undefined): string[] {
  if (!file) {
    return [];
  }
  return file.chains.flatMap((chain) =>
    chain.stages.map((stage) => stage.name),
  );
}

export function createEfficiencyCatalog(
  operators: readonly Operator[],
  skillFiles: Partial<Record<string, OperatorSkillFile>>,
  terms: BaseSkillTerms | Record<string, EfficiencyTerm> = {},
): EfficiencyCatalog {
  const byName: Record<string, EfficiencyOperator> = {};
  operators.forEach((operator) => {
    const skillFile = skillFiles[operator.id];
    byName[operator.name] = {
      id: operator.id,
      name: operator.name,
      rarity: operator.rarity,
      termKeys: operator.termReferences.map((reference) => reference.key),
      skillFile,
      skillNames: skillNames(skillFile),
    };
  });
  return { operators: byName, terms: normalizeTerms(terms) };
}

export async function loadEfficiencyCatalog(
  operators: readonly Operator[],
  terms: BaseSkillTerms | Record<string, EfficiencyTerm> = {},
  baseUrl: string = import.meta.env.BASE_URL,
): Promise<EfficiencyCatalog> {
  const skillEntries = await Promise.all(
    operators.map(async (operator) => {
      try {
        const response = await fetch(
          `${baseUrl}assets/operator-skills/${operator.id}.json`,
        );
        if (!response.ok) {
          return [operator.id, undefined] as const;
        }
        return [
          operator.id,
          (await response.json()) as OperatorSkillFile,
        ] as const;
      } catch {
        return [operator.id, undefined] as const;
      }
    }),
  );
  return createEfficiencyCatalog(
    operators,
    Object.fromEntries(skillEntries),
    terms,
  );
}

export function catalogOperator(
  catalog: EfficiencyCatalog,
  name: string,
): EfficiencyOperator | undefined {
  return catalog.operators[name];
}

export function groupMembers(
  catalog: EfficiencyCatalog,
  group: string | undefined,
): string[] {
  if (!group) {
    return [];
  }
  const members = catalog.terms[group]?.members ?? [];
  if (members.length > 0) {
    return members;
  }
  return Object.values(catalog.operators)
    .filter((operator) => operator.termKeys.includes(group))
    .map((operator) => operator.name);
}

export function hasGroupMember(
  catalog: EfficiencyCatalog,
  group: string | undefined,
  name: string,
): boolean {
  return groupMembers(catalog, group).includes(name);
}
