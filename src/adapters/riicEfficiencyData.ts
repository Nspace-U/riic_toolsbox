import {
  createEfficiencyCatalog,
  type EfficiencyCatalog,
  type EfficiencyRuleset,
  type OperatorSkillFile,
  type EfficiencyTermsFile,
  type RecycleOutputPoolItem,
  type RecycleRules,
} from "@arknights/riic-efficiency";
import type { BaseSkillTerms } from "@/types/baseData";
import type { TorappuItemTable } from "@/types/torappu";
import type { TorappuBuildingData } from "@/utils/parseTorappuData";

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
function requiredRuleset(): EfficiencyRuleset {
  const value = Object.values(rulesetModules)[0];
  if (!value) {
    throw new Error("效率组件规则数据未加载");
  }
  return value;
}

const ruleset = requiredRuleset();
const termsData = Object.values(termsModules)[0];

if (!termsData) {
  throw new Error("效率组件术语数据未加载");
}

const catalog: EfficiencyCatalog = {
  ...createEfficiencyCatalog([...operatorSkillFiles.values()], termsData.terms),
  ruleset,
};

export function buildRecycleRules(
  buildingData: TorappuBuildingData | undefined,
  itemTable: TorappuItemTable | undefined,
): RecycleRules | undefined {
  const recycleData = buildingData?.recycleData;
  const constants = buildingData?.recycleRoomConsts;
  const phaseData = recycleData?.phases;
  const roomPhases = buildingData?.recycleRoom?.phases;
  if (
    recycleData?.basicSpeedBuff === undefined ||
    !constants ||
    !phaseData?.length ||
    !roomPhases?.length ||
    constants.recycleTimeRequirement === undefined ||
    constants.recycleBaseCapacity === undefined ||
    constants.recycleBoostSpeed === undefined ||
    constants.recycleBoostLimit === undefined ||
    constants.recycleBoostLimitProtect === undefined ||
    constants.recycleSpeedUpUnlockLevel === undefined ||
    constants.recycleTwoPersonUnlockLevel === undefined
  ) {
    return undefined;
  }

  const now = Date.now() / 1000;
  const poolDefinition = Object.values(
    buildingData?.recycleRoomOutputPoolDatas ?? {},
  )
    .filter(
      (pool) => pool.itemPoolStartTime <= now && now <= pool.itemPoolEndTime,
    )
    .sort((left, right) => left.itemPoolStartTime - right.itemPoolStartTime)
    .at(-1);
  const outputPool = poolDefinition
    ? (() => {
        const normal =
          buildingData?.recycleRoomOutputPoolContentDatas?.[
            poolDefinition.itemPoolId
          ];
        const extra =
          buildingData?.recycleRoomOutputPoolContentDatas?.[
            poolDefinition.extraPoolId
          ];
        if (!normal || !extra) {
          throw new Error(
            `Torappu 回收站产出池 ${poolDefinition.itemPoolId} 数据不完整`,
          );
        }
        const mapItems = (
          items: typeof normal.items,
        ): RecycleOutputPoolItem[] =>
          items.map((item) => {
            const name = itemTable?.items[item.itemId]?.name;
            if (!name) {
              throw new Error(
                `回收站物品 ${item.itemId} 不在 Torappu 物品表中`,
              );
            }
            return {
              itemId: item.itemId,
              name,
              weight: item.weight,
              count: item.count,
              extraPoolValueChange: item.extraPoolValueChange,
            };
          });
        return {
          id: poolDefinition.itemPoolId,
          extraPoolId: poolDefinition.extraPoolId,
          extraPoolRequirement: poolDefinition.extraPoolRequirement,
          normalItems: mapItems(normal.items),
          extraItems: mapItems(extra.items),
        };
      })()
    : undefined;
  const inputItems = Object.values(
    buildingData?.recycleRoomInputItemDatas ?? {},
  ).map((item) => {
    const name = itemTable?.items[item.itemId]?.name;
    if (!name) {
      throw new Error(`Torappu 回收站加速道具 ${item.itemId} 不在物品表中`);
    }
    return { itemId: item.itemId, name, addedTime: item.addedTime };
  });

  return {
    basicSpeedBuff: recycleData.basicSpeedBuff,
    phases: phaseData.map((phase, index) => {
      const maxStationedNum = roomPhases[index]?.maxStationedNum;
      if (
        phase.recycleCapacity === undefined ||
        phase.recycleSpeed === undefined ||
        maxStationedNum === undefined
      ) {
        throw new Error(`Torappu 回收站第 ${index + 1} 级数据不完整`);
      }
      return {
        recycleCapacity: phase.recycleCapacity,
        recycleSpeed: phase.recycleSpeed,
        maxStationedNum,
      };
    }),
    timeRequirement: constants.recycleTimeRequirement,
    baseCapacity: constants.recycleBaseCapacity,
    boostSpeed: constants.recycleBoostSpeed,
    boostLimit: constants.recycleBoostLimit,
    boostLimitProtect: constants.recycleBoostLimitProtect,
    speedUpUnlockLevel: constants.recycleSpeedUpUnlockLevel,
    twoPersonUnlockLevel: constants.recycleTwoPersonUnlockLevel,
    inputItems,
    ...(outputPool ? { outputPool } : {}),
  };
}

export function getRiicEfficiencyCatalog(
  recycleRules?: RecycleRules,
): EfficiencyCatalog {
  if (!recycleRules) {
    return catalog;
  }
  return {
    ...catalog,
    ruleset: { ...ruleset, recycle: recycleRules },
  };
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
