export const DRONE_ACCELERATION_MINUTES = 3;

export type SanityFlowResource = string;

export type SanityResourceAmounts = Record<SanityFlowResource, number>;

import { manufactureRule, ORUNDUM_TRADE_ORDER } from "./efficiency/baseRules";
import { canonicalResourceKey } from "./schedule";
import type { ProductionValue } from "../types/efficiency";

export const BATTLE_RECORD_EXPERIENCE = 1000;
export const PURE_GOLD_POINTS = 500;

export interface SanitySettings {
  lmd: number;
  goldExperienceRatio: number;
  orundum: number;
  credit: number;
  recruitRefresh: number;
  recycleItemSanity?: number;
}

export const DEFAULT_SANITY_SETTINGS: SanitySettings = {
  lmd: 0.0036,
  goldExperienceRatio: 1.2,
  orundum: 0.75,
  credit: 5.3271 / 129,
  recruitRefresh: 19.0787820209763,
};

export interface SanityValues {
  lmd: number;
  goldExperienceRatio: number;
  orundum: number;
  pureGoldPoint: number;
  experience: number;
  drone: number;
  credit: number;
  recruitRefresh: number;
  originiumShard: number;
  recycleItemSanity: number | null;
  materials?: Readonly<Record<string, number | null>>;
}

export interface SanityResultItem {
  resource: SanityFlowResource;
  label: string;
  amount: number;
  amountUnit: string;
  sanityPerUnit?: number;
  contribution?: number;
}

export interface SanityResult {
  items: SanityResultItem[];
  total: number;
  complete: boolean;
  missing: string[];
}

interface SanityItemDefinition {
  resource: string;
  label: string;
  amountUnit: string;
  amountFactor: number;
  value: (values: SanityValues) => number | null;
}

const SANITY_ITEM_DEFINITIONS: SanityItemDefinition[] = [
  {
    resource: "龙门币",
    label: "龙门币",
    amountUnit: "龙门币",
    amountFactor: 1,
    value: (values) => values.lmd,
  },
  {
    resource: "合成玉",
    label: "合成玉",
    amountUnit: "合成玉",
    amountFactor: 1,
    value: (values) => values.orundum,
  },
  {
    resource: "赤金",
    label: "赤金点数",
    amountUnit: "赤金点数",
    amountFactor: PURE_GOLD_POINTS,
    value: (values) => values.pureGoldPoint,
  },
  {
    resource: "中级作战记录",
    label: "中级作战记录（经验）",
    amountUnit: "经验",
    amountFactor: BATTLE_RECORD_EXPERIENCE,
    value: (values) => values.experience,
  },
  {
    resource: "无人机",
    label: "无人机",
    amountUnit: "无人机",
    amountFactor: 1,
    value: (values) => values.drone,
  },
  {
    resource: "信用",
    label: "信用",
    amountUnit: "信用",
    amountFactor: 1,
    value: (values) => values.credit,
  },
  {
    resource: "公开招募标签刷新次数",
    label: "公开招募标签刷新次数",
    amountUnit: "次",
    amountFactor: 1,
    value: (values) => values.recruitRefresh,
  },
  {
    resource: "精英材料",
    label: "精英材料",
    amountUnit: "件",
    amountFactor: 1,
    value: (values) => values.recycleItemSanity,
  },
  {
    resource: "源石碎片",
    label: "源石碎片",
    amountUnit: "源石碎片",
    amountFactor: 1,
    value: (values) => values.originiumShard,
  },
];

function dronesForHours(hours: number): number {
  return (hours * 60) / DRONE_ACCELERATION_MINUTES;
}

export function calculateSanityValues(settings: SanitySettings): SanityValues {
  const experience =
    settings.goldExperienceRatio > 0
      ? settings.lmd / settings.goldExperienceRatio
      : 0;
  const battleRecord = experience * BATTLE_RECORD_EXPERIENCE;
  const battleRecordHours =
    manufactureRule("中级作战记录", undefined)?.hours ?? 0;
  const pureGoldHours = manufactureRule("赤金", undefined)?.hours ?? 0;
  const battleRecordDrones = dronesForHours(battleRecordHours);
  const drone = battleRecordDrones > 0 ? battleRecord / battleRecordDrones : 0;
  const pureGold = drone * dronesForHours(pureGoldHours);
  const originiumShard =
    (ORUNDUM_TRADE_ORDER.productAmount * settings.orundum -
      dronesForHours(ORUNDUM_TRADE_ORDER.hours) * drone) /
    ORUNDUM_TRADE_ORDER.materialAmount;

  return {
    lmd: settings.lmd,
    goldExperienceRatio: settings.goldExperienceRatio,
    orundum: settings.orundum,
    pureGoldPoint: pureGold / PURE_GOLD_POINTS,
    experience,
    drone,
    credit: settings.credit,
    recruitRefresh: settings.recruitRefresh,
    originiumShard,
    recycleItemSanity: settings.recycleItemSanity ?? null,
  };
}

function addFlow(
  amounts: SanityResourceAmounts,
  resource: string,
  amount: number,
): void {
  if (amount === 0) {
    return;
  }
  const knownResource = canonicalResourceKey(resource) as SanityFlowResource;
  amounts[knownResource] = (amounts[knownResource] ?? 0) + amount;
}

export function addProductionFlow(
  amounts: SanityResourceAmounts,
  production: ProductionValue,
  hours: number,
): void {
  const amountPerHour =
    production.effectiveAmountPerHour ?? production.amountPerHour;
  if (production.product === "线索") {
    addFlow(
      amounts,
      "信用",
      amountPerHour * hours * (production.conversion?.amountPerUnit ?? 0),
    );
  } else {
    addFlow(amounts, production.product, amountPerHour * hours);
  }

  const materials =
    production.effectiveMaterialPerHour ?? production.materialPerHour ?? {};
  Object.entries(materials).forEach(([resource, amountPerHourValue]) => {
    addFlow(amounts, resource, amountPerHourValue * hours);
  });
}

export function calculateSanityResult(
  amounts: SanityResourceAmounts,
  values: SanityValues,
): SanityResult {
  const missing: string[] = [];
  let total = 0;
  const materialValues = values.materials ?? {};
  const definitions = [
    ...SANITY_ITEM_DEFINITIONS.filter(
      (definition) => !Object.hasOwn(materialValues, definition.resource),
    ),
    ...Object.entries(materialValues).map(([resource, value]) => ({
      resource,
      label: resource,
      amountUnit: resource,
      amountFactor: 1,
      value: () => value,
    })),
  ];
  const items = definitions.flatMap((definition) => {
    const rawAmount = amounts[definition.resource] ?? 0;
    if (Math.abs(rawAmount) <= 0.000001) {
      return [];
    }
    const amount = rawAmount * definition.amountFactor;
    const sanityPerUnit = definition.value(values);
    if (sanityPerUnit === null) {
      missing.push(definition.label);
      return [
        {
          resource: definition.resource,
          label: definition.label,
          amount,
          amountUnit: definition.amountUnit,
        },
      ];
    }
    const contribution = amount * sanityPerUnit;
    total += contribution;
    return [
      {
        resource: definition.resource,
        label: definition.label,
        amount,
        amountUnit: definition.amountUnit,
        sanityPerUnit,
        contribution,
      },
    ];
  });

  return {
    items,
    total,
    complete: missing.length === 0,
    missing,
  };
}

export function sanityItemDefinitions(): ReadonlyArray<SanityItemDefinition> {
  return SANITY_ITEM_DEFINITIONS;
}
