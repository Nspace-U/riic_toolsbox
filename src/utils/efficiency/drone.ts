import type {
  EfficiencyCalculationOptions,
  EfficiencyCatalog,
  ProductionValue,
} from "@/types/efficiency";
import type {
  OperatorState,
  RoomAssignment,
  ScheduleDocument,
} from "@/types/schedule";
import {
  buildFacilities,
  ORUNDUM_TRADE_ORDER,
  TRADE_ORDERS,
  manufactureRule,
} from "@/utils/efficiency/baseRules";
import { calculateEfficiency } from "@/utils/efficiency/calculate";
import { DRONE_ACCELERATION_MINUTES } from "@/utils/sanity";
import type { SanityResourceAmounts } from "@/utils/sanity";
import { canonicalResourceKey, resolveRoomAssignment } from "@/utils/schedule";

export const DRONE_ACCELERATABLE_PRODUCTS = [
  "龙门币",
  "合成玉",
  "赤金",
  "中级作战记录",
  "源石碎片",
] as const;

export type DroneAcceleratableProduct =
  (typeof DRONE_ACCELERATABLE_PRODUCTS)[number];

export type LmdDroneStrategyLevel = 1 | 2 | 3;

export type LmdDroneStrategies = Record<LmdDroneStrategyLevel, string>;

export const DEFAULT_LMD_DRONE_STRATEGIES: LmdDroneStrategies = {
  1: "1 但书",
  2: "2 但书",
  3: "3 但书 龙舌兰",
};

function lowestTradingLevel(
  document: ScheduleDocument,
): LmdDroneStrategyLevel | undefined {
  const level = Math.min(
    ...document.layout
      .filter((entry) => entry.type === "trading")
      .map((entry) => entry.level),
  );
  return Number.isInteger(level) && level >= 1 && level <= 3
    ? (level as LmdDroneStrategyLevel)
    : undefined;
}

export interface LmdDroneStrategy {
  level: number;
  operators: string[];
  operatorStates: Record<string, OperatorState>;
}

export interface LmdDroneStrategyParseResult {
  strategy?: LmdDroneStrategy;
  error?: string;
}

export interface DroneAccelerationScenario {
  product: DroneAcceleratableProduct;
  baseAmountPerHour: number;
  baseMaterialPerHour: Record<string, number>;
  droneAmount: number;
  acceleratedHours: number;
  extraFlow: SanityResourceAmounts;
}

export interface DroneAccelerationResult {
  dailyDrones: number;
  acceleratedHours: number;
  strategyError?: string;
  scenarios: DroneAccelerationScenario[];
}

export interface DroneAccelerationOptions extends EfficiencyCalculationOptions {
  lmdDroneStrategies?: LmdDroneStrategies;
}

interface BaseProductFlow {
  amountPerHour: number;
  materialPerHour: Record<string, number>;
}

interface CycleProductFlow {
  amount: number;
  materials: Record<string, number>;
}

function addAmount(
  values: Record<string, number>,
  key: string,
  amount: number,
): void {
  const resource = canonicalResourceKey(key);
  values[resource] = (values[resource] ?? 0) + amount;
}

function parseOperatorToken(
  token: string,
  catalog: EfficiencyCatalog,
): { name: string; state?: OperatorState } | undefined {
  if (catalog.operators[token]) {
    return { name: token };
  }
  const match = token.match(/^(.+)([012])$/);
  const name = match?.[1];
  if (!name || !catalog.operators[name]) {
    return undefined;
  }
  return { name, state: { elite: Number(match[2]) } };
}

export function parseLmdDroneStrategy(
  text: string,
  catalog: EfficiencyCatalog,
): LmdDroneStrategyParseResult {
  const normalized = text.trim();
  if (!normalized) {
    return {};
  }
  const tokens = normalized.split(/\s+/);
  const level = Number(tokens[0]);
  if (!Number.isInteger(level) || level < 1 || level > 3) {
    return {
      error: "龙门币策略格式应为“贸易站等级 干员名…”，等级必须是 1 到 3",
    };
  }
  const operators: string[] = [];
  const operatorStates: Record<string, OperatorState> = {};
  for (const token of tokens.slice(1)) {
    const parsed = parseOperatorToken(token, catalog);
    if (!parsed) {
      return { error: `找不到干员“${token}”，或练度后缀不是 0、1、2` };
    }
    if (operators.includes(parsed.name)) {
      return { error: `干员“${parsed.name}”重复输入` };
    }
    operators.push(parsed.name);
    if (parsed.state) {
      operatorStates[parsed.name] = parsed.state;
    }
  }
  if (operators.length > level) {
    return { error: `等级 ${level} 的贸易站最多输入 ${level} 名干员` };
  }
  return { strategy: { level, operators, operatorStates } };
}

function planDurationHours(document: ScheduleDocument, index: number): number {
  return Math.max(0, Number(document.plans[index]?.duration ?? 720) / 60);
}

function productForAssignment(
  type: string,
  assignment: RoomAssignment,
): string | undefined {
  if (type === "trading") {
    return canonicalResourceKey(assignment.product ?? "龙门币");
  }
  return assignment.product
    ? canonicalResourceKey(assignment.product)
    : undefined;
}

function productionFlowForAssignment(
  type: string,
  assignment: RoomAssignment,
  level = 1,
): BaseProductFlow | undefined {
  const product = productForAssignment(type, assignment);
  if (type === "trading" && product === "龙门币") {
    const orders = TRADE_ORDERS[level] ?? TRADE_ORDERS[1] ?? [];
    return baseTradeFlowFromOrders(
      orders.map((order) => ({
        probability: order.probability,
        quantity: order.gold,
        time: order.hours,
        material: "赤金",
        amount: order.amount,
      })),
    );
  }
  if (type === "trading" && product === "合成玉") {
    return {
      amountPerHour:
        ORUNDUM_TRADE_ORDER.productAmount / ORUNDUM_TRADE_ORDER.hours,
      materialPerHour: {
        源石碎片:
          -ORUNDUM_TRADE_ORDER.materialAmount / ORUNDUM_TRADE_ORDER.hours,
      },
    };
  }
  if (type !== "manufacture") {
    return undefined;
  }
  const rule = manufactureRule(product, assignment.sourceMaterial);
  if (!rule) {
    return undefined;
  }
  return {
    amountPerHour: rule.amount / rule.hours,
    materialPerHour: Object.fromEntries(
      Object.entries(rule.materials ?? {}).map(([material, amount]) => [
        canonicalResourceKey(material),
        -amount / rule.hours,
      ]),
    ),
  };
}

function scheduleBaseFlows(
  document: ScheduleDocument,
): Map<string, BaseProductFlow> {
  const facilities = buildFacilities(document.layout).filter(
    (facility) =>
      facility.type === "trading" || facility.type === "manufacture",
  );
  const totalHours = document.plans.reduce(
    (total, _plan, index) => total + planDurationHours(document, index),
    0,
  );
  const cycleFlows = new Map<string, CycleProductFlow>();
  facilities.forEach((facility) => {
    document.plans.forEach((_plan, planIndex) => {
      const assignment = resolveRoomAssignment(
        document,
        planIndex,
        facility.type,
        facility.index,
      ).assignment;
      const product = productForAssignment(facility.type, assignment);
      const flow = productionFlowForAssignment(
        facility.type,
        assignment,
        facility.level,
      );
      if (!product || !flow) {
        return;
      }
      const hours = planDurationHours(document, planIndex);
      const current = cycleFlows.get(product) ?? {
        amount: 0,
        materials: {},
      };
      current.amount += flow.amountPerHour * hours;
      Object.entries(flow.materialPerHour).forEach(([material, amount]) => {
        addAmount(current.materials, material, amount * hours);
      });
      cycleFlows.set(product, current);
    });
  });
  if (totalHours <= 0) {
    return new Map();
  }
  return new Map(
    [...cycleFlows].map(([product, flow]) => [
      product,
      {
        amountPerHour: flow.amount / totalHours,
        materialPerHour: Object.fromEntries(
          Object.entries(flow.materials).map(([material, amount]) => [
            material,
            amount / totalHours,
          ]),
        ),
      },
    ]),
  );
}

function baseTradeFlowFromOrders(
  orders: Array<{
    probability: number;
    quantity: number;
    time: number;
    material?: string | null;
    amount?: number;
  }>,
): BaseProductFlow | undefined {
  const expectedTime = orders.reduce(
    (total, order) => total + order.probability * order.time,
    0,
  );
  if (expectedTime <= 0) {
    return undefined;
  }
  const expectedGold = orders.reduce(
    (total, order) => total + order.probability * order.quantity,
    0,
  );
  const expectedMaterial = orders.reduce(
    (total, order) =>
      total +
      (canonicalResourceKey(order.material ?? "") === "赤金"
        ? order.probability * (order.amount ?? 0)
        : 0),
    0,
  );
  return {
    amountPerHour: expectedGold / expectedTime,
    materialPerHour: {
      赤金: -expectedMaterial / expectedTime,
    },
  };
}

function lmdBaseFlow(
  strategy: LmdDroneStrategy,
  catalog: EfficiencyCatalog,
  options: EfficiencyCalculationOptions,
): BaseProductFlow | undefined {
  if (strategy.operators.length === 0) {
    const orders = TRADE_ORDERS[strategy.level] ?? TRADE_ORDERS[1] ?? [];
    return baseTradeFlowFromOrders(
      orders.map((order) => ({
        probability: order.probability,
        quantity: order.gold,
        time: order.hours,
        material: "赤金",
        amount: order.amount,
      })),
    );
  }
  const document: ScheduleDocument = {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: strategy.level },
    ],
    plans: [
      {
        duration: 1440,
        rooms: {
          control: [{}],
          trading: [
            {
              product: "龙门币",
              operators: strategy.operators,
              operatorStates: strategy.operatorStates,
            },
          ],
        },
      },
    ],
    settings: { preferMaxJieEfficiency: true },
  };
  const result = calculateEfficiency(document, catalog, options);
  const production = result.plans[0]?.facilities.find(
    (facility) => facility.facility.type === "trading",
  )?.production;
  return production ? baseTradeFlowFromProduction(production) : undefined;
}

function baseTradeFlowFromProduction(
  production: ProductionValue,
): BaseProductFlow | undefined {
  return baseTradeFlowFromOrders(production.orders ?? []);
}

function addFlow(
  target: SanityResourceAmounts,
  source: Record<string, number>,
  factor: number,
): void {
  Object.entries(source).forEach(([resource, amount]) => {
    addAmount(target, resource, amount * factor);
  });
}

export function calculateDroneAcceleration(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
  dailyAmounts: SanityResourceAmounts,
  options: DroneAccelerationOptions = {},
): DroneAccelerationResult {
  const dailyDrones = Math.max(0, dailyAmounts.无人机 ?? 0);
  const acceleratedHours = (dailyDrones * DRONE_ACCELERATION_MINUTES) / 60;
  const override = document.settings?.lmdDroneStrategy?.trim();
  const defaultLevel = lowestTradingLevel(document);
  const defaultStrategies =
    options.lmdDroneStrategies ?? DEFAULT_LMD_DRONE_STRATEGIES;
  const strategyText =
    override || (defaultLevel ? (defaultStrategies[defaultLevel] ?? "") : "");
  let parseResult = parseLmdDroneStrategy(strategyText, catalog);
  if (
    !override &&
    defaultLevel !== undefined &&
    parseResult.strategy &&
    parseResult.strategy.level !== defaultLevel
  ) {
    parseResult = {
      error: `${defaultLevel}级贸易站策略必须以“${defaultLevel}”开头`,
    };
  }
  const baseFlows = scheduleBaseFlows(document);
  const lmdExists = baseFlows.has("龙门币");
  if (lmdExists && parseResult.strategy) {
    const flow = lmdBaseFlow(parseResult.strategy, catalog, options);
    if (flow) {
      baseFlows.set("龙门币", flow);
    }
  }
  const scenarios = DRONE_ACCELERATABLE_PRODUCTS.flatMap((product) => {
    if (!baseFlows.has(product)) {
      return [];
    }
    if (product === "龙门币" && !parseResult.strategy) {
      return [];
    }
    const flow = baseFlows.get(product);
    if (!flow) {
      return [];
    }
    const extraFlow: SanityResourceAmounts = { 无人机: -dailyDrones };
    addAmount(extraFlow, product, flow.amountPerHour * acceleratedHours);
    addFlow(extraFlow, flow.materialPerHour, acceleratedHours);
    return [
      {
        product,
        baseAmountPerHour: flow.amountPerHour,
        baseMaterialPerHour: flow.materialPerHour,
        droneAmount: dailyDrones,
        acceleratedHours,
        extraFlow,
      },
    ];
  });
  return {
    dailyDrones,
    acceleratedHours,
    ...(parseResult.error ? { strategyError: parseResult.error } : {}),
    scenarios,
  };
}
