import type { BaseSkillTerms } from "@/types/baseData";
import type { EfficiencyCatalog } from "@/types/efficiency";

import { groupMembers } from "@/utils/efficiency/catalog";

const PERCENTAGE_OPERATOR_PATTERN = /^\d+(?:\.\d+)?%$/;

type SpecialOperatorTerms = BaseSkillTerms | EfficiencyCatalog["terms"];

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
  return termKeysForTerms(name, catalog.terms);
}

function termKeysForTerms(name: string, terms: SpecialOperatorTerms): string[] {
  const trimmedName = name.trim();
  return Object.entries(terms)
    .filter(([key, term]) => key === trimmedName || term.name === trimmedName)
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

export function isKnownSpecialOperator(
  name: string,
  terms: SpecialOperatorTerms = {},
): boolean {
  return isPercentageOperator(name) || termKeysForTerms(name, terms).length > 0;
}

export function specialOperatorAvatarLabel(
  name: string,
  terms: SpecialOperatorTerms,
): string | undefined {
  const trimmedName = name.trim();
  if (isPercentageOperator(trimmedName)) {
    return trimmedName;
  }

  const termKey = termKeysForTerms(trimmedName, terms)[0];
  const termName = termKey ? terms[termKey]?.name : undefined;
  if (!termName) {
    return undefined;
  }
  return Array.from(termName).slice(0, 2).join("");
}

export function createSpecialOperatorAvatarLabelResolver(
  terms: SpecialOperatorTerms,
): (name: string) => string | undefined {
  const labels = new Map<string, string | undefined>();
  return function resolveSpecialOperatorAvatarLabel(
    name: string,
  ): string | undefined {
    if (!labels.has(name)) {
      labels.set(name, specialOperatorAvatarLabel(name, terms));
    }
    return labels.get(name);
  };
}

export function groupIncludesOperator(
  catalog: EfficiencyCatalog,
  group: string | undefined,
  name: string,
): boolean {
  return (
    groupMembers(catalog, group).includes(name) ||
    (group !== undefined &&
      termKeysForSpecialOperator(name, catalog).includes(group))
  );
}

export function specialOperatorTermMembers(
  name: string,
  catalog: EfficiencyCatalog,
): string[] {
  const keys = termKeysForSpecialOperator(name, catalog);
  return Array.from(new Set(keys.flatMap((key) => groupMembers(catalog, key))));
}
