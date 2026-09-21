import type {
  EfficiencyCatalog,
  EfficiencyOperator,
  EfficiencyTerm,
  OperatorSkillFile,
} from "../../types/efficiency";

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
  terms: Record<string, EfficiencyTerm>,
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
  files: readonly OperatorSkillFile[],
  terms: Record<string, EfficiencyTerm>,
): EfficiencyCatalog {
  const byName: Record<string, EfficiencyOperator> = {};
  files.forEach((skillFile) => {
    byName[skillFile.name] = {
      id: skillFile.id,
      name: skillFile.name,
      maxEliteLevel: maxEliteLevelForRarity(skillFile.rarity ?? 0),
      rarity: skillFile.rarity ?? 0,
      skillFile,
      skillNames: skillNames(skillFile),
    };
  });
  return {
    operators: byName,
    terms: normalizeTerms(terms),
  };
}

function maxEliteLevelForRarity(rarity: number): 0 | 1 | 2 {
  return rarity >= 4 ? 2 : rarity === 3 ? 1 : 0;
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
  return members;
}

export function hasGroupMember(
  catalog: EfficiencyCatalog,
  group: string | undefined,
  name: string,
): boolean {
  return groupMembers(catalog, group).includes(name);
}
