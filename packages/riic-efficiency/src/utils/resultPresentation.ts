import type {
  BasePointDetail,
  EfficiencyPlanResult,
  EfficiencyResult,
  FacilityEfficiencyResult,
  MoodSnapshot,
  ProductionValue,
} from "../types/efficiency";
import type { EfficiencyTerm } from "../types/efficiency";
import type { RoomKey } from "../types/schedule";
import type {
  DroneAccelerationResult,
  DroneAccelerationScenario,
} from "./efficiency/drone";
import {
  BATTLE_RECORD_EXPERIENCE,
  PURE_GOLD_POINTS,
  addProductionFlow,
  calculateSanityResult,
  type SanityResourceAmounts,
  type SanityResult,
  type SanityValues,
} from "./sanity";
import { EPSILON } from "./efficiency/model";
import type {
  BasePointQueueDetail,
  DailyOutputCard,
  DailyOutputMaterialDetail,
  DailyOutputOrderDetail,
  DailyOutputProductDetail,
  DailyOutputQueueDetail,
  DroneScenarioDisplay,
  EfficiencyCalculationStepGroup,
  EfficiencyCalculationStepView,
  MaaDroneQueueDetail,
} from "../types/resultPresentation";
import { ROOM_LABELS } from "./schedule";
import { formatNumber, resourceLabel } from "./presentation";
import type { ResultPresentationData } from "../types/resultPresentation";

export interface ResultPresentationCallbacks {
  sourceFacilityForProduct?: (product: string) => RoomKey | undefined;
  facilityLabel?: (facility: FacilityEfficiencyResult) => string;
  basePointLabel?: (term: string) => string;
}

export function moodSnapshotsForFacility(
  plan: EfficiencyPlanResult,
  result: FacilityEfficiencyResult,
): EfficiencyCalculationStepView["moods"] {
  return plan.moods.filter(
    (mood) =>
      mood.working &&
      (mood.facilityId === result.facility.id ||
        (result.facility.type === "power" && mood.facility === "power")),
  );
}

export function buildCalculationSteps(
  result: EfficiencyResult,
): EfficiencyCalculationStepView[] {
  return result.plans.flatMap((plan, planIndex) => {
    const dormitorySteps = plan.dormitoryRecoveries.map((recovery) => {
      const dormitory = plan.facilities.find(
        (facility) => facility.facility.id === recovery.facilityId,
      )?.facility;
      return {
        plan,
        planIndex,
        ...(dormitory ? { dormitory } : {}),
        dormitoryRecovery: recovery,
        moods: [] as MoodSnapshot[],
      };
    });
    const facilitySteps = plan.facilities
      .filter(
        (facility) =>
          facility.facility.type !== "dormitory" &&
          (facility.production !== undefined ||
            facility.capacity !== undefined ||
            facility.details.length > 0),
      )
      .map((facility) => ({
        plan,
        planIndex,
        facility,
        moods: moodSnapshotsForFacility(plan, facility),
        droneAccelerations: plan.droneAccelerations.filter(
          (detail) => detail.facilityId === facility.facility.id,
        ),
      }));
    const controlMoods = plan.moods.filter(
      (mood) => mood.facility === "control" && mood.working,
    );
    return controlMoods.length > 0
      ? [
          { plan, planIndex, moods: controlMoods },
          ...dormitorySteps,
          ...facilitySteps,
        ]
      : [...dormitorySteps, ...facilitySteps];
  });
}

export function buildCalculationStepGroups(
  result: EfficiencyResult,
  steps: readonly EfficiencyCalculationStepView[],
  callbacks: ResultPresentationCallbacks = {},
): EfficiencyCalculationStepGroup[] {
  const groups = new Map<string, EfficiencyCalculationStepGroup>();
  steps.forEach((step) => {
    const key = step.facility?.facility.id ?? step.dormitory?.id ?? "control";
    const label = step.facility
      ? (callbacks.facilityLabel?.(step.facility) ??
        `${ROOM_LABELS[step.facility.facility.type]} ${step.facility.facility.index + 1}`)
      : step.dormitory
        ? `${ROOM_LABELS.dormitory} ${step.dormitory.index + 1}`
        : ROOM_LABELS.control;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label,
        activeColumnCount: 0,
        columns: result.plans.map((plan, planIndex) => ({ plan, planIndex })),
      };
      groups.set(key, group);
    }
    const column = group.columns[step.planIndex];
    if (!column) {
      return;
    }
    if (!column.step) {
      group.activeColumnCount += 1;
    }
    column.step = step;
  });
  return [...groups.values()];
}

function dailyOutputOrderDetail(
  order: NonNullable<ProductionValue["orders"]>[number],
): DailyOutputOrderDetail {
  return {
    name: order.name,
    probability: order.probability,
    quantity: order.quantity,
    time: order.time,
    ...(order.material === undefined ? {} : { material: order.material }),
    ...(order.amount === undefined ? {} : { amount: order.amount }),
  };
}

function dailyOutputMaterials(
  production: ProductionValue,
  durationHours: number,
  dailyHours: number,
): DailyOutputMaterialDetail[] {
  const baseMaterials =
    production.baseMaterialPerHour ?? production.materialPerHour ?? {};
  const selectedMaterials =
    production.effectiveMaterialPerHour ?? production.materialPerHour ?? {};
  return [
    ...new Set([
      ...Object.keys(baseMaterials),
      ...Object.keys(selectedMaterials),
    ]),
  ]
    .map((material) => ({
      material,
      baseAmountPerHour: baseMaterials[material] ?? 0,
      amount: selectedMaterials[material] ?? 0,
    }))
    .filter(
      ({ baseAmountPerHour, amount }) =>
        baseAmountPerHour < -EPSILON || amount < -EPSILON,
    )
    .map(({ material, baseAmountPerHour, amount }) => ({
      material,
      baseAmountPerHour,
      dailyAmount: (amount * durationHours * 24) / dailyHours,
      queueTotal: amount * durationHours,
    }));
}

function mergeDailyOutputMaterials(
  target: DailyOutputMaterialDetail[],
  materials: readonly DailyOutputMaterialDetail[],
): void {
  materials.forEach((material) => {
    const existing = target.find(
      (candidate) => candidate.material === material.material,
    );
    if (existing) {
      existing.baseAmountPerHour += material.baseAmountPerHour;
      existing.dailyAmount += material.dailyAmount;
      existing.queueTotal += material.queueTotal;
    } else {
      target.push({ ...material });
    }
  });
}

export function buildDailyOutputQueueDetails(
  result: EfficiencyResult,
  sanityValues: SanityValues,
  callbacks: ResultPresentationCallbacks = {},
): DailyOutputQueueDetail[] {
  if (result.dailyHours <= 0) {
    return [];
  }

  return result.plans
    .map((plan, planIndex) => {
      const products = new Map<string, DailyOutputProductDetail>();
      const queueAmounts: SanityResourceAmounts = {};
      plan.facilities.forEach((facility) => {
        const production = facility.production;
        if (!production) {
          return;
        }
        addProductionFlow(queueAmounts, production, plan.durationHours);
        const baseRate = production.baseAmountPerHour;
        const totalOutputPerHour = production.amountPerHour;
        const selectedOutputPerHour =
          production.effectiveAmountPerHour ?? totalOutputPerHour;
        const materials = dailyOutputMaterials(
          production,
          plan.durationHours,
          result.dailyHours,
        );
        const current = products.get(production.product) ?? {
          product: production.product,
          baseEfficiency: 0,
          totalEfficiency: 0,
          baseOutputPerHour: 0,
          totalOutputPerHour: 0,
          selectedOutputPerHour: 0,
          dailyContribution: 0,
          queueTotal: 0,
          materials: [],
          facilities: [],
        };
        mergeDailyOutputMaterials(current.materials, materials);
        current.baseEfficiency += facility.baseEfficiency;
        current.totalEfficiency += facility.efficiency;
        current.baseOutputPerHour += baseRate;
        current.totalOutputPerHour += totalOutputPerHour;
        current.selectedOutputPerHour += selectedOutputPerHour;
        current.queueTotal += selectedOutputPerHour * plan.durationHours;
        current.facilities.push({
          label:
            callbacks.facilityLabel?.(facility) ??
            `${ROOM_LABELS[facility.facility.type]} ${facility.facility.index + 1}`,
          baseEfficiency: facility.baseEfficiency,
          totalEfficiency: facility.efficiency,
          baseOutputPerHour: baseRate,
          totalOutputPerHour,
          selectedOutputPerHour,
          materials,
          orders: (production.orders ?? []).map((order) =>
            dailyOutputOrderDetail(order),
          ),
        });
        products.set(production.product, current);
      });
      return {
        plan,
        planIndex,
        products: Array.from(products.values()).map((product) => ({
          ...product,
          dailyContribution:
            (product.selectedOutputPerHour * plan.durationHours * 24) /
            result.dailyHours,
        })),
        sanity: calculateSanityResult(
          Object.fromEntries(
            Object.entries(queueAmounts).map(([resource, amount]) => [
              resource,
              (amount * 24) / result.dailyHours,
            ]),
          ) as SanityResourceAmounts,
          sanityValues,
        ),
      };
    })
    .filter((queue) => queue.products.length > 0);
}

export function buildDailySanityAmounts(
  result: EfficiencyResult,
): SanityResourceAmounts {
  const amounts: SanityResourceAmounts = {};
  result.dailyProductions.forEach((production) => {
    if (
      result.maaDroneAcceleration?.enabled &&
      production.product === "无人机"
    ) {
      return;
    }
    addProductionFlow(amounts, production, 24);
  });
  const dailyCredit = result.dailyOutputs.find(
    (output) => output.product === "信用",
  );
  if (dailyCredit) {
    amounts.信用 = dailyCredit.amountPerDay;
  }
  return amounts;
}

export function resourcePointInfo(
  product: string,
): { factor: number; label: string } | undefined {
  if (product === "赤金") {
    return { factor: PURE_GOLD_POINTS, label: "赤金点数" };
  }
  if (product === "中级作战记录") {
    return { factor: BATTLE_RECORD_EXPERIENCE, label: "经验点数" };
  }
  return undefined;
}

function amountFromFlow(
  amounts: SanityResourceAmounts,
  resource: string,
): number {
  return (amounts as Record<string, number | undefined>)[resource] ?? 0;
}

function createDailyOutputCard(
  product: string,
  amounts: SanityResourceAmounts,
  sanity: SanityResult | undefined,
  grossAmount?: number,
  sourceFacility?: RoomKey,
): DailyOutputCard {
  const pointInfo = resourcePointInfo(product);
  const sanityItem = sanity?.items.find((item) => item.resource === product);
  const rawNetAmount =
    (amounts as Record<string, number | undefined>)[product] ??
    grossAmount ??
    0;
  const netUnit =
    pointInfo?.label ?? sanityItem?.amountUnit ?? resourceLabel(product);
  const netAmount = rawNetAmount * (pointInfo?.factor ?? 1);
  const netContribution =
    sanityItem?.contribution ?? (sanity?.complete ? 0 : undefined);
  const grossPoints =
    grossAmount === undefined || !pointInfo
      ? undefined
      : grossAmount * pointInfo.factor;
  return {
    product,
    ...(sourceFacility === undefined ? {} : { sourceFacility }),
    ...(grossAmount === undefined ? {} : { grossAmount }),
    ...(grossPoints === undefined ? {} : { grossPoints }),
    ...(pointInfo ? { grossPointsLabel: pointInfo.label } : {}),
    netAmount,
    netResourceAmount: rawNetAmount,
    netUnit,
    ...(netContribution === undefined ? {} : { netContribution }),
    showNet:
      grossAmount === undefined ||
      Math.abs(rawNetAmount - grossAmount) > 0.000001,
  };
}

export function buildDailyOutputCards(
  result: EfficiencyResult,
  amounts: SanityResourceAmounts,
  sanity: SanityResult,
  callbacks: ResultPresentationCallbacks = {},
): DailyOutputCard[] {
  const productionOutputs = result.dailyOutputs.filter(
    (output) => output.kind === "production",
  );
  const productionProducts = new Set(
    productionOutputs.map((output) => output.product),
  );
  return [
    ...productionOutputs.map((output) =>
      createDailyOutputCard(
        output.product,
        amounts,
        sanity,
        output.amountPerDay,
        callbacks.sourceFacilityForProduct?.(output.product),
      ),
    ),
    ...result.dailyOutputs
      .filter(
        (output) =>
          output.kind === "net" && !productionProducts.has(output.product),
      )
      .map((output) =>
        createDailyOutputCard(
          output.product,
          amounts,
          sanity,
          undefined,
          callbacks.sourceFacilityForProduct?.(output.product),
        ),
      ),
  ];
}

function addResourceFlow(
  target: SanityResourceAmounts,
  source: SanityResourceAmounts,
): void {
  Object.entries(source).forEach(([resource, amount]) => {
    if (amount !== undefined) {
      const values = target as Record<string, number | undefined>;
      values[resource] = (values[resource] ?? 0) + amount;
    }
  });
}

function baseAmountsWithoutMaaDrones(
  result: EfficiencyResult,
  amounts: SanityResourceAmounts,
): SanityResourceAmounts {
  const base = { ...amounts };
  const maa = result.maaDroneAcceleration;
  if (!maa?.enabled || result.dailyHours <= 0) {
    return base;
  }
  maa.details.forEach((detail) => {
    addResourceFlow(base, {
      [detail.product]: (-detail.extraAmount * 24) / result.dailyHours,
      ...Object.fromEntries(
        Object.entries(detail.extraMaterial).map(([resource, amount]) => [
          resource,
          (-amount * 24) / result.dailyHours,
        ]),
      ),
    });
  });
  return base;
}

export { baseAmountsWithoutMaaDrones };

function scenarioResources(
  product: string,
  ...flows: SanityResourceAmounts[]
): string[] {
  const resources = new Set<string>([product]);
  flows.forEach((flow) => {
    Object.entries(flow).forEach(([resource, amount]) => {
      if (amount !== undefined && Math.abs(amount) > 0.000001) {
        resources.add(resource);
      }
    });
  });
  return [...resources];
}

function scenarioCards(
  product: string,
  amounts: SanityResourceAmounts,
  grossAmount: number,
  resources: string[],
  sourceFacilityForProduct?: (product: string) => RoomKey | undefined,
): DailyOutputCard[] {
  return resources
    .filter(
      (resource) =>
        resource !== "无人机" &&
        (resource === product ||
          Math.abs(amountFromFlow(amounts, resource)) > 0.000001),
    )
    .map((resource) =>
      createDailyOutputCard(
        resource,
        amounts,
        undefined,
        resource === product ? grossAmount : undefined,
        sourceFacilityForProduct?.(resource),
      ),
    );
}

export function buildDroneScenarioDisplays(
  result: EfficiencyResult,
  acceleration: DroneAccelerationResult,
  dailyAmounts: SanityResourceAmounts,
  callbacks: ResultPresentationCallbacks = {},
): DroneScenarioDisplay[] {
  if (result.dailyHours <= 0) {
    return [];
  }
  return acceleration.scenarios.map((scenario: DroneAccelerationScenario) => {
    const production = result.dailyProductions.find(
      (candidate) => candidate.product === scenario.product,
    );
    const baseGrossAmount = production
      ? (production.effectiveAmountPerDay ?? production.amountPerDay) -
        (result.maaDroneAcceleration?.details
          .filter((detail) => detail.product === scenario.product)
          .reduce(
            (total, detail) =>
              total + (detail.extraAmount * 24) / result.dailyHours,
            0,
          ) ?? 0)
      : 0;
    const acceleratedAmounts = baseAmountsWithoutMaaDrones(
      result,
      dailyAmounts,
    );
    addResourceFlow(acceleratedAmounts, scenario.extraFlow);
    const extraResources = scenarioResources(
      scenario.product,
      scenario.extraFlow,
    );
    const extraGrossAmount = amountFromFlow(
      scenario.extraFlow,
      scenario.product,
    );
    return {
      scenario,
      views: [
        {
          key: "extra",
          label: "无人机额外产出与消耗",
          cards: scenarioCards(
            scenario.product,
            scenario.extraFlow,
            extraGrossAmount,
            extraResources,
            callbacks.sourceFacilityForProduct,
          ),
        },
        {
          key: "accelerated",
          label: "全部无人机加速后",
          cards: scenarioCards(
            scenario.product,
            acceleratedAmounts,
            baseGrossAmount + extraGrossAmount,
            extraResources,
            callbacks.sourceFacilityForProduct,
          ),
        },
      ],
    };
  });
}

export function buildBasePointQueueDetails(
  result: EfficiencyResult,
  visibleTerms?: ReadonlySet<string>,
): BasePointQueueDetail[] {
  const displayed = (plan: EfficiencyPlanResult): BasePointDetail[] =>
    plan.basePointDetails.filter(
      (point) => !visibleTerms || visibleTerms.has(point.term),
    );
  if (!result.plans.some((plan) => displayed(plan).length > 0)) {
    return [];
  }
  return result.plans.map((plan, planIndex) => ({
    plan,
    planIndex,
    points: displayed(plan),
  }));
}

export function buildMaaDroneQueueDetails(
  result: EfficiencyResult,
): MaaDroneQueueDetail[] {
  const details = result.maaDroneAcceleration?.details ?? [];
  const candidates = result.maaDroneAcceleration?.candidates ?? [];
  return result.plans.map((plan, planIndex) => ({
    plan,
    planIndex,
    details: details.filter((detail) => detail.planIndex === planIndex),
    candidates: candidates.filter(
      (candidate) => candidate.planIndex === planIndex,
    ),
  }));
}

export function formatFacilityResultLabel(
  result: FacilityEfficiencyResult,
  layout: readonly { type: RoomKey }[],
): string {
  const { facility } = result;
  if (facility.type === "power") {
    return ROOM_LABELS[facility.type];
  }
  const count = layout.filter((entry) => entry.type === facility.type).length;
  return `${ROOM_LABELS[facility.type]}${count > 1 ? ` ${facility.index + 1}` : ""}`;
}

export function formatBasePointSource(
  source: import("../types/efficiency").BasePointSource,
  terms: Readonly<Record<string, EfficiencyTerm>>,
): string {
  const operator = [source.operator, source.skill].filter(Boolean).join(" · ");
  const facility = ROOM_LABELS[source.facility] ?? source.facility;
  if (source.kind === "convert" && source.from) {
    return `${operator}（${facility}，由${terms[source.from]?.name ?? source.from} × ${formatNumber(source.rate ?? 0)}派生）`;
  }
  return `${operator}（${facility}）`;
}

export function formatBasePointLabel(
  term: string,
  terms: Readonly<Record<string, EfficiencyTerm>>,
): string {
  return terms[term]?.name ?? term;
}

export function formatInheritedSourceLabel(
  result: FacilityEfficiencyResult,
  plans: readonly EfficiencyPlanResult[],
): string {
  if (!result.inherited || result.inheritedFromPlanIndex === undefined) {
    return "";
  }
  const source = plans[result.inheritedFromPlanIndex];
  return `继承自 ${source?.name || `队列${result.inheritedFromPlanIndex + 1}`}`;
}

export function resultPresentationSourceFacility(
  product: string,
  result: EfficiencyResult,
): RoomKey | undefined {
  if (product === "信用") {
    return "meeting";
  }
  return result.dailyFacilities.find(
    (facility) => facility.production?.product === product,
  )?.facility.type;
}

export function buildResultPresentation(
  result: EfficiencyResult,
  options: {
    sanityValues: SanityValues;
    dailyAmounts?: SanityResourceAmounts;
    droneAcceleration?: DroneAccelerationResult;
    visibleBasePointTerms?: ReadonlySet<string>;
    sourceFacilityForProduct?: (product: string) => RoomKey | undefined;
    facilityLabel?: (facility: FacilityEfficiencyResult) => string;
  },
): ResultPresentationData {
  const dailySanityAmounts =
    options.dailyAmounts ?? buildDailySanityAmounts(result);
  const dailySanityResult = calculateSanityResult(
    dailySanityAmounts,
    options.sanityValues,
  );
  const calculationSteps = buildCalculationSteps(result);
  const callbacks: ResultPresentationCallbacks = {
    sourceFacilityForProduct: options.sourceFacilityForProduct,
    facilityLabel: options.facilityLabel,
  };
  return {
    calculationSteps,
    calculationStepGroups: buildCalculationStepGroups(
      result,
      calculationSteps,
      callbacks,
    ),
    dailyOutputQueueDetails: buildDailyOutputQueueDetails(
      result,
      options.sanityValues,
      callbacks,
    ),
    dailySanityAmounts,
    dailySanityResult,
    dailyOutputCards: buildDailyOutputCards(
      result,
      dailySanityAmounts,
      dailySanityResult,
      callbacks,
    ),
    droneScenarioDisplays: options.droneAcceleration
      ? buildDroneScenarioDisplays(
          result,
          options.droneAcceleration,
          dailySanityAmounts,
          callbacks,
        )
      : [],
    basePointQueueDetails: buildBasePointQueueDetails(
      result,
      options.visibleBasePointTerms,
    ),
    maaDroneQueueDetails: buildMaaDroneQueueDetails(result),
  };
}
