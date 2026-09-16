import type { LayoutEntry, RoomKey } from "@/types/schedule";
import type { EfficiencyFacility } from "@/types/efficiency";
import { canonicalResourceKey } from "@/utils/schedule";

export const WORK_ROOM_KEYS: RoomKey[] = [
  "control",
  "trading",
  "manufacture",
  "power",
  "meeting",
  "hire",
];

export const BASE_EFFICIENCY: Partial<Record<RoomKey, number>> = {
  trading: 100,
  manufacture: 100,
  power: 100,
  meeting: 107,
  hire: 100,
};

export const MEETING_LEVEL_EFFICIENCY: Record<number, number> = {
  1: 107,
  2: 109,
  3: 111,
};

export const MANUFACTURE_STORAGE: Record<number, number> = {
  1: 24,
  2: 36,
  3: 54,
};

export const TRADE_ORDER_LIMIT: Record<number, number> = {
  1: 6,
  2: 8,
  3: 10,
};

export const CLUE_BASE_TIME_HOURS = 20;
export const CREDIT_PER_CLUE = 40;

export const ORUNDUM_TRADE_ORDER = {
  productAmount: 20,
  materialAmount: 2,
  hours: 2,
} as const;

export interface ManufactureRule {
  product: string;
  recipe: string;
  amount: number;
  hours: number;
  volume: number;
  materials?: Record<string, number>;
}

export const MANUFACTURE_RULES: Record<string, ManufactureRule> = {
  中级作战记录: {
    product: "中级作战记录",
    recipe: "作战记录",
    amount: 1,
    hours: 3,
    volume: 5,
  },
  赤金: {
    product: "赤金",
    recipe: "贵金属",
    amount: 1,
    hours: 1.2,
    volume: 2,
  },
  "源石碎片:固源岩": {
    product: "源石碎片",
    recipe: "源石碎片",
    amount: 1,
    hours: 1,
    volume: 3,
    materials: { 固源岩: 2, 龙门币: 1600 },
  },
  "源石碎片:装置": {
    product: "源石碎片",
    recipe: "源石碎片",
    amount: 1,
    hours: 1,
    volume: 3,
    materials: { 装置: 1, 龙门币: 1000 },
  },
};

export interface TradeOrder {
  name: string;
  product: string;
  amount: number;
  gold: number;
  hours: number;
  probability: number;
  ignoreEfficiency?: boolean;
}

export const TRADE_ORDERS: Record<number, TradeOrder[]> = {
  1: [
    {
      name: "2贵金属订单",
      product: "龙门币",
      amount: 2,
      gold: 1000,
      hours: 2.4,
      probability: 1,
    },
  ],
  2: [
    {
      name: "2贵金属订单",
      product: "龙门币",
      amount: 2,
      gold: 1000,
      hours: 2.4,
      probability: 0.6,
    },
    {
      name: "3贵金属订单",
      product: "龙门币",
      amount: 3,
      gold: 1500,
      hours: 3.5,
      probability: 0.4,
    },
  ],
  3: [
    {
      name: "2贵金属订单",
      product: "龙门币",
      amount: 2,
      gold: 1000,
      hours: 2.4,
      probability: 0.3,
    },
    {
      name: "3贵金属订单",
      product: "龙门币",
      amount: 3,
      gold: 1500,
      hours: 3.5,
      probability: 0.5,
    },
    {
      name: "4贵金属订单",
      product: "龙门币",
      amount: 4,
      gold: 2000,
      hours: 4.6,
      probability: 0.2,
    },
  ],
};

export const TAILOR_PROBABILITIES: Record<string, number[]> = {
  "1α": [0.15, 0.3, 0.55],
  "2α": [0.13, 0.22, 0.65],
  "1α1β": [0.05, 0.1, 0.85],
};

export function facilityId(type: RoomKey, index: number): string {
  return `${type}-${index + 1}`;
}

export function buildFacilities(layout: LayoutEntry[]): EfficiencyFacility[] {
  const indexes = new Map<RoomKey, number>();
  return layout.map((entry) => {
    const index = indexes.get(entry.type) ?? 0;
    indexes.set(entry.type, index + 1);
    return {
      id: facilityId(entry.type, index),
      type: entry.type,
      level: entry.level,
      index,
    };
  });
}

export function meetingBaseEfficiency(level: number): number {
  return MEETING_LEVEL_EFFICIENCY[level] ?? MEETING_LEVEL_EFFICIENCY[1] ?? 107;
}

export function facilityBaseEfficiency(type: RoomKey, level: number): number {
  if (type === "meeting") {
    return meetingBaseEfficiency(level);
  }
  return BASE_EFFICIENCY[type] ?? 0;
}

export function manufactureRule(
  product: string | undefined,
  sourceMaterial: string | undefined,
): ManufactureRule | undefined {
  if (!product) {
    return undefined;
  }
  const canonicalProduct = canonicalResourceKey(product);
  if (canonicalProduct === "源石碎片") {
    return MANUFACTURE_RULES[`源石碎片:${sourceMaterial || "固源岩"}`];
  }
  return MANUFACTURE_RULES[canonicalProduct];
}

export function dormitoryAtmosphere(layout: LayoutEntry[]): number {
  return layout
    .filter((entry) => entry.type === "dormitory")
    .reduce((total, entry) => total + entry.level * 1000, 0);
}

export function meetingAtmosphereBonus(atmosphere: number): number {
  if (atmosphere >= 4000) return 15;
  if (atmosphere >= 3000) return 10;
  if (atmosphere >= 2000) return 5;
  return 0;
}

export function rarityEfficiency(rarity: number): number {
  if (rarity >= 6) return 5;
  if (rarity === 5) return 4;
  if (rarity === 4) return 2;
  return 0;
}

export function eliteEfficiency(elite: number): number {
  if (elite >= 2) return 16;
  if (elite >= 1) return 8;
  return 0;
}
