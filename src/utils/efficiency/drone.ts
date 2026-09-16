import type {
  EfficiencyCalculationOptions,
  EfficiencyCatalog,
  EfficiencyResult,
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
import {
  canonicalResourceKey,
  ROOM_LABELS,
  resolveRoomAssignment,
} from "@/utils/schedule";

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
  key: string;
  product: DroneAcceleratableProduct;
  sourceLabel?: string;
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
  efficiencyResult?: EfficiencyResult;
  lmdDroneStrategies?: LmdDroneStrategies;
}

interface BaseProductFlow {
  amountPerHour: number;
  materialPerHour: Record<string, number>;
}

interface FacilityProductFlow extends BaseProductFlow {
  key: string;
  product: DroneAcceleratableProduct;
  sourceLabel: string;
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

function isDroneAcceleratableProduct(
  product: string,
): product is DroneAcceleratableProduct {
  return (DRONE_ACCELERATABLE_PRODUCTS as readonly string[]).includes(product);
}

function baseFlowFromProduction(
  production: ProductionValue,
): BaseProductFlow | undefined {
  const amountPerHour =
    production.baseAmountPerHour ?? production.amountPerHour;
  if (amountPerHour <= 0) {
    return undefined;
  }
  const materialScale =
    production.amountPerHour > 0 ? amountPerHour / production.amountPerHour : 1;
  return {
    amountPerHour,
    materialPerHour: Object.fromEntries(
      Object.entries(production.materialPerHour ?? {}).map(
        ([material, amount]) => [
          canonicalResourceKey(material),
          amount * materialScale,
        ],
      ),
    ),
  };
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
  level: number,
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

function facilityProductFlows(
  document: ScheduleDocument,
  result: EfficiencyResult,
): FacilityProductFlow[] {
  const facilities = buildFacilities(document.layout).filter(
    (facility) =>
      facility.type === "trading" || facility.type === "manufacture",
  );
  return facilities.flatMap((facility) =>
    document.plans.flatMap((plan, planIndex) => {
      const assignment = resolveRoomAssignment(
        document,
        planIndex,
        facility.type,
        facility.index,
      ).assignment;
      const product = productForAssignment(facility.type, assignment);
      if (!product || !isDroneAcceleratableProduct(product)) {
        return [];
      }
      const calculatedFacility = result.plans[planIndex]?.facilities.find(
        (candidate) => candidate.facility.id === facility.id,
      );
      const flow = calculatedFacility?.production
        ? baseFlowFromProduction(calculatedFacility.production)
        : productionFlowForAssignment(
            facility.type,
            assignment,
            facility.level,
          );
      if (!flow) {
        return [];
      }
      const planName = result.plans[planIndex]?.name ?? plan.name;
      return [
        {
          ...flow,
          key: `${planIndex}-${facility.id}`,
          product,
          sourceLabel: `${planName || `队列${planIndex + 1}`} · ${ROOM_LABELS[facility.type]}${facility.index + 1}`,
        },
      ];
    }),
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
  const efficiencyResult =
    options.efficiencyResult ?? calculateEfficiency(document, catalog, options);
  const facilityFlows = facilityProductFlows(document, efficiencyResult);
  const lmdExists = facilityFlows.some((flow) => flow.product === "龙门币");
  const lmdFlow =
    lmdExists && parseResult.strategy
      ? lmdBaseFlow(parseResult.strategy, catalog, options)
      : undefined;
  const scenarios = DRONE_ACCELERATABLE_PRODUCTS.flatMap((product) => {
    if (product === "龙门币") {
      const strategy = parseResult.strategy;
      if (!lmdFlow || !strategy) {
        return [];
      }
      return [
        createScenario(
          "龙门币策略",
          product,
          lmdFlow,
          dailyDrones,
          acceleratedHours,
        ),
      ];
    }
    return facilityFlows
      .filter((flow) => flow.product === product)
      .map((flow) =>
        createScenario(
          flow.key,
          flow.product,
          flow,
          dailyDrones,
          acceleratedHours,
          flow.sourceLabel,
        ),
      );
  });
  return {
    dailyDrones,
    acceleratedHours,
    ...(parseResult.error ? { strategyError: parseResult.error } : {}),
    scenarios,
  };
}

function createScenario(
  key: string,
  product: DroneAcceleratableProduct,
  flow: BaseProductFlow,
  dailyDrones: number,
  acceleratedHours: number,
  sourceLabel?: string,
): DroneAccelerationScenario {
  const extraFlow: SanityResourceAmounts = { 无人机: -dailyDrones };
  addAmount(extraFlow, product, flow.amountPerHour * acceleratedHours);
  addFlow(extraFlow, flow.materialPerHour, acceleratedHours);
  return {
    key,
    product,
    ...(sourceLabel ? { sourceLabel } : {}),
    baseAmountPerHour: flow.amountPerHour,
    baseMaterialPerHour: flow.materialPerHour,
    droneAmount: dailyDrones,
    acceleratedHours,
    extraFlow,
  };
}
