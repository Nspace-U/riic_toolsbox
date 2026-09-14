import type { EfficiencyCatalog } from "@/types/efficiency";

import { SPECIAL_OPERATOR_ALIASES } from "@/utils/specialOperatorAliases";

const PERCENTAGE_OPERATOR_PATTERN = /^\d+(?:\.\d+)?%$/;
const KNOWN_TERM_NAMES = new Set(["莱茵生命", "精英干员", "岁", "S.E.E.S."]);

export function percentageOperatorValue(name: string): number | undefined {
  if (!PERCENTAGE_OPERATOR_PATTERN.test(name.trim())) {
    return undefined;
  }
  return Number(name.trim().slice(0, -1));
}

export function isPercentageOperator(name: string): boolean {
  return percentageOperatorValue(name) !== undefined;
}

export function termKeysForSpecialOperator(
  name: string,
  catalog: EfficiencyCatalog,
): string[] {
  const target = SPECIAL_OPERATOR_ALIASES[name] ?? name;
  return Object.entries(catalog.terms)
    .filter(
      ([key, term]) =>
        key === target || term.name === target || term.name === name,
    )
    .map(([key]) => key);
}

export function isTermOperator(
  name: string,
  catalog: EfficiencyCatalog,
): boolean {
  return termKeysForSpecialOperator(name, catalog).length > 0;
}

export function isSpecialOperator(
  name: string,
  catalog: EfficiencyCatalog,
): boolean {
  return isPercentageOperator(name) || isTermOperator(name, catalog);
}

export function isKnownSpecialOperator(name: string): boolean {
  return (
    isPercentageOperator(name) ||
    KNOWN_TERM_NAMES.has(name) ||
    Object.prototype.hasOwnProperty.call(SPECIAL_OPERATOR_ALIASES, name)
  );
}

export function groupIncludesOperator(
  catalog: EfficiencyCatalog,
  group: string | undefined,
  name: string,
): boolean {
  if (!group) {
    return false;
  }
  const members = catalog.terms[group]?.members ?? [];
  if (members.includes(name)) {
    return true;
  }
  return termKeysForSpecialOperator(name, catalog).includes(group);
}

export function specialOperatorTermMembers(
  name: string,
  catalog: EfficiencyCatalog,
): string[] {
  const keys = termKeysForSpecialOperator(name, catalog);
  return Array.from(
    new Set(keys.flatMap((key) => catalog.terms[key]?.members ?? [])),
  );
}
