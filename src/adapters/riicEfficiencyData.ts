import {
  createEfficiencyCatalog,
  type EfficiencyCatalog,
  type EfficiencyRuleset,
  type OperatorSkillFile,
  type EfficiencyTermsFile,
} from "@arknights/riic-efficiency";
import type { BaseSkillTerms } from "@/types/baseData";

const operatorModules = import.meta.glob(
  "../../packages/riic-efficiency/data/operators/*.json",
  { eager: true, import: "default" },
) as Record<string, OperatorSkillFile>;
const rulesetModules = import.meta.glob(
  "../../packages/riic-efficiency/data/ruleset.json",
  { eager: true, import: "default" },
) as Record<string, EfficiencyRuleset>;
const termsModules = import.meta.glob(
  "../../packages/riic-efficiency/data/terms.json",
  { eager: true, import: "default" },
) as Record<string, EfficiencyTermsFile>;

function operatorIdFromPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1, -5);
}

const operatorSkillFiles = new Map(
  Object.entries(operatorModules).map(([path, file]) => [
    operatorIdFromPath(path),
    file,
  ]),
);
const ruleset = Object.values(rulesetModules)[0];
const termsData = Object.values(termsModules)[0];

if (!ruleset) {
  throw new Error("效率组件规则数据未加载");
}
if (!termsData) {
  throw new Error("效率组件术语数据未加载");
}

const catalog: EfficiencyCatalog = {
  ...createEfficiencyCatalog([...operatorSkillFiles.values()], termsData.terms),
  ruleset,
};

export function getRiicEfficiencyCatalog(): EfficiencyCatalog {
  return catalog;
}

export function getRiicEfficiencyOperatorSkillFile(
  operatorId: string,
): OperatorSkillFile | undefined {
  return operatorSkillFiles.get(operatorId);
}

export function getRiicEfficiencyTerms(): BaseSkillTerms {
  return Object.fromEntries(
    Object.entries(catalog.terms).map(([key, term]) => [
      key,
      {
        name: term.name ?? key,
        ...(term.definition ? { definition: term.definition } : {}),
        ...(term.members ? { members: [...term.members] } : {}),
      },
    ]),
  );
}
