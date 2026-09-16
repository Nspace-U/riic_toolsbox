import type { ProductionValue } from "@/types/efficiency";
import {
  manufactureRule,
  ORUNDUM_TRADE_ORDER,
} from "@/utils/efficiency/baseRules";
import { canonicalResourceKey } from "@/utils/schedule";

export const DRONE_ACCELERATION_MINUTES = 3;
export const BATTLE_RECORD_EXPERIENCE = 1000;
export const PURE_GOLD_POINTS = 500;

export interface SanitySettings {
  lmd: number;
  goldExperienceRatio: number;
  orundum: number;
  credit: number;
  recruitRefresh: number;
  solidRock: number | null;
  device: number | null;
}

export const DEFAULT_SANITY_SETTINGS: SanitySettings = {
  lmd: 0.0036,
  goldExperienceRatio: 1.2,
  orundum: 0.75,
  credit: 5.3271 / 129,
  recruitRefresh: 19.0787820209763,
  solidRock: null,
  device: null,
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
  solidRock: number | null;
  device: number | null;
}

export type SanityFlowResource =
  | "LMD"
  | "Orundum"
  | "Pure Gold"
  | "Battle Record"
  | "Originium Shard"
  | "Drone"
  | "Credit"
  | "Recruit Refresh"
  | "固源岩"
  | "装置";

export type SanityResourceAmounts = Partial<Record<SanityFlowResource, number>>;

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
  resource: SanityFlowResource;
  label: string;
  amountUnit: string;
  amountFactor: number;
  value: (values: SanityValues) => number | null;
}

const SANITY_ITEM_DEFINITIONS: SanityItemDefinition[] = [
  {
    resource: "LMD",
    label: "龙门币",
    amountUnit: "龙门币",
    amountFactor: 1,
    value: (values) => values.lmd,
  },
  {
    resource: "Orundum",
    label: "合成玉",
    amountUnit: "合成玉",
    amountFactor: 1,
    value: (values) => values.orundum,
  },
  {
    resource: "Pure Gold",
    label: "赤金点数",
    amountUnit: "赤金点数",
    amountFactor: PURE_GOLD_POINTS,
    value: (values) => values.pureGoldPoint,
  },
  {
    resource: "Battle Record",
    label: "作战记录（经验）",
    amountUnit: "经验",
    amountFactor: BATTLE_RECORD_EXPERIENCE,
    value: (values) => values.experience,
  },
  {
    resource: "Drone",
    label: "无人机",
    amountUnit: "无人机",
    amountFactor: 1,
    value: (values) => values.drone,
  },
  {
    resource: "Credit",
    label: "信用点",
    amountUnit: "信用点",
    amountFactor: 1,
    value: (values) => values.credit,
  },
  {
    resource: "Recruit Refresh",
    label: "公开招募刷新次数",
    amountUnit: "次",
    amountFactor: 1,
    value: (values) => values.recruitRefresh,
  },
  {
    resource: "Originium Shard",
    label: "源石碎片",
    amountUnit: "源石碎片",
    amountFactor: 1,
    value: (values) => values.originiumShard,
  },
  {
    resource: "固源岩",
    label: "固源岩",
    amountUnit: "固源岩",
    amountFactor: 1,
    value: (values) => values.solidRock,
  },
  {
    resource: "装置",
    label: "装置",
    amountUnit: "装置",
    amountFactor: 1,
    value: (values) => values.device,
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
    manufactureRule("Battle Record", undefined)?.hours ?? 0;
  const pureGoldHours = manufactureRule("Pure Gold", undefined)?.hours ?? 0;
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
    solidRock: settings.solidRock,
    device: settings.device,
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
  if (
    !SANITY_ITEM_DEFINITIONS.some((item) => item.resource === knownResource)
  ) {
    return;
  }
  amounts[knownResource] = (amounts[knownResource] ?? 0) + amount;
}

export function addProductionFlow(
  amounts: SanityResourceAmounts,
  production: ProductionValue,
  hours: number,
): void {
  const amountPerHour =
    production.effectiveAmountPerHour ?? production.amountPerHour;
  if (production.product === "Clue") {
    addFlow(
      amounts,
      "Credit",
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
  const items = SANITY_ITEM_DEFINITIONS.flatMap((definition) => {
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
